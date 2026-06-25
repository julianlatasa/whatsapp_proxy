import type { WhatsAppClient } from '../../whatsapp/whatsapp.client.js';
import type { ClientResponsePayloads } from '../protocol.js';

export interface ConnectionHandlerDeps {
    client: WhatsAppClient;
    logout: () => Promise<void>;
}

export function handleConnectionStatusGet(deps: ConnectionHandlerDeps): ClientResponsePayloads['connection.status.get'] {
    return { status: deps.client.getStatus() };
}

export function handleQrGet(deps: ConnectionHandlerDeps): ClientResponsePayloads['qr.get'] {
    return { qr: deps.client.getLastQr() };
}

export async function handleQrRefresh(deps: ConnectionHandlerDeps): Promise<ClientResponsePayloads['qr.refresh']> {
    await deps.client.requestFreshQr();
    return { ok: true };
}

export async function handleSessionLogout(deps: ConnectionHandlerDeps): Promise<ClientResponsePayloads['session.logout']> {
    await deps.logout();
    return { ok: true };
}
