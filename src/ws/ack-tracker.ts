const RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

interface TrackedSend {
    attempts: number;
    timer: NodeJS.Timeout;
}

/**
 * Reenvía un frame con backoff exponencial mientras no llegue su ack.
 * Tras agotar `RETRY_DELAYS_MS` sin ack, invoca `onGiveUp` y deja de rastrearlo.
 */
export class AckTracker {
    private readonly pending = new Map<string, TrackedSend>();

    constructor(private readonly onGiveUp: (id: string) => void) {}

    /** Envía ahora y agenda reintentos; `send` se invoca una vez por intento (incluido el primero). */
    track(id: string, send: () => void): void {
        this.cancel(id);
        send();
        this.scheduleRetry(id, send, 0);
    }

    /** Cancela los reintentos pendientes para `id` (el cliente confirmó la recepción). */
    ack(id: string): void {
        this.cancel(id);
    }

    /** Cancela todos los reintentos en curso, sin disparar `onGiveUp` (ej. al desconectar el cliente WS). */
    cancelAll(): string[] {
        const ids = [...this.pending.keys()];
        for (const id of ids) {
            this.cancel(id);
        }
        return ids;
    }

    private scheduleRetry(id: string, send: () => void, attempt: number): void {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
            this.pending.delete(id);
            this.onGiveUp(id);
            return;
        }

        const timer = setTimeout(() => {
            send();
            this.scheduleRetry(id, send, attempt + 1);
        }, delay);

        this.pending.set(id, { attempts: attempt + 1, timer });
    }

    private cancel(id: string): void {
        const tracked = this.pending.get(id);
        if (tracked) {
            clearTimeout(tracked.timer);
            this.pending.delete(id);
        }
    }
}
