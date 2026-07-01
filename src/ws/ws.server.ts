import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { PersistenceObserver } from '../observers/persistence.observer.js';
import type { BlockedContactRepository } from '../storage/blocked-contact.repository.js';
import type { ContactRepository } from '../storage/contact.repository.js';
import type { MessageRepository } from '../storage/message.repository.js';
import type { StoredMessage } from '../types/message.types.js';
import { extractValidJidAlt } from '../whatsapp/jid.utils.js';
import { ConnectionStatus, type WhatsAppClient } from '../whatsapp/whatsapp.client.js';
import { AckTracker } from './ack-tracker.js';
import { handleBlockedAdd, handleBlockedList, handleBlockedRemove } from './handlers/blocked-contact.handlers.js';
import { handleConnectionStatusGet, handleQrGet, handleQrRefresh, handleSessionLogout } from './handlers/connection.handlers.js';
import { handleContactLookupByJid, handleContactLookupByLid } from './handlers/contact.handlers.js';
import { handleMessageAck, handleSendMessage, type MessageHandlerDeps } from './handlers/message.handlers.js';
import {
    isClientRequestType,
    type ClientRequestPayloads,
    type ClientRequestType,
    type ClientResponsePayloads,
    type ServerPushFrame,
    type WsFrame,
} from './protocol.js';

export interface WsServerOptions {
    port: number;
    client: WhatsAppClient;
    messageRepository: MessageRepository;
    contactRepository: ContactRepository;
    blockedContactRepository: BlockedContactRepository;
    persistenceObserver: PersistenceObserver;
    logout: () => Promise<void>;
}

const REPLACED_CONNECTION_CODE = 4000;

/**
 * Único punto de entrada externo al proceso. Acepta un solo cliente WS a la
 * vez (un orquestador externo); si se conecta uno nuevo, reemplaza al
 * anterior. Es una capa de transporte pura: traduce frames `{type, id,
 * payload}` hacia/desde eventos y delega cada request a su handler de
 * dominio (`./handlers`); no contiene lógica de negocio propia.
 */
export class WsServer {
    private readonly wss: WebSocketServer;
    private readonly ackTracker = new AckTracker((id) => this.handlePushGiveUp(id));
    private activeSocket: WebSocket | null = null;
    private readonly messageHandlerDeps: MessageHandlerDeps;

    constructor(private readonly options: WsServerOptions) {
        this.messageHandlerDeps = { client: options.client, messageRepository: options.messageRepository, ackTracker: this.ackTracker };
        this.wss = new WebSocketServer({ port: options.port });
        this.wss.on('connection', (socket) => this.onConnection(socket));

        options.client.on('connection.update', (status) => {
            this.pushToActive({ type: 'connection.status', id: randomUUID(), payload: { status } });
        });

        options.client.on('qr', (qr) => {
            this.pushToActive({ type: 'qr.code', id: randomUUID(), payload: { qr } });
        });

        options.client.on('message.status-changed', (targetId, status, recipient, rawAck) => {
            const jidAlt = status === 'acked' ? extractValidJidAlt(rawAck.key) : null;
            const senderName = status === 'acked' ? rawAck.update.pushName ?? null : null;

            if (status === 'acked') {
                console.log(`[CONTACT][proxy] ✅ WhatsApp ACK recibido — messageId=${targetId} jid=${recipient.jid} lid=${recipient.lid} jidAlt=${jidAlt} pushName=${senderName}`);
                void this.options.messageRepository.ackOutbound(targetId, rawAck, jidAlt, rawAck.key.remoteJid ?? null);
            }

            this.pushToActive({
                type: 'message.status-changed',
                id: randomUUID(),
                payload: { id: targetId, status, jid: recipient.jid, lid: recipient.lid, jidAlt, senderName },
            });
        });

        options.persistenceObserver.on('message.persisted', (message) => {
            this.pushIncomingMessage(message);
        });

        options.client.on('contact.lid-resolved', (mapping) => {
            console.log(`[CONTACT][proxy] 🔗 contact.lid-resolved — pn=${mapping.pn} lid=${mapping.lid} — enviando push a core`);
            this.pushToActive({
                type: 'contact.lid-resolved',
                id: randomUUID(),
                payload: { jid: mapping.pn, lid: mapping.lid },
            });
        });
    }

    close(): void {
        this.wss.close();
    }

    private onConnection(socket: WebSocket): void {
        if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
            this.activeSocket.close(REPLACED_CONNECTION_CODE, 'replaced by a new connection');
        }
        this.releaseInFlightMessages();

        this.activeSocket = socket;
        socket.on('message', (data) => this.onMessage(socket, data));
        socket.on('close', () => this.onClose(socket));

        void this.sendInitialState(socket);
    }

    private onClose(socket: WebSocket): void {
        if (this.activeSocket !== socket) return;
        this.activeSocket = null;
        this.releaseInFlightMessages();
    }

    /** Los mensajes en vuelo (esperando ack) vuelven a pendiente de reenvío para el próximo cliente. */
    private releaseInFlightMessages(): void {
        const ids = this.ackTracker.cancelAll();
        for (const id of ids) {
            void this.options.messageRepository.markPending(id);
        }
    }

    private async sendInitialState(socket: WebSocket): Promise<void> {
        const status = this.options.client.getStatus();
        this.send(socket, { type: 'connection.status', id: randomUUID(), payload: { status } });

        if (status !== ConnectionStatus.OPEN) {
            const qr = this.options.client.getLastQr();
            if (qr) {
                this.send(socket, { type: 'qr.code', id: randomUUID(), payload: { qr } });
            }
        }

        for (const message of await this.options.messageRepository.listUnacked()) {
            this.pushIncomingMessage(message);
        }
    }

    private pushIncomingMessage(message: StoredMessage): void {
        this.ackTracker.track(message.id, () => {
            void this.options.messageRepository.markPushed(message.id);
            this.pushToActive({ type: 'message.received', id: message.id, payload: message });
        });
    }

    private handlePushGiveUp(messageId: string): void {
        void this.options.messageRepository.markPending(messageId);
    }

    private pushToActive(frame: ServerPushFrame): void {
        if (!this.activeSocket || this.activeSocket.readyState !== WebSocket.OPEN) return;
        this.send(this.activeSocket, frame);
    }

    private send(socket: WebSocket, frame: WsFrame): void {
        socket.send(JSON.stringify(frame));
    }

    private onMessage(socket: WebSocket, data: import('ws').RawData): void {
        let frame: WsFrame;
        try {
            frame = JSON.parse(data.toString());
        } catch {
            return;
        }

        if (!isClientRequestType(frame.type)) return;
        const type = frame.type;

        const isContactOrMessage = type === 'contact.lookup-by-jid' || type === 'contact.lookup-by-lid' || type === 'send.message';
        if (isContactOrMessage) {
            console.log(`[CONTACT][proxy] ← Frame recibido de core — type=${type} id=${frame.id} payload=${JSON.stringify(frame.payload)}`);
        }

        void this.handleRequest(socket, type, frame.id, frame.payload as ClientRequestPayloads[typeof type]).catch((error) => {
            if (isContactOrMessage) {
                console.error(`[CONTACT][proxy] ❌ Error procesando ${type} id=${frame.id}:`, error);
            }
            this.send(socket, { type: `${type}.error`, id: frame.id, payload: { message: (error as Error).message } });
        });
    }

    private async handleRequest<T extends ClientRequestType>(
        socket: WebSocket,
        type: T,
        id: string,
        payload: ClientRequestPayloads[T]
    ): Promise<void> {
        const result = await this.dispatch(type, id, payload);
        const isContactOrMessage = type === 'contact.lookup-by-jid' || type === 'contact.lookup-by-lid' || type === 'send.message';
        if (isContactOrMessage) {
            console.log(`[CONTACT][proxy] → Respondiendo ${type}.ok — id=${id} payload=${JSON.stringify(result)}`);
        }
        this.send(socket, { type: `${type}.ok`, id, payload: result });
    }

    private async dispatch<T extends ClientRequestType>(type: T, id: string, payload: ClientRequestPayloads[T]): Promise<ClientResponsePayloads[T]> {
        switch (type) {
            case 'message.ack':
                return handleMessageAck(this.messageHandlerDeps, payload as ClientRequestPayloads['message.ack']) as Promise<ClientResponsePayloads[T]>;

            case 'send.message':
                return handleSendMessage(this.messageHandlerDeps, id, payload as ClientRequestPayloads['send.message']) as Promise<
                    ClientResponsePayloads[T]
                >;

            case 'connection.status.get':
                return handleConnectionStatusGet(this.options) as ClientResponsePayloads[T];

            case 'qr.get':
                return handleQrGet(this.options) as ClientResponsePayloads[T];

            case 'qr.refresh':
                return handleQrRefresh(this.options) as Promise<ClientResponsePayloads[T]>;

            case 'session.logout':
                return handleSessionLogout(this.options) as Promise<ClientResponsePayloads[T]>;

            case 'blocked.add':
                return handleBlockedAdd(this.options, payload as ClientRequestPayloads['blocked.add']) as Promise<ClientResponsePayloads[T]>;

            case 'blocked.remove':
                return handleBlockedRemove(this.options, payload as ClientRequestPayloads['blocked.remove']) as Promise<ClientResponsePayloads[T]>;

            case 'blocked.list':
                return handleBlockedList(this.options) as Promise<ClientResponsePayloads[T]>;

            case 'contact.lookup-by-jid':
                return handleContactLookupByJid(this.options, payload as ClientRequestPayloads['contact.lookup-by-jid']) as Promise<ClientResponsePayloads[T]>;

            case 'contact.lookup-by-lid':
                return handleContactLookupByLid(this.options, payload as ClientRequestPayloads['contact.lookup-by-lid']) as Promise<ClientResponsePayloads[T]>;

            default:
                throw new Error(`Tipo de request no soportado: ${type satisfies never}`);
        }
    }
}
