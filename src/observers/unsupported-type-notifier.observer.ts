import type { WhatsAppClient } from '../whatsapp/whatsapp.client.js';

const UNSUPPORTED_TYPE_NOTICE =
    '¡Hola! 😊 Recibí tu mensaje, pero todavía no puedo procesar ese tipo de contenido ' +
    '(video, sticker, contacto, encuesta, documento, etc.). ' +
    'Por ahora solo puedo leer *texto*, *imágenes* y *audios*. ' +
    '¿Podrías reescribirlo de esa forma? ¡Gracias por tu paciencia! 🙏';

/** Observer que avisa amablemente al contacto cuando envía un tipo de mensaje no soportado. */
export class UnsupportedTypeNotifierObserver {
    constructor(client: WhatsAppClient) {
        client.on('message.unsupported', (remoteJid) => {
            void client.sendText(remoteJid, UNSUPPORTED_TYPE_NOTICE).catch((error) => {
                console.error(`[UnsupportedTypeNotifierObserver] No se pudo avisar tipo de mensaje no soportado a ${remoteJid}:`, error);
            });
        });
    }
}
