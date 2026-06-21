import { isJidGroup, proto, type WAMessage } from '@whiskeysockets/baileys';
import type { CreateMessageInput, MessageType } from '../types/message.types.js';
import { CONTENT_STRATEGIES, findQuotedMessageId, unwrapMessage } from './content-strategies.js';

/** Únicos tipos de mensaje entrante que se persisten (ver MessageParser.parse). */
const ALLOWED_INBOUND_TYPES: ReadonlySet<MessageType> = new Set([
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'audioMessage',
]);

export interface DeleteEvent {
    kind: 'delete';
    targetId: string;
}

export interface EditEvent {
    kind: 'edit';
    targetId: string;
    newText: string | null;
}

export type ProtocolEvent = DeleteEvent | EditEvent;

const STUB_TYPE_LABELS: Partial<Record<proto.WebMessageInfo.StubType, string>> = {
    [proto.WebMessageInfo.StubType.GROUP_CREATE]: 'Grupo creado',
    [proto.WebMessageInfo.StubType.GROUP_CHANGE_SUBJECT]: 'Nombre del grupo cambiado',
    [proto.WebMessageInfo.StubType.GROUP_CHANGE_ICON]: 'Foto del grupo cambiada',
    [proto.WebMessageInfo.StubType.GROUP_CHANGE_DESCRIPTION]: 'Descripción del grupo cambiada',
    [proto.WebMessageInfo.StubType.GROUP_PARTICIPANT_ADD]: 'Participante agregado al grupo',
    [proto.WebMessageInfo.StubType.GROUP_PARTICIPANT_REMOVE]: 'Participante eliminado del grupo',
    [proto.WebMessageInfo.StubType.GROUP_PARTICIPANT_LEAVE]: 'Participante salió del grupo',
    [proto.WebMessageInfo.StubType.GROUP_PARTICIPANT_PROMOTE]: 'Participante promovido a admin',
    [proto.WebMessageInfo.StubType.GROUP_PARTICIPANT_DEMOTE]: 'Participante degradado de admin',
};

/** Convierte un WAMessage de Baileys al formato normalizado de la tabla `messages`. */
export class MessageParser {
    /** Mensajes de contenido normal (texto, multimedia, interactivos, etc.). */
    parse(waMessage: WAMessage): CreateMessageInput | null {
        const { key, message, messageTimestamp, pushName } = waMessage;
        if (!message || !key.remoteJid || !key.id) return null;
        if (message.protocolMessage) return null;

        const unwrapped = unwrapMessage(message);
        const extracted = this.extractContent(unwrapped);
        if (!extracted) return null;

        const fromMe = key.fromMe ?? false;

        // Los mensajes entrantes solo se guardan si son de un chat 1-a-1 y de
        // un tipo permitido; los salientes (fromMe) se guardan siempre.
        if (!fromMe) {
            if (isJidGroup(key.remoteJid)) return null;
            if (!ALLOWED_INBOUND_TYPES.has(extracted.messageType)) return null;
        }

        const timestamp = messageTimestamp ? Number(messageTimestamp) * 1_000 : Date.now();

        return {
            id: key.id,
            remoteJid: key.remoteJid,
            fromMe,
            participant: key.participant ?? null,
            pushName: pushName ?? null,
            messageTimestamp: timestamp,
            messageType: extracted.messageType,
            textContent: extracted.textContent,
            mediaMimetype: extracted.mediaMimetype,
            mediaUrl: extracted.mediaUrl,
            quotedMessageId: findQuotedMessageId(unwrapped),
            rawPayload: waMessage,
            isDeleted: false,
            isEdited: false,
            status: fromMe ? 'sent' : 'received',
            statusTimestamp: timestamp,
        };
    }

    /** Eventos de borrado (REVOKE) o edición (MESSAGE_EDIT) sobre un mensaje ya guardado. */
    parseProtocolEvent(waMessage: WAMessage): ProtocolEvent | null {
        const protocolMessage = waMessage.message?.protocolMessage;
        const targetId = protocolMessage?.key?.id;
        if (!protocolMessage || !targetId) return null;

        if (protocolMessage.type === proto.Message.ProtocolMessage.Type.REVOKE) {
            return { kind: 'delete', targetId };
        }

        if (protocolMessage.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
            const editedMessage = protocolMessage.editedMessage;
            const newText = editedMessage ? this.extractContent(unwrapMessage(editedMessage))?.textContent ?? null : null;
            return { kind: 'edit', targetId, newText };
        }

        return null;
    }

    /** Eventos administrativos de grupo (sin `.message`, solo `messageStubType`). */
    parseStub(waMessage: WAMessage): CreateMessageInput | null {
        const { key, messageStubType, messageStubParameters, messageTimestamp, pushName } = waMessage;
        if (waMessage.message || messageStubType == null || !key.remoteJid || !key.id) return null;

        const label = STUB_TYPE_LABELS[messageStubType] ?? `Evento de grupo (tipo ${messageStubType})`;
        const textContent = messageStubParameters?.length ? `${label}: ${messageStubParameters.join(', ')}` : label;
        const timestamp = messageTimestamp ? Number(messageTimestamp) * 1_000 : Date.now();

        return {
            id: key.id,
            remoteJid: key.remoteJid,
            fromMe: key.fromMe ?? false,
            participant: key.participant ?? null,
            pushName: pushName ?? null,
            messageTimestamp: timestamp,
            messageType: 'groupStub',
            textContent,
            mediaMimetype: null,
            mediaUrl: null,
            quotedMessageId: null,
            rawPayload: waMessage,
            isDeleted: false,
            isEdited: false,
            status: 'received',
            statusTimestamp: timestamp,
        };
    }

    private extractContent(message: proto.IMessage) {
        for (const strategy of CONTENT_STRATEGIES) {
            const result = strategy(message);
            if (result) return result;
        }
        return null;
    }
}
