import { generateMessageID } from '@whiskeysockets/baileys';
import type { CreateMessageInput } from '../types/message.types.js';

/**
 * Patrón Factory: centraliza la construcción de `CreateMessageInput` para
 * mensajes salientes, garantizando que siempre queden con los campos
 * obligatorios completos sin duplicar literales por toda la app.
 */
export class MessageFactory {
    static createOutboundText(remoteJid: string, text: string, id: string = generateMessageID()): CreateMessageInput {
        const now = Date.now();
        return {
            id,
            remoteJid,
            fromMe: true,
            participant: null,
            pushName: null,
            messageTimestamp: now,
            messageType: 'conversation',
            textContent: text,
            mediaMimetype: null,
            mediaUrl: null,
            quotedMessageId: null,
            rawPayload: null,
            isDeleted: false,
            isEdited: false,
            status: 'pending',
            statusTimestamp: now,
        };
    }
}
