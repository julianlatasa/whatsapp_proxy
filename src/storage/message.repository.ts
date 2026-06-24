import { Not, type DataSource, type Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import { MessageEntity } from './entities/message.entity.js';
import type { CreateMessageInput, ListMessagesOptions, MessageStatus, StoredMessage } from '../types/message.types.js';

/**
 * Patrón Repository: aísla el acceso a `messages` vía TypeORM. El resto de
 * la aplicación nunca construye queries directamente, solo usa estos
 * métodos tipados.
 */
export class MessageRepository {
    private readonly repo: Repository<MessageEntity>;

    constructor(db: DataSource) {
        this.repo = db.getRepository(MessageEntity);
    }

    /** Persiste un mensaje. Devuelve null si el id ya existía (idempotente). */
    async save(input: CreateMessageInput): Promise<StoredMessage | null> {
        const existing = await this.findById(input.id);
        if (existing) return existing;

        await this.repo.insert(input as QueryDeepPartialEntity<MessageEntity>);
        return this.findById(input.id);
    }

    async markDeleted(id: string): Promise<void> {
        await this.repo.update(id, { isDeleted: true });
    }

    async markEdited(id: string, newText: string | null): Promise<void> {
        await this.repo.update(id, { textContent: newText, isEdited: true });
    }

    /** Actualiza el estado de un mensaje (ack de envío/entrega). No retrocede si el id no existe. */
    async updateStatus(id: string, status: MessageStatus, statusTimestamp: number = Date.now()): Promise<void> {
        const result = await this.repo.update(id, { status, statusTimestamp });
        if (!result.affected) {
            console.warn(`[MessageRepository] updateStatus no encontró mensaje con id=${id} (status=${status})`);
        } else {
            console.log(`[MessageRepository] Mensaje id=${id} actualizado a status=${status}.`);
        }
    }

    /**
     * Confirma en un solo UPDATE el ack de un mensaje saliente: pasa el `status`
     * a `acked`, guarda el raw de `{key, update}` del evento `messages.update`
     * que lo disparó, y `remoteJidAlt` si se pudo resolver el formato alternativo.
     */
    async ackOutbound(id: string, jsonAck: unknown, remoteJidAlt: string | null, statusTimestamp: number = Date.now()): Promise<void> {
        const changes = { status: 'acked', statusTimestamp, jsonAck } as QueryDeepPartialEntity<MessageEntity>;
        if (remoteJidAlt) changes.remoteJidAlt = remoteJidAlt;
        const result = await this.repo.update(id, changes);
        if (!result.affected) {
            console.warn(`[MessageRepository] ackOutbound no encontró mensaje con id=${id}`);
        } else {
            console.log(`[MessageRepository] Mensaje id=${id} actualizado a status=acked (con ack guardado).`);
        }
    }

    /**
     * Confirma que un mensaje saliente salió hacia WhatsApp: guarda el `WAMessage`
     * devuelto por Baileys como `rawPayload` y pasa el `status` de `pending` a `sent`.
     * Si Baileys asignó un `id` distinto al usado al crear el draft, también lo actualiza.
     */
    async markSent(draftId: string, finalId: string, rawPayload: unknown): Promise<void> {
        await this.repo.update(draftId, {
            id: finalId,
            rawPayload,
            status: 'sent',
            statusTimestamp: Date.now(),
        } as QueryDeepPartialEntity<MessageEntity>);
    }

    /** Mensajes entrantes que todavía no fueron confirmados (`acked`) por el WS, en orden de llegada. */
    async listUnacked(): Promise<StoredMessage[]> {
        return this.repo.find({
            where: { fromMe: false, status: Not('acked') },
            order: { messageTimestamp: 'ASC' },
        });
    }

    /** Marca un mensaje entrante como empujado al WS, esperando ack. */
    async markPushed(id: string): Promise<void> {
        await this.updateStatus(id, 'pushed');
    }

    /** Confirma que el WS recibió el mensaje. */
    async markAcked(id: string): Promise<void> {
        await this.updateStatus(id, 'acked');
    }

    /** Vuelve un mensaje a pendiente de reenvío (se agotaron los reintentos o se desconectó el WS). */
    async markPending(id: string): Promise<void> {
        await this.updateStatus(id, 'received');
    }

    async findById(id: string): Promise<StoredMessage | null> {
        return this.repo.findOne({ where: { id } });
    }

    async list(options: ListMessagesOptions = {}): Promise<StoredMessage[]> {
        const { remoteJid, limit = 100 } = options;

        return this.repo.find({
            where: remoteJid ? { remoteJid } : {},
            order: { messageTimestamp: 'DESC' },
            take: limit,
        });
    }
}
