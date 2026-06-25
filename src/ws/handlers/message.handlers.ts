import type { AckTracker } from '../ack-tracker.js';
import { MessageFactory } from '../../patterns/message.factory.js';
import type { MessageRepository } from '../../storage/message.repository.js';
import type { WhatsAppClient } from '../../whatsapp/whatsapp.client.js';
import type { ClientResponsePayloads } from '../protocol.js';

export interface MessageHandlerDeps {
    client: WhatsAppClient;
    messageRepository: MessageRepository;
    ackTracker: AckTracker;
}

export async function handleMessageAck(deps: MessageHandlerDeps, payload: { id: string }): Promise<ClientResponsePayloads['message.ack']> {
    deps.ackTracker.ack(payload.id);
    await deps.messageRepository.markAcked(payload.id);
    return { ok: true };
}

export async function handleSendMessage(
    deps: MessageHandlerDeps,
    requestId: string,
    payload: { jid: string; text: string }
): Promise<ClientResponsePayloads['send.message']> {
    const draft = MessageFactory.createOutboundText(payload.jid, payload.text, requestId);
    await deps.messageRepository.save(draft);

    const sent = await deps.client.sendText(payload.jid, payload.text, draft.id);
    const finalId = sent?.key?.id ?? draft.id;
    console.log(`[ws.server] Mensaje enviado: draft.id=${draft.id} sent.key.id=${sent?.key?.id ?? '(sin respuesta)'} -> finalId=${finalId}`);
    if (finalId !== draft.id) {
        console.warn(`[ws.server] WhatsApp devolvió un id distinto al forzado: draft=${draft.id} final=${finalId}`);
    }
    await deps.messageRepository.markSent(draft.id, finalId, sent ?? null);
    console.log(`[ws.server] Mensaje persistido en DB con id=${finalId} (status=sent).`);

    const saved = await deps.messageRepository.findById(finalId);
    if (!saved) throw new Error(`No se pudo persistir el mensaje enviado: ${draft.id}`);
    return saved;
}
