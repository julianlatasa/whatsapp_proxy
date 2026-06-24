import { TypedEventEmitter } from '../events/typed-emitter.js';
import type { BlockedContactRepository } from '../storage/blocked-contact.repository.js';
import type { MessageRepository } from '../storage/message.repository.js';
import type { StoredMessage } from '../types/message.types.js';
import type { WhatsAppClient } from '../whatsapp/whatsapp.client.js';

/** Identifica al remitente real de un mensaje: el `participant` en grupos, o el `remoteJid` en chats 1-a-1. */
function isFromBlockedContact(blockedContacts: BlockedContactRepository, jid: string, participant?: string | null): boolean {
    const senderId = participant ?? jid;
    // El remitente puede venir como jid (s.whatsapp.net) o como lid: se compara contra ambas columnas.
    return blockedContacts.isBlocked(senderId, senderId);
}

export type PersistenceObserverEvents = {
    'message.persisted': (message: StoredMessage) => void;
};

/**
 * Observer que persiste mensajes entrantes/salientes y sus ediciones/borrados.
 * Emite `message.persisted` tras guardar un entrante exitosamente, para que
 * consumidores externos (ej. WsServer) sepan qué empujar sin duplicar el
 * filtro de contactos bloqueados.
 */
export class PersistenceObserver extends TypedEventEmitter<PersistenceObserverEvents> {
    constructor(
        client: WhatsAppClient,
        private readonly repository: MessageRepository,
        private readonly blockedContacts: BlockedContactRepository
    ) {
        super();

        client.on('message.received', (message) => {
            if (!message.fromMe && isFromBlockedContact(this.blockedContacts, message.remoteJid, message.participant)) {
                return;
            }
            const saved = this.repository.save(message);
            if (saved && !saved.fromMe) {
                this.emit('message.persisted', saved);
            }
        });

        client.on('message.deleted', (targetId) => {
            this.repository.markDeleted(targetId);
        });

        client.on('message.edited', (targetId, newText) => {
            this.repository.markEdited(targetId, newText);
        });

        client.on('message.status-changed', (targetId, status) => {
            // `acked` para salientes lo persiste WsServer en un solo UPDATE junto con el ack crudo (ver ackOutbound).
            if (status === 'acked') return;
            this.repository.updateStatus(targetId, status);
        });
    }
}
