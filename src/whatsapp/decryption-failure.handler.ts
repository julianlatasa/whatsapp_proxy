const DECRYPTION_FAILURE_NOTICE = 'No pudimos leer tu último mensaje. ¿Podés reenviarlo?';

export interface DecryptionFailureDeps {
    sendText: (jid: string, text: string) => Promise<unknown>;
}

/**
 * Cuando Baileys no puede descifrar un mensaje entrante (stub CIPHERTEXT,
 * típicamente por desincronización de claves de sesión) el contenido
 * original se pierde y no hay forma de recuperarlo; lo único posible es
 * avisarle a quien lo envió para que lo reenvíe.
 */
export class DecryptionFailureHandler {
    constructor(private readonly deps: DecryptionFailureDeps) {}

    async notify(senderJid: string): Promise<void> {
        try {
            await this.deps.sendText(senderJid, DECRYPTION_FAILURE_NOTICE);
            console.log(`[DecryptionFailureHandler] Aviso de reenvío enviado a ${senderJid}.`);
        } catch (error) {
            console.error(`[DecryptionFailureHandler] No se pudo avisar a ${senderJid}:`, error);
        }
    }
}
