const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

/** Backoff exponencial para reintentos de conexión a Baileys, acotado a `RECONNECT_MAX_MS`. */
export class ReconnectScheduler {
    private delayMs = 0;
    private timer: NodeJS.Timeout | null = null;

    /** Agenda `reconnect`, duplicando el delay anterior (arrancando en `RECONNECT_BASE_MS`). */
    schedule(reconnect: () => void): void {
        this.delayMs = this.delayMs ? Math.min(this.delayMs * 2, RECONNECT_MAX_MS) : RECONNECT_BASE_MS;

        this.timer = setTimeout(() => {
            this.timer = null;
            reconnect();
        }, this.delayMs);
    }

    /** Cancela el reintento agendado (si hay uno) y reinicia el backoff a cero. */
    reset(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.delayMs = 0;
    }
}
