import { MESSAGE_STATUSES, MESSAGE_TYPES, MessageEntity } from '../storage/entities/message.entity.js';

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface MessageKey {
    id: string;
    remoteJid: string;
    fromMe: boolean;
    participant: string | null;
}

/**
 * Estado del mensaje. Entrantes progresan `received` -> `pushed` -> `acked`
 * (confirmados por el cliente WS). Salientes progresan `pending` -> `sent`
 * (confirmado el envío a Baileys) -> `acked` (WhatsApp respondió
 * SERVER_ACK o DELIVERY_ACK); WhatsApp también distingue `read`/`played`,
 * pero no se modelan por ahora.
 */
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Derivado 1:1 de las columnas de `messages` (ver `storage/entities/message.entity.ts`). */
export type StoredMessage = MessageEntity;

export type CreateMessageInput = Omit<MessageEntity, 'createdAt' | 'remoteJidAlt' | 'jsonAck'> &
    Partial<Pick<MessageEntity, 'remoteJidAlt' | 'jsonAck'>>;

export interface ListMessagesOptions {
    remoteJid?: string;
    limit?: number;
}
