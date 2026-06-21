import type { ContactRepository } from '../storage/contact.repository.js';
import type { WhatsAppClient } from '../whatsapp/whatsapp.client.js';

/** Observer que registra cada contacto visto y mantiene su pushName al día. */
export class ContactRegistryObserver {
    constructor(client: WhatsAppClient, private readonly repository: ContactRepository) {
        client.on('contact.seen', (contact) => {
            this.repository.upsert(contact);
        });

        client.on('contact.lid-resolved', (mapping) => {
            this.repository.updateLid(mapping.pn, mapping.lid);
        });
    }
}
