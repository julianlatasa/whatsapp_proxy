import qrcodeTerminal from 'qrcode-terminal';
import type { WhatsAppClient } from '../whatsapp/whatsapp.client.js';

/**
 * Observer de ejemplo: se suscribe a los eventos de WhatsAppClient sin que
 * el cliente sepa de su existencia. Plantilla para sumar más observadores
 * (notificaciones, métricas, webhooks) sin tocar el cliente.
 */
export class ConsoleLoggerObserver {
    constructor(client: WhatsAppClient) {
        client.on('connection.update', (status) => {
            console.log(`[ConsoleLogger] Estado de conexión: ${status}`);
        });

        client.on('qr', (qr) => {
            console.log('[ConsoleLogger] Nuevo QR disponible, escaneá desde WhatsApp > Dispositivos vinculados:');
            qrcodeTerminal.generate(qr, { small: true });
        });

        client.on('message.received', (message) => {
            const who = message.pushName ?? message.remoteJid;
            const content = message.textContent ?? `[${message.messageType}]`;
            console.log(`[ConsoleLogger] ${who}: ${content}`);
        });
    }
}
