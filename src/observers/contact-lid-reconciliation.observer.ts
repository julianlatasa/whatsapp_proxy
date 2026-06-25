import { isJidGroup, isLidUser } from '@whiskeysockets/baileys';
import type { ContactRepository } from '../storage/contact.repository.js';
import { extractValidJidAlt } from '../whatsapp/jid.utils.js';
import type { RecipientIds, WhatsAppClient } from '../whatsapp/whatsapp.client.js';

/**
 * Observer que, al confirmarse el ack de un mensaje saliente 1-a-1, completa
 * en `contacts` el `lid` a partir del `jidAlt` reportado en el ack (si
 * `jidAlt` es un `@lid` sin device id; ver `extractValidJidAlt`). Los acks de
 * grupo no identifican a un contacto individual y se ignoran.
 */
export class ContactLidReconciliationObserver {
    constructor(client: WhatsAppClient, private readonly contactRepository: ContactRepository) {
        client.on('message.status-changed', (_targetId, status, recipient, rawAck) => {
            if (status !== 'acked') return;
            if (rawAck.key.remoteJid && isJidGroup(rawAck.key.remoteJid)) return;

            const jidAlt = extractValidJidAlt(rawAck.key, (raw) =>
                console.log(`[ContactLidReconciliationObserver] jidAlt de device específico descartado (contiene ':'): ${raw}`)
            );
            void this.reconcile(recipient, jidAlt, rawAck.update.pushName ?? null);
        });
    }

    private async reconcile(recipient: RecipientIds, jidAlt: string | null, pushName: string | null): Promise<void> {
        const lidFromAck = jidAlt && isLidUser(jidAlt) ? jidAlt : null;

        const existing = recipient.jid
            ? await this.contactRepository.findByJid(recipient.jid)
            : recipient.lid
              ? await this.contactRepository.findByLid(recipient.lid)
              : null;

        await this.contactRepository.upsert({
            jid: recipient.jid ?? existing?.jid ?? null,
            lid: recipient.lid ?? lidFromAck ?? existing?.lid ?? null,
            pushName,
        });
    }
}
