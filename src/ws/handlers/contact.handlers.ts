import type { ContactRepository } from '../../storage/contact.repository.js';
import type { ClientResponsePayloads } from '../protocol.js';

export interface ContactHandlerDeps {
    contactRepository: ContactRepository;
}

export async function handleContactLookupByJid(deps: ContactHandlerDeps, payload: { jid: string }): Promise<ClientResponsePayloads['contact.lookup-by-jid']> {
    return deps.contactRepository.findByJid(payload.jid);
}

export async function handleContactLookupByLid(deps: ContactHandlerDeps, payload: { lid: string }): Promise<ClientResponsePayloads['contact.lookup-by-lid']> {
    return deps.contactRepository.findByLid(payload.lid);
}
