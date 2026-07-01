import type { WACallEvent, WASocket } from '@whiskeysockets/baileys';

const CALL_REJECT_DELAY_MS = 2_000;

export interface CallRejectionDeps {
    getSocket: () => WASocket | null;
    /** Envía texto plano sin simular typing, para que el rechazo sea inmediato. */
    sendTextDirect: (jid: string, text: string) => Promise<unknown>;
    rejectionMessage: string;
    onIncomingCall?: (call: WACallEvent) => void;
}

/**
 * Esta línea no admite llamadas: cada `offer` agenda un rechazo a los
 * `CALL_REJECT_DELAY_MS` (para no cortar antes de que el cliente de WhatsApp
 * termine de mostrar la llamada entrante); si la llamada cambia de estado
 * antes (el que llama cuelga, por ejemplo) el rechazo agendado se cancela.
 */
export class CallRejectionHandler {
    private readonly pendingRejections = new Map<string, NodeJS.Timeout>();

    constructor(private readonly deps: CallRejectionDeps) {}

    handle(calls: WACallEvent[]): void {
        for (const call of calls) {
            console.log(`[CallRejectionHandler] Evento de llamada: id=${call.id} from=${call.from} status=${call.status} isVideo=${call.isVideo ?? false}`);

            if (call.status === 'offer') {
                this.deps.onIncomingCall?.(call);

                const timer = setTimeout(() => {
                    this.pendingRejections.delete(call.id);
                    void this.reject(call);
                }, CALL_REJECT_DELAY_MS);

                this.pendingRejections.set(call.id, timer);
                continue;
            }

            // Cualquier otro estado (accept, reject, terminate, ...) para una llamada
            // que ya tiene un rechazo agendado significa que ya no corresponde rechazarla.
            const pendingTimer = this.pendingRejections.get(call.id);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                this.pendingRejections.delete(call.id);
            }
        }
    }

    /** Cancela todos los rechazos agendados (ej. al desconectar el socket). */
    clear(): void {
        for (const timer of this.pendingRejections.values()) {
            clearTimeout(timer);
        }
        this.pendingRejections.clear();
    }

    private async reject(call: WACallEvent): Promise<void> {
        const socket = this.deps.getSocket();
        if (!socket) {
            console.warn(`[CallRejectionHandler] No hay socket activo; no se puede rechazar la llamada de ${call.from}.`);
            return;
        }

        try {
            await socket.rejectCall(call.id, call.from);
            console.log(`[CallRejectionHandler] Llamada de ${call.from} rechazada.`);
            await this.deps.sendTextDirect(call.from, this.deps.rejectionMessage);
            console.log(`[CallRejectionHandler] Aviso enviado a ${call.from}: "${this.deps.rejectionMessage}"`);
        } catch (error) {
            console.error(`[CallRejectionHandler] No se pudo rechazar/avisar la llamada de ${call.from}:`, error);
        }
    }
}
