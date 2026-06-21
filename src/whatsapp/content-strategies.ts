import type { proto } from '@whiskeysockets/baileys';
import type { MessageType } from '../types/message.types.js';

export interface ExtractedContent {
    messageType: MessageType;
    textContent: string | null;
    mediaMimetype: string | null;
    mediaUrl: string | null;
}

/**
 * Patrón Strategy: cada tipo de mensaje de Baileys tiene su propia
 * estrategia de extracción. Agregar un tipo nuevo solo requiere sumar una
 * entrada aquí, sin tocar el resto del parser.
 */
export type ContentStrategy = (message: proto.IMessage) => ExtractedContent | null;

export const CONTENT_STRATEGIES: readonly ContentStrategy[] = [
    (message) =>
        message.conversation != null
            ? { messageType: 'conversation', textContent: message.conversation, mediaMimetype: null, mediaUrl: null }
            : null,

    (message) =>
        message.extendedTextMessage
            ? {
                  messageType: 'extendedTextMessage',
                  textContent: message.extendedTextMessage.text ?? null,
                  mediaMimetype: null,
                  mediaUrl: null,
              }
            : null,

    (message) =>
        message.imageMessage
            ? {
                  messageType: 'imageMessage',
                  textContent: message.imageMessage.caption ?? null,
                  mediaMimetype: message.imageMessage.mimetype ?? null,
                  mediaUrl: message.imageMessage.url ?? null,
              }
            : null,

    (message) =>
        message.videoMessage
            ? {
                  messageType: 'videoMessage',
                  textContent: message.videoMessage.caption ?? null,
                  mediaMimetype: message.videoMessage.mimetype ?? null,
                  mediaUrl: message.videoMessage.url ?? null,
              }
            : null,

    (message) =>
        message.audioMessage
            ? {
                  messageType: 'audioMessage',
                  textContent: null,
                  mediaMimetype: message.audioMessage.mimetype ?? null,
                  mediaUrl: message.audioMessage.url ?? null,
              }
            : null,

    (message) =>
        message.documentMessage
            ? {
                  messageType: 'documentMessage',
                  textContent: message.documentMessage.caption ?? null,
                  mediaMimetype: message.documentMessage.mimetype ?? null,
                  mediaUrl: message.documentMessage.url ?? null,
              }
            : null,

    (message) =>
        message.stickerMessage
            ? {
                  messageType: 'stickerMessage',
                  textContent: null,
                  mediaMimetype: message.stickerMessage.mimetype ?? null,
                  mediaUrl: message.stickerMessage.url ?? null,
              }
            : null,

    (message) =>
        message.reactionMessage
            ? {
                  messageType: 'reactionMessage',
                  textContent: message.reactionMessage.text ?? null,
                  mediaMimetype: null,
                  mediaUrl: null,
              }
            : null,

    (message) =>
        message.buttonsResponseMessage
            ? {
                  messageType: 'buttonsResponseMessage',
                  textContent:
                      message.buttonsResponseMessage.selectedDisplayText ??
                      message.buttonsResponseMessage.selectedButtonId ??
                      null,
                  mediaMimetype: null,
                  mediaUrl: null,
              }
            : null,

    (message) =>
        message.listResponseMessage
            ? {
                  messageType: 'listResponseMessage',
                  textContent:
                      message.listResponseMessage.title ??
                      message.listResponseMessage.singleSelectReply?.selectedRowId ??
                      null,
                  mediaMimetype: null,
                  mediaUrl: null,
              }
            : null,

    (message) =>
        message.contactMessage
            ? {
                  messageType: 'contactMessage',
                  textContent: message.contactMessage.displayName ?? null,
                  mediaMimetype: null,
                  mediaUrl: null,
              }
            : null,

    (message) =>
        message.pollCreationMessage
            ? {
                  messageType: 'pollCreationMessage',
                  textContent: formatPoll(message.pollCreationMessage),
                  mediaMimetype: null,
                  mediaUrl: null,
              }
            : null,
];

function formatPoll(poll: proto.Message.IPollCreationMessage): string | null {
    if (!poll.name) return null;
    const options = (poll.options ?? []).map((option) => option.optionName).filter(Boolean);
    return options.length > 0 ? `${poll.name} [${options.join(', ')}]` : poll.name;
}

/**
 * Desenvuelve recursivamente wrappers que no son contenido en sí mismos
 * (efímeros, ver-una-vez) hasta llegar al `proto.IMessage` real.
 */
export function unwrapMessage(message: proto.IMessage): proto.IMessage {
    const inner = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message;
    return inner ? unwrapMessage(inner) : message;
}

const QUOTED_ID_LOOKUPS: ReadonlyArray<(message: proto.IMessage) => string | null | undefined> = [
    (m) => m.extendedTextMessage?.contextInfo?.stanzaId,
    (m) => m.imageMessage?.contextInfo?.stanzaId,
    (m) => m.videoMessage?.contextInfo?.stanzaId,
    (m) => m.audioMessage?.contextInfo?.stanzaId,
    (m) => m.documentMessage?.contextInfo?.stanzaId,
    (m) => m.buttonsResponseMessage?.contextInfo?.stanzaId,
    (m) => m.listResponseMessage?.contextInfo?.stanzaId,
    (m) => m.reactionMessage?.key?.id,
];

export function findQuotedMessageId(message: proto.IMessage): string | null {
    for (const lookup of QUOTED_ID_LOOKUPS) {
        const id = lookup(message);
        if (id) return id;
    }
    return null;
}
