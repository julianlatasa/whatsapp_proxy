import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { MESSAGE_STATUSES, MESSAGE_TYPES, messages } from '../storage/schema.js';

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

/** Derivado 1:1 de las columnas de `messages` (ver `storage/schema.ts`). */
export type StoredMessage = InferSelectModel<typeof messages>;

export type CreateMessageInput = Omit<InferInsertModel<typeof messages>, 'createdAt'>;

export interface ListMessagesOptions {
    remoteJid?: string;
    limit?: number;
}
