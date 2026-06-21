export const DEFAULT_RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True si `messageTimestampMs` ocurrió dentro de la ventana de retención (por defecto, últimas 24hs). */
export function isWithinRetentionWindow(messageTimestampMs: number, windowMs = DEFAULT_RETENTION_WINDOW_MS): boolean {
    return Date.now() - messageTimestampMs <= windowMs;
}
