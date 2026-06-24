import makeWASocket, {
    type AnyMessageContent,
    type BaileysEventMap,
    type Contact,
    DisconnectReason,
    isLidUser,
    isPnUser,
    type LIDMapping,
    proto,
    useMultiFileAuthState,
    type WACallEvent,
    type WAMessage,
    type WASocket,
} from '@whiskeysockets/baileys';
import { rm } from 'node:fs/promises';
import pino from 'pino';
import { TypedEventEmitter } from '../events/typed-emitter.js';
import type { CreateMessageInput, MessageStatus } from '../types/message.types.js';
import { isWithinRetentionWindow } from './message-freshness.js';
import { MessageParser, type UnsupportedTypeEvent } from './message.parser.js';

function isUnsupportedTypeEvent(value: CreateMessageInput | UnsupportedTypeEvent): value is UnsupportedTypeEvent {
    return (value as UnsupportedTypeEvent).kind === 'unsupported';
}

const UNSUPPORTED_TYPE_NOTICE =
    '¡Hola! 😊 Recibí tu mensaje, pero todavía no puedo procesar ese tipo de contenido ' +
    '(video, sticker, contacto, encuesta, documento, etc.). ' +
    'Por ahora solo puedo leer *texto*, *imágenes* y *audios*. ' +
    '¿Podrías reescribirlo de esa forma? ¡Gracias por tu paciencia! 🙏';

export const ConnectionStatus = {
    IDLE: 'idle',
    CONNECTING: 'connecting',
    OPEN: 'open',
    RECONNECTING: 'reconnecting',
    LOGGED_OUT: 'logged_out',
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

export interface WhatsAppClientOptions {
    authDir?: string;
    browserName?: string;
}

export interface SeenContact {
    jid: string | null;
    lid: string | null;
    pushName: string | null;
}

export interface RecipientIds {
    jid: string | null;
    lid: string | null;
}

export type WhatsAppClientEvents = {
    qr: (qr: string) => void;
    'connection.update': (status: ConnectionStatus) => void;
    'message.received': (message: CreateMessageInput) => void;
    'message.deleted': (targetId: string) => void;
    'message.edited': (targetId: string, newText: string | null) => void;
    'message.status-changed': (targetId: string, status: MessageStatus, recipient: RecipientIds, rawAck: BaileysEventMap['messages.update'][number]) => void;
    'call.incoming': (call: WACallEvent) => void;
    'contact.seen': (contact: SeenContact) => void;
    'contact.lid-resolved': (mapping: LIDMapping) => void;
};

const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? 'warn' });

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const CALL_REJECT_DELAY_MS = 2_000;
const CALL_REJECTION_NOTICE = 'Esta línea es solo para mensajes y no admite llamadas.';
const COMPOSING_DELAY_MS = 1_200;
/** Baileys envía un ping al servidor cada `keepAliveIntervalMs` para mantener la conexión activa; si no hay respuesta en ese intervalo + 5s, fuerza una reconexión (manejada en `onConnectionUpdate`). */
const KEEP_ALIVE_INTERVAL_MS = 30_000;

/** Mapea el ack numérico de WhatsApp a los estados que modelamos (sin `read`/`played`). */
const ACK_STATUS_MAP: Partial<Record<proto.WebMessageInfo.Status, MessageStatus>> = {
    [proto.WebMessageInfo.Status.SERVER_ACK]: 'acked',
    [proto.WebMessageInfo.Status.DELIVERY_ACK]: 'acked',
};

/**
 * Envuelve la conexión Baileys y emite eventos tipados (patrón Observer)
 * sobre el ciclo de vida de la conexión, mensajes, llamadas y contactos. No
 * conoce persistencia ni nada por fuera del transporte con WhatsApp.
 */
export class WhatsAppClient extends TypedEventEmitter<WhatsAppClientEvents> {
    private readonly authDir: string;
    private readonly browserName: string;
    private readonly parser = new MessageParser();

    private socket: WASocket | null = null;
    private status: ConnectionStatus = ConnectionStatus.IDLE;
    private reconnectDelayMs = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private readonly pendingCallRejections = new Map<string, NodeJS.Timeout>();
    private lastQr: string | null = null;

    constructor(options: WhatsAppClientOptions = {}) {
        super();
        this.authDir = options.authDir ?? 'auth_info_baileys';
        this.browserName = options.browserName ?? 'WhatsAppProxy';
    }

    getStatus(): ConnectionStatus {
        return this.status;
    }

    /** Último QR emitido mientras se espera un escaneo; `null` si ya hay una sesión abierta. */
    getLastQr(): string | null {
        return this.lastQr;
    }

    async connect(): Promise<void> {
        if (this.status === ConnectionStatus.OPEN) return;
        this.setStatus(ConnectionStatus.CONNECTING);
        await this.initSocket();
    }

    async disconnect(): Promise<void> {
        this.socket?.end(undefined);
        this.socket = null;
        this.clearPendingCallRejections();
        this.setStatus(ConnectionStatus.IDLE);
    }

    /** Cierra la sesión activa en WhatsApp. Dispara el mismo camino de limpieza que un logout forzado por el servidor (borra `authDir` y reconecta pidiendo un QR nuevo). */
    async forceLogout(): Promise<void> {
        if (!this.socket) return;
        await this.socket.logout().catch(() => undefined);
    }

    /** Cancela el backoff de reconexión pendiente y reinicia el socket ya, para forzar un QR nuevo sin esperar. No hace nada si ya hay una sesión abierta. */
    async requestFreshQr(): Promise<void> {
        if (this.status === ConnectionStatus.OPEN) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectDelayMs = 0;
        this.lastQr = null;
        this.setStatus(ConnectionStatus.CONNECTING);
        await this.initSocket();
    }

    private clearPendingCallRejections(): void {
        for (const timer of this.pendingCallRejections.values()) {
            clearTimeout(timer);
        }
        this.pendingCallRejections.clear();
    }

    /**
     * Envía un mensaje de texto, simulando que se está tipeando antes de
     * mandarlo. `messageId` permite forzar el `key.id` para que coincida con
     * el id usado al persistir el mensaje saliente. Devuelve el `WAMessage`
     * completo (mismo shape que se guarda como `rawPayload` en entrantes).
     */
    async sendText(jid: string, text: string, messageId?: string): Promise<WAMessage | null> {
        if (!this.socket || this.status !== ConnectionStatus.OPEN) {
            throw new Error(`No conectado a WhatsApp (estado: ${this.status})`);
        }

        await this.simulateTyping(jid);

        const content: AnyMessageContent = { text };
        const sent = await this.socket.sendMessage(jid, content, messageId ? { messageId } : undefined);
        return sent ?? null;
    }

    private async simulateTyping(jid: string): Promise<void> {
        if (!this.socket) return;
        await this.socket.presenceSubscribe(jid).catch(() => undefined);
        await this.socket.sendPresenceUpdate('composing', jid);
        await new Promise((resolve) => setTimeout(resolve, COMPOSING_DELAY_MS));
        await this.socket.sendPresenceUpdate('paused', jid);
    }

    private static readonly LISTENED_EVENTS = [
        'creds.update',
        'connection.update',
        'messages.upsert',
        'messages.update',
        'messaging-history.set',
        'call',
        'lid-mapping.update',
    ] as const;

    private detachListeners(): void {
        for (const event of WhatsAppClient.LISTENED_EVENTS) {
            this.socket?.ev.removeAllListeners(event);
        }
    }

    private async initSocket(): Promise<void> {
        this.detachListeners();

        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

        this.socket = makeWASocket({
            auth: state,
            browser: [this.browserName, 'Chrome', '1.0.0'],
            syncFullHistory: false,
            keepAliveIntervalMs: KEEP_ALIVE_INTERVAL_MS,
            logger: baileysLogger,
        });

        this.socket.ev.on('creds.update', saveCreds);
        this.socket.ev.on('connection.update', (update) => this.onConnectionUpdate(update));
        this.socket.ev.on('messages.upsert', (upsert) => this.onMessagesUpsert(upsert));
        this.socket.ev.on('messages.update', (updates) => this.onMessagesUpdate(updates));
        this.socket.ev.on('messaging-history.set', (history) => this.onHistorySync(history));
        this.socket.ev.on('call', (calls) => this.onCall(calls));
        this.socket.ev.on('lid-mapping.update', (mapping) => this.emit('contact.lid-resolved', mapping));
    }

    private onConnectionUpdate(update: BaileysEventMap['connection.update']): void {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            this.lastQr = qr;
        }

        if (connection === 'close') {
            const errorWithOutput = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
            const statusCode = errorWithOutput?.output?.statusCode;

            if (statusCode === DisconnectReason.loggedOut) {
                this.setStatus(ConnectionStatus.LOGGED_OUT);
                void rm(this.authDir, { recursive: true, force: true }).then(() => {
                    this.reconnectDelayMs = 0;
                    this.setStatus(ConnectionStatus.CONNECTING);
                    return this.initSocket();
                });
                return;
            }

            this.lastQr = null;
            this.setStatus(ConnectionStatus.RECONNECTING);
            this.scheduleReconnect();
            return;
        }

        if (connection === 'open') {
            this.lastQr = null;
            this.reconnectDelayMs = 0;
            this.setStatus(ConnectionStatus.OPEN);
        }
    }

    private onMessagesUpsert({ messages, type }: BaileysEventMap['messages.upsert']): void {
        if (type !== 'notify' && type !== 'append') return;

        for (const waMessage of messages) {
            this.processIncomingMessage(waMessage, { enforceRetentionWindow: true, notifyUnsupported: true });
        }
    }

    /** Ack de envío/entrega de mensajes salientes (status: SERVER_ACK, DELIVERY_ACK, ...). */
    private onMessagesUpdate(updates: BaileysEventMap['messages.update']): void {
        for (const entry of updates) {
            const { key, update } = entry;
            if (!key.id || update.status == null) continue;

            console.log(`[WhatsAppClient] ACK recibido: key.id=${key.id} status=${update.status}`);

            const mappedStatus = ACK_STATUS_MAP[update.status];
            if (mappedStatus) {
                this.emit('message.status-changed', key.id, mappedStatus, this.resolveSenderIds(key), entry);
            } else {
                console.log(`[WhatsAppClient] ACK con status=${update.status} no mapeado, se ignora (key.id=${key.id}).`);
            }
        }
    }

    private onHistorySync({ messages, contacts }: BaileysEventMap['messaging-history.set']): void {
        for (const waMessage of messages) {
            this.processIncomingMessage(waMessage, { enforceRetentionWindow: true, notifyUnsupported: false });
        }

        for (const contact of contacts) {
            this.emitContactSeen(contact);
        }
    }

    /** Procesa un WAMessage proveniente de `messages.upsert` o de history sync. */
    private processIncomingMessage(
        waMessage: BaileysEventMap['messages.upsert']['messages'][number],
        options: { enforceRetentionWindow: boolean; notifyUnsupported: boolean }
    ): void {
        const protocolEvent = this.parser.parseProtocolEvent(waMessage);
        if (protocolEvent) {
            if (protocolEvent.kind === 'delete') {
                this.emit('message.deleted', protocolEvent.targetId);
            } else {
                this.emit('message.edited', protocolEvent.targetId, protocolEvent.newText);
            }
            return;
        }

        const parsed = waMessage.message ? this.parser.parseWithUnsupported(waMessage) : this.parser.parseStub(waMessage);
        if (!parsed) return;

        if (isUnsupportedTypeEvent(parsed)) {
            if (options.notifyUnsupported) {
                void this.notifyUnsupportedType(parsed.remoteJid);
            }
            return;
        }

        if (options.enforceRetentionWindow && !isWithinRetentionWindow(parsed.messageTimestamp)) {
            return;
        }

        this.emit('message.received', parsed);

        const sender = this.resolveSenderIds(waMessage.key);
        if (sender.jid || sender.lid) {
            this.emit('contact.seen', { jid: sender.jid, lid: sender.lid, pushName: parsed.pushName ?? null });
        }
    }

    /**
     * El remitente de un WAMessage puede venir como jid (`s.whatsapp.net`) o
     * como lid según `addressingMode`; Baileys expone el otro formato en el
     * campo `*Alt`. En grupos el remitente es `participant`, no `remoteJid`.
     */
    private resolveSenderIds(key: BaileysEventMap['messages.upsert']['messages'][number]['key']): { jid: string | null; lid: string | null } {
        const primary = key.participant ?? key.remoteJid;
        const alt = key.participantAlt ?? key.remoteJidAlt;

        const candidates = [primary, alt].filter((id): id is string => !!id);
        const jid = candidates.find((id) => isPnUser(id)) ?? null;
        const lid = candidates.find((id) => isLidUser(id)) ?? null;

        return { jid, lid };
    }

    private emitContactSeen(contact: Contact): void {
        const jid = contact.phoneNumber ?? contact.id;
        if (!jid) return;
        this.emit('contact.seen', { jid, lid: contact.lid ?? null, pushName: contact.notify ?? contact.name ?? null });
    }

    private onCall(calls: WACallEvent[]): void {
        for (const call of calls) {
            console.log(`[WhatsAppClient] Evento de llamada: id=${call.id} from=${call.from} status=${call.status}`);

            if (call.status === 'offer') {
                const timer = setTimeout(() => {
                    this.pendingCallRejections.delete(call.id);
                    void this.rejectCall(call);
                }, CALL_REJECT_DELAY_MS);

                this.pendingCallRejections.set(call.id, timer);
                continue;
            }

            // Cualquier otro estado (accept, reject, terminate, ...) para una llamada
            // que ya tiene un rechazo agendado significa que ya no corresponde rechazarla.
            const pendingTimer = this.pendingCallRejections.get(call.id);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                this.pendingCallRejections.delete(call.id);
            }
        }
    }

    private async rejectCall(call: WACallEvent): Promise<void> {
        if (!this.socket) {
            console.warn(`[WhatsAppClient] No hay socket activo; no se puede rechazar la llamada de ${call.from}.`);
            return;
        }

        try {
            await this.socket.rejectCall(call.id, call.from);
            console.log(`[WhatsAppClient] Llamada de ${call.from} rechazada.`);
            await this.sendText(call.from, CALL_REJECTION_NOTICE);
            console.log(`[WhatsAppClient] Aviso de "solo mensajes" enviado a ${call.from}.`);
        } catch (error) {
            console.error(`[WhatsAppClient] No se pudo rechazar/avisar la llamada de ${call.from}:`, error);
        }
    }

    /** Avisa amablemente al contacto que el tipo de mensaje que envió no está soportado. */
    private async notifyUnsupportedType(remoteJid: string): Promise<void> {
        try {
            await this.sendText(remoteJid, UNSUPPORTED_TYPE_NOTICE);
        } catch (error) {
            console.error(`[WhatsAppClient] No se pudo avisar tipo de mensaje no soportado a ${remoteJid}:`, error);
        }
    }

    private scheduleReconnect(): void {
        this.reconnectDelayMs = this.reconnectDelayMs ? Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS) : RECONNECT_BASE_MS;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.initSocket();
        }, this.reconnectDelayMs);
    }

    private setStatus(next: ConnectionStatus): void {
        if (this.status === next) return;
        this.status = next;
        this.emit('connection.update', next);
    }
}
