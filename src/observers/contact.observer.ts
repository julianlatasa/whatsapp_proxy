import { isJidGroup, isLidUser, isPnUser } from '@whiskeysockets/baileys';
import type { ContactRepository } from '../storage/contact.repository.js';
import type { MessageRepository } from '../storage/message.repository.js';
import { extractValidJidAlt, isDeviceSpecificJid } from '../whatsapp/jid.utils.js';
import type { WhatsAppClient } from '../whatsapp/whatsapp.client.js';

/**
 * Centraliza toda la lógica de guardar y actualizar contactos:
 *
 * - contact.seen        → upsert completo (jid + lid + pushName)
 * - contact.lid-resolved → completa el lid de un contacto ya conocido por jid
 *   (o crea la fila si todavía no existe)
 * - message.status-changed (acked, 1-a-1) → upsert con jid + lid descubierto
 *   en el jidAlt del ack + pushName; si hay lid, busca el mensaje original
 *   para reconciliar el contacto guardado solo con jid.
 */
export class ContactObserver {
    constructor(
        client: WhatsAppClient,
        private readonly repo: ContactRepository,
        private readonly messages: MessageRepository,
    ) {
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
                console.log(`[CONTACT][proxy] jidAlt de device específico descartado (contiene ':'): ${raw}`)
            );
            const remoteJid = rawAck.key.remoteJid ?? null;
            const lidFromAck =
                (jidAlt && isLidUser(jidAlt) ? jidAlt : null) ??
                (remoteJid && isLidUser(remoteJid) && !isDeviceSpecificJid(remoteJid) ? remoteJid : null);

            console.log(`[CONTACT][proxy] ACK procesado — messageId=${_targetId} remoteJid=${remoteJid} jidAlt=${jidAlt} lidFromAck=${lidFromAck} recipient.jid=${recipient.jid} recipient.lid=${recipient.lid}`);

            if (lidFromAck) {
                void this.messages.findById(_targetId).then((msg) => {
                    if (!msg) {
                        console.log(`[CONTACT][proxy] Mensaje id=${_targetId} no encontrado en repo — no se puede reconciliar jid/lid`);
                        return;
                    }
                    const candidates = [msg.remoteJid, msg.remoteJidAlt].filter(
                        (id): id is string => !!id && !!isPnUser(id),
                    );
                    console.log(`[CONTACT][proxy] Reconciliando lid=${lidFromAck} con pn candidates=${JSON.stringify(candidates)}`);
                    for (const pn of candidates) {
                        void this.repo.upsertLid(pn, lidFromAck).then((updated) => {
                            console.log(`[CONTACT][proxy] upsertLid(pn=${pn}, lid=${lidFromAck}) → updated=${updated}`);
                        });
                    }
                });
            } else {
                console.log(`[CONTACT][proxy] ACK sin lid — no se puede reconciliar (messageId=${_targetId})`);
            }

            void this.repo.upsert({
                jid: recipient.jid ?? null,
                lid: recipient.lid ?? lidFromAck ?? null,
                pushName: rawAck.update.pushName ?? null,
            });
        });
    }
}
