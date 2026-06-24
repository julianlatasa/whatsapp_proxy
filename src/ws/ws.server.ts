import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { PersistenceObserver } from '../observers/persistence.observer.js';
import { MessageFactory } from '../patterns/message.factory.js';
import type { BlockedContactRepository } from '../storage/blocked-contact.repository.js';
import type { ContactRepository } from '../storage/contact.repository.js';
import type { MessageRepository } from '../storage/message.repository.js';
import type { StoredMessage } from '../types/message.types.js';
import { ConnectionStatus, type WhatsAppClient } from '../whatsapp/whatsapp.client.js';
import { AckTracker } from './ack-tracker.js';
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
 * anterior. Traduce el protocolo `{type, id, payload}` hacia/desde los
 * eventos y repositorios ya existentes — no duplica lógica de negocio.
 */
export class WsServer {
    private readonly wss: WebSocketServer;
    private readonly ackTracker = new AckTracker((id) => this.handlePushGiveUp(id));
    private activeSocket: WebSocket | null = null;

    constructor(private readonly options: WsServerOptions) {
        this.wss = new WebSocketServer({ port: options.port });
        this.wss.on('connection', (socket) => this.onConnection(socket));

        options.client.on('connection.update', (status) => {
            this.pushToActive({ type: 'connection.status', id: randomUUID(), payload: { status } });
        });

        options.client.on('qr', (qr) => {
            this.pushToActive({ type: 'qr.code', id: randomUUID(), payload: { qr } });
        });

        options.client.on('message.status-changed', (targetId, status, recipient, rawAck) => {
            let jidAlt: string | null = null;
            let senderName: string | null = null;

            if (status === 'acked') {
                jidAlt = rawAck.key.participantAlt ?? rawAck.key.remoteJidAlt ?? null;
                senderName = rawAck.update.pushName ?? null;

                void this.options.messageRepository.ackOutbound(targetId, rawAck, jidAlt, rawAck.key.remoteJid ?? null);
                void this.options.contactRepository.upsert({ jid: recipient.jid, lid: recipient.lid, pushName: senderName });
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

        void this.handleRequest(socket, type, frame.id, frame.payload as ClientRequestPayloads[typeof type]).catch((error) => {
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
        this.send(socket, { type: `${type}.ok`, id, payload: result });
    }

    private async dispatch<T extends ClientRequestType>(type: T, id: string, payload: ClientRequestPayloads[T]): Promise<ClientResponsePayloads[T]> {
        switch (type) {
            case 'message.ack': {
                const { id } = payload as ClientRequestPayloads['message.ack'];
                this.ackTracker.ack(id);
                await this.options.messageRepository.markAcked(id);
                return { ok: true } as ClientResponsePayloads[T];
            }

            case 'send.message': {
                const { jid, text } = payload as ClientRequestPayloads['send.message'];
                const draft = MessageFactory.createOutboundText(jid, text, id);
                await this.options.messageRepository.save(draft);

                const sent = await this.options.client.sendText(jid, text, draft.id);
                const finalId = sent?.key?.id ?? draft.id;
                console.log(`[ws.server] Mensaje enviado: draft.id=${draft.id} sent.key.id=${sent?.key?.id ?? '(sin respuesta)'} -> finalId=${finalId}`);
                if (finalId !== draft.id) {
                    console.warn(`[ws.server] WhatsApp devolvió un id distinto al forzado: draft=${draft.id} final=${finalId}`);
                }
                await this.options.messageRepository.markSent(draft.id, finalId, sent ?? null);
                console.log(`[ws.server] Mensaje persistido en DB con id=${finalId} (status=sent).`);

                const saved = await this.options.messageRepository.findById(finalId);
                if (!saved) throw new Error(`No se pudo persistir el mensaje enviado: ${draft.id}`);
                return saved as ClientResponsePayloads[T];
            }

            case 'connection.status.get':
                return { status: this.options.client.getStatus() } as ClientResponsePayloads[T];

            case 'qr.get':
                return { qr: this.options.client.getLastQr() } as ClientResponsePayloads[T];

            case 'qr.refresh':
                await this.options.client.requestFreshQr();
                return { ok: true } as ClientResponsePayloads[T];

            case 'session.logout':
                await this.options.logout();
                return { ok: true } as ClientResponsePayloads[T];

            case 'blocked.add': {
                const { jid, lid } = payload as ClientRequestPayloads['blocked.add'];
                return (await this.options.blockedContactRepository.block({ jid, lid })) as ClientResponsePayloads[T];
            }

            case 'blocked.remove': {
                const { jid, lid } = payload as ClientRequestPayloads['blocked.remove'];
                await this.options.blockedContactRepository.unblock(jid, lid);
                return { ok: true } as ClientResponsePayloads[T];
            }

            case 'blocked.list':
                return (await this.options.blockedContactRepository.list()) as ClientResponsePayloads[T];

            case 'contact.lookup-by-jid': {
                const { jid } = payload as ClientRequestPayloads['contact.lookup-by-jid'];
                return (await this.options.contactRepository.findByJid(jid)) as ClientResponsePayloads[T];
            }

            case 'contact.lookup-by-lid': {
                const { lid } = payload as ClientRequestPayloads['contact.lookup-by-lid'];
                return (await this.options.contactRepository.findByLid(lid)) as ClientResponsePayloads[T];
            }

            default:
                throw new Error(`Tipo de request no soportado: ${type satisfies never}`);
        }
    }
}
