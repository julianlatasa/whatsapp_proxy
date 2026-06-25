import type { BlockedContactRepository } from '../../storage/blocked-contact.repository.js';
import type { BlockContactPayload, ClientResponsePayloads } from '../protocol.js';

export interface BlockedContactHandlerDeps {
    blockedContactRepository: BlockedContactRepository;
}

export async function handleBlockedAdd(deps: BlockedContactHandlerDeps, payload: BlockContactPayload): Promise<ClientResponsePayloads['blocked.add']> {
    return deps.blockedContactRepository.block({ jid: payload.jid, lid: payload.lid });
}

export async function handleBlockedRemove(deps: BlockedContactHandlerDeps, payload: BlockContactPayload): Promise<ClientResponsePayloads['blocked.remove']> {
    await deps.blockedContactRepository.unblock(payload.jid, payload.lid);
    return { ok: true };
}

export async function handleBlockedList(deps: BlockedContactHandlerDeps): Promise<ClientResponsePayloads['blocked.list']> {
    return deps.blockedContactRepository.list();
}
