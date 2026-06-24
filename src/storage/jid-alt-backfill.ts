import { isLidUser, isPnUser } from '@whiskeysockets/baileys';
import { eq, isNotNull, or } from 'drizzle-orm';
import type { AppDatabase } from './database.js';
import { contacts, messages } from './schema.js';

export interface JidAltBackfillResult {
    processed: number;
    updatedAlt: number;
    upsertedContacts: number;
    mergedGroups: number;
    deletedRows: number;
}

interface ResolvedIds {
    jid: string | null;
    lid: string | null;
}

interface WaMessageKey {
    remoteJid?: string;
    remoteJidAlt?: string;
    participant?: string;
    participantAlt?: string;
}

function resolveIds(key: WaMessageKey): ResolvedIds {
    const primary = key.participant || key.remoteJid;
    const alt = key.participantAlt || key.remoteJidAlt;

    const candidates = [primary, alt].filter((id): id is string => !!id);
    const jid = candidates.find((id) => isPnUser(id)) ?? null;
    const lid = candidates.find((id) => isLidUser(id)) ?? null;

    return { jid, lid };
}

/**
 * Recorre los mensajes entrantes que conservan el `rawPayload` de Baileys y
 * completa `remoteJidAlt` (formato alternativo lid <-> s.whatsapp.net) y la
 * tabla `contacts`, para datos guardados antes de que existieran esas columnas.
 */
function backfillFromRawPayload(db: AppDatabase): { processed: number; updatedAlt: number; upsertedContacts: number } {
    const rows = db
        .select({ id: messages.id, rawPayload: messages.rawPayload })
        .from(messages)
        .where(isNotNull(messages.rawPayload))
        .all();

    let processed = 0;
    let updatedAlt = 0;
    let upsertedContacts = 0;

    for (const row of rows) {
        processed++;

        const waMessage = row.rawPayload as { key?: WaMessageKey; pushName?: string } | null;
        const key = waMessage?.key;
        if (!key) continue;

        const { jid, lid } = resolveIds(key);

        const remoteJidAlt = key.participantAlt || key.remoteJidAlt || null;
        if (remoteJidAlt) {
            db.update(messages).set({ remoteJidAlt }).where(eq(messages.id, row.id)).run();
            updatedAlt++;
        }

        if (jid || lid) {
            upsertContact(db, jid, lid, waMessage?.pushName ?? null);
            upsertedContacts++;
        }
    }

    return { processed, updatedAlt, upsertedContacts };
}

function upsertContact(db: AppDatabase, jid: string | null, lid: string | null, pushName: string | null): void {
    if (!jid && !lid) return;

    const conditions = [jid ? eq(contacts.jid, jid) : undefined, lid ? eq(contacts.lid, lid) : undefined].filter(
        (c): c is NonNullable<typeof c> => c !== undefined
    );
    const existing = db.select().from(contacts).where(or(...conditions)).get();

    if (!existing) {
        db.insert(contacts).values({ jid, lid, pushName }).run();
        return;
    }

    if (jid && !existing.jid) db.update(contacts).set({ jid }).where(eq(contacts.id, existing.id)).run();
    if (lid && !existing.lid) db.update(contacts).set({ lid }).where(eq(contacts.id, existing.id)).run();
}

/**
 * Fusiona filas de `contacts` que comparten jid o lid (componentes conectados
 * vía union-find): conserva el id más bajo, completa jid/lid/pushName con el
 * primer valor no nulo del grupo, y borra el resto. Corrige el modelo viejo,
 * donde un mismo contacto podía quedar partido en dos filas (una solo con
 * jid, otra solo con lid) cuando WhatsApp no resolvía ambos formatos a la vez.
 */
function mergeDuplicateContacts(db: AppDatabase): { mergedGroups: number; deletedRows: number } {
    const rows = db.select().from(contacts).all();

    const parent = new Map(rows.map((row) => [row.id, row.id]));
    const find = (id: number): number => {
        while (parent.get(id) !== id) id = parent.get(id)!;
        return id;
    };
    const union = (a: number, b: number): void => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(Math.max(rootA, rootB), Math.min(rootA, rootB));
    };

    const byJid = new Map<string, number>();
    const byLid = new Map<string, number>();
    for (const row of rows) {
        if (row.jid) {
            if (byJid.has(row.jid)) union(row.id, byJid.get(row.jid)!);
            else byJid.set(row.jid, row.id);
        }
        if (row.lid) {
            if (byLid.has(row.lid)) union(row.id, byLid.get(row.lid)!);
            else byLid.set(row.lid, row.id);
        }
    }

    const groups = new Map<number, typeof rows>();
    for (const row of rows) {
        const root = find(row.id);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(row);
    }

    let mergedGroups = 0;
    let deletedRows = 0;

    for (const [rootId, group] of groups) {
        if (group.length === 1) continue;

        const jid = group.find((r) => r.jid)?.jid ?? null;
        const lid = group.find((r) => r.lid)?.lid ?? null;
        const pushName = group.find((r) => r.pushName)?.pushName ?? null;

        db.update(contacts).set({ jid, lid, pushName }).where(eq(contacts.id, rootId)).run();
        for (const row of group) {
            if (row.id !== rootId) {
                db.delete(contacts).where(eq(contacts.id, row.id)).run();
                deletedRows++;
            }
        }
        mergedGroups++;
    }

    return { mergedGroups, deletedRows };
}

/** Idempotente: completa `remoteJidAlt`/`contacts` con datos viejos y fusiona contactos duplicados. */
export function runJidAltBackfill(db: AppDatabase): JidAltBackfillResult {
    const { processed, updatedAlt, upsertedContacts } = backfillFromRawPayload(db);
    const { mergedGroups, deletedRows } = mergeDuplicateContacts(db);

    return { processed, updatedAlt, upsertedContacts, mergedGroups, deletedRows };
}
