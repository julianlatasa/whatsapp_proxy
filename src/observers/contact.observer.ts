import { isJidGroup, isLidUser } from '@whiskeysockets/baileys';
import type { ContactRepository } from '../storage/contact.repository.js';
import { extractValidJidAlt } from '../whatsapp/jid.utils.js';
import type { WhatsAppClient } from '../whatsapp/whatsapp.client.js';

/**
 * Centraliza toda la lógica de guardar y actualizar contactos:
 *
 * - contact.seen        → upsert completo (jid + lid + pushName)
 * - contact.lid-resolved → completa el lid de un contacto ya conocido por jid
 *   (o crea la fila si todavía no existe)
 * - message.status-changed (acked, 1-a-1) → upsert con jid + lid descubierto
 *   en el jidAlt del ack + pushName
 */
export class ContactObserver {
    constructor(client: WhatsAppClient, private readonly repo: ContactRepository) {
        client.on('contact.seen', (contact) => {
            void this.repo.upsert(contact);
        });

        client.on('contact.lid-resolved', ({ pn, lid }) => {
            void this.repo.upsertLid(pn, lid);
        });

        client.on('message.status-changed', (_targetId, status, recipient, rawAck) => {
            if (status !== 'acked') return;
            if (rawAck.key.remoteJid && isJidGroup(rawAck.key.remoteJid)) return;

            const jidAlt = extractValidJidAlt(rawAck.key, (raw) =>
                console.log(`[ContactObserver] jidAlt de device específico descartado (contiene ':'): ${raw}`)
            );
            const lidFromAck = jidAlt && isLidUser(jidAlt) ? jidAlt : null;

            void this.repo.upsert({
                jid: recipient.jid ?? null,
                lid: recipient.lid ?? lidFromAck ?? null,
                pushName: rawAck.update.pushName ?? null,
            });
        });
    }
}
