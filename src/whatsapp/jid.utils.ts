import { isLidUser, isPnUser, jidNormalizedUser, type BaileysEventMap } from '@whiskeysockets/baileys';

export interface ResolvedIds {
    jid: string | null;
    lid: string | null;
}

type MessageKey = BaileysEventMap['messages.upsert']['messages'][number]['key'];

/**
 * El remitente de un WAMessage puede venir como jid (`s.whatsapp.net`) o
 * como lid según `addressingMode`; Baileys expone el otro formato en el
 * campo `*Alt`. En grupos el remitente es `participant`, no `remoteJid`.
 */
export function resolveSenderIds(key: MessageKey): ResolvedIds {
    const primary = key.participant ?? key.remoteJid;
    const alt = key.participantAlt ?? key.remoteJidAlt;

    const candidates = [primary, alt].filter((id): id is string => !!id);
    const jid = candidates.find((id) => isPnUser(id)) ?? null;
    const lid = candidates.find((id) => isLidUser(id)) ?? null;

    return { jid: jid ? jidNormalizedUser(jid) : null, lid: lid ? jidNormalizedUser(lid) : null };
}

/**
 * WhatsApp incluye el device id en el `*Alt` de algunos acks (formato
 * `numero:device@lid`); ese lid "por dispositivo" no identifica al contacto
 * de forma estable y no debe guardarse ni usarse para reconciliar `contacts`.
 */
export function isDeviceSpecificJid(jid: string): boolean {
    return jid.includes(':');
}

type AckKey = { participantAlt?: string | null; remoteJidAlt?: string | null };

/**
 * `jidAlt` de un ack de envío/entrega: `null` si no vino o si es un id
 * por-dispositivo (ver `isDeviceSpecificJid`). `onDiscarded` permite loguear
 * el descarte sin acoplar esta función a un logger concreto.
 */
export function extractValidJidAlt(key: AckKey, onDiscarded?: (rawJidAlt: string) => void): string | null {
    const rawJidAlt = key.participantAlt ?? key.remoteJidAlt ?? null;
    if (!rawJidAlt) return null;

    if (isDeviceSpecificJid(rawJidAlt)) {
        onDiscarded?.(rawJidAlt);
        return null;
    }

    return rawJidAlt;
}
