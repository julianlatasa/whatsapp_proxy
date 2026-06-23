import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { AppDatabase } from './database.js';
import { messages } from './schema.js';
import type { CreateMessageInput, ListMessagesOptions, MessageStatus, StoredMessage } from '../types/message.types.js';

/**
 * Patrón Repository: aísla el acceso a `messages` vía Drizzle. El resto de
 * la aplicación nunca construye queries directamente, solo usa estos
 * métodos tipados.
 */
export class MessageRepository {
    constructor(private readonly db: AppDatabase) {}

    /** Persiste un mensaje. Devuelve null si el id ya existía (idempotente). */
    save(input: CreateMessageInput): StoredMessage | null {
        const existing = this.findById(input.id);
        if (existing) return existing;

        this.db.insert(messages).values(input).run();
        return this.findById(input.id);
    }

    markDeleted(id: string): void {
        this.db.update(messages).set({ isDeleted: true }).where(eq(messages.id, id)).run();
    }

    markEdited(id: string, newText: string | null): void {
        this.db.update(messages).set({ textContent: newText, isEdited: true }).where(eq(messages.id, id)).run();
    }

    /** Actualiza el estado de un mensaje (ack de envío/entrega). No retrocede si el id no existe. */
    updateStatus(id: string, status: MessageStatus, statusTimestamp: number = Date.now()): void {
        const result = this.db.update(messages).set({ status, statusTimestamp }).where(eq(messages.id, id)).run();
        if (result.changes === 0) {
            console.warn(`[MessageRepository] updateStatus no encontró mensaje con id=${id} (status=${status})`);
        }
    }

    /** Mensajes entrantes que todavía no fueron confirmados (`acked`) por el WS, en orden de llegada. */
    listUnacked(): StoredMessage[] {
        return this.db
            .select()
            .from(messages)
            .where(and(eq(messages.fromMe, false), ne(messages.status, 'acked')))
            .orderBy(asc(messages.messageTimestamp))
            .all();
    }

    /** Marca un mensaje entrante como empujado al WS, esperando ack. */
    markPushed(id: string): void {
        this.updateStatus(id, 'pushed');
    }

    /** Confirma que el WS recibió el mensaje. */
    markAcked(id: string): void {
        this.updateStatus(id, 'acked');
    }

    /** Vuelve un mensaje a pendiente de reenvío (se agotaron los reintentos o se desconectó el WS). */
    markPending(id: string): void {
        this.updateStatus(id, 'received');
    }

    findById(id: string): StoredMessage | null {
        const row = this.db.select().from(messages).where(eq(messages.id, id)).get();
        return row ?? null;
    }

    list(options: ListMessagesOptions = {}): StoredMessage[] {
        const { remoteJid, limit = 100 } = options;

        const query = this.db.select().from(messages);

        if (remoteJid) {
            return query.where(eq(messages.remoteJid, remoteJid)).orderBy(desc(messages.messageTimestamp)).limit(limit).all();
        }

        return query.orderBy(desc(messages.messageTimestamp)).limit(limit).all();
    }
}
