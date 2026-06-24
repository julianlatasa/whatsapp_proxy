import type { StoredBlockedContact } from '../types/blocked-contact.types.js';
import type { StoredContact } from '../types/contact.types.js';
import type { MessageStatus, StoredMessage } from '../types/message.types.js';
import type { ConnectionStatus } from '../whatsapp/whatsapp.client.js';

/** Frame único del protocolo WS: `{ type, id, payload }`. `id` correlaciona requests con su respuesta. */
export interface WsFrame<TPayload = unknown> {
    type: string;
    id: string;
    payload: TPayload;
}

export interface LidResolvedPayload {
    /** Telefono real, formato "numero@s.whatsapp.net". */
    jid: string;
    /** Identificador estable (lid) que WhatsApp asocia a ese telefono. */
    lid: string;
}

export interface MessageStatusChangedPayload {
    id: string;
    status: MessageStatus;
    /** Destinatario del mensaje saliente, formato "numero@s.whatsapp.net"; `null` si no se pudo resolver. */
    jid: string | null;
    /** Identificador estable (lid) del destinatario; `null` si no se pudo resolver. */
    lid: string | null;
    /** Formato alternativo de `remoteJid` (`key.remoteJidAlt`/`participantAlt`) reportado en el ack; `null` si no vino. */
    jidAlt: string | null;
    /** Nombre de perfil del destinatario reportado en el ack (`update.pushName`); `null` si no vino. */
    senderName: string | null;
}

/** Frames que el servidor empuja sin que el cliente los haya pedido. */
export type ServerPushFrame =
    | WsFrame<StoredMessage> // type: 'message.received' — entrante recién pusheado, esperando 'message.ack'
    | WsFrame<MessageStatusChangedPayload> // type: 'message.status-changed' — saliente, informativo
    | WsFrame<{ status: ConnectionStatus }> // type: 'connection.status'
    | WsFrame<{ qr: string }> // type: 'qr.code'
    | WsFrame<LidResolvedPayload>; // type: 'contact.lid-resolved' — WhatsApp resolvió el lid de un numero

export interface BlockContactPayload {
    jid: string | null;
    lid: string | null;
}

export interface SendMessagePayload {
    jid: string;
    text: string;
}

/** Tipos de request soportados, cliente -> servidor. El servidor responde con `${type}.ok` o `${type}.error`. */
export const CLIENT_REQUEST_TYPES = [
    'message.ack',
    'send.message',
    'connection.status.get',
    'qr.get',
    'qr.refresh',
    'session.logout',
    'blocked.add',
    'blocked.remove',
    'blocked.list',
    'contact.lookup-by-jid',
    'contact.lookup-by-lid',
] as const;

export type ClientRequestType = (typeof CLIENT_REQUEST_TYPES)[number];

export interface ClientRequestPayloads {
    'message.ack': { id: string };
    'send.message': SendMessagePayload;
    'connection.status.get': undefined;
    'qr.get': undefined;
    'qr.refresh': undefined;
    'session.logout': undefined;
    'blocked.add': BlockContactPayload;
    'blocked.remove': BlockContactPayload;
    'blocked.list': undefined;
    'contact.lookup-by-jid': { jid: string };
    'contact.lookup-by-lid': { lid: string };
}

export interface ClientResponsePayloads {
    'message.ack': { ok: true };
    'send.message': StoredMessage;
    'connection.status.get': { status: ConnectionStatus };
    'qr.get': { qr: string | null };
    'qr.refresh': { ok: true };
    'session.logout': { ok: true };
    'blocked.add': StoredBlockedContact | null;
    'blocked.remove': { ok: true };
    'blocked.list': StoredBlockedContact[];
    'contact.lookup-by-jid': StoredContact | null;
    'contact.lookup-by-lid': StoredContact | null;
}

export function isClientRequestType(type: string): type is ClientRequestType {
    return (CLIENT_REQUEST_TYPES as readonly string[]).includes(type);
}
