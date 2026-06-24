import { isLidUser, isPnUser } from '@whiskeysockets/baileys';
import { Not, IsNull, type DataSource } from 'typeorm';
import { ContactEntity } from './entities/contact.entity.js';
import { MessageEntity } from './entities/message.entity.js';

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
async function backfillFromRawPayload(db: DataSource): Promise<{ processed: number; updatedAlt: number; upsertedContacts: number }> {
    const messageRepo = db.getRepository(MessageEntity);

    const rows = await messageRepo.find({
        select: { id: true, rawPayload: true },
        where: { rawPayload: Not(IsNull()) },
    });

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
            await messageRepo.update(row.id, { remoteJidAlt });
            updatedAlt++;
        }

        if (jid || lid) {
            await upsertContact(db, jid, lid, waMessage?.pushName ?? null);
            upsertedContacts++;
        }
    }

    return { processed, updatedAlt, upsertedContacts };
}

async function upsertContact(db: DataSource, jid: string | null, lid: string | null, pushName: string | null): Promise<void> {
    if (!jid && !lid) return;

    const contactRepo = db.getRepository(ContactEntity);
    const conditions = [jid ? { jid } : undefined, lid ? { lid } : undefined].filter(
        (c): c is NonNullable<typeof c> => c !== undefined
    );
    const existing = await contactRepo.findOne({ where: conditions });

    if (!existing) {
        await contactRepo.insert({ jid, lid, pushName });
        return;
    }

    if (jid && !existing.jid) await contactRepo.update(existing.id, { jid });
    if (lid && !existing.lid) await contactRepo.update(existing.id, { lid });
}

/**
 * Fusiona filas de `contacts` que comparten jid o lid (componentes conectados
 * vía union-find): conserva el id más bajo, completa jid/lid/pushName con el
 * primer valor no nulo del grupo, y borra el resto. Corrige el modelo viejo,
 * donde un mismo contacto podía quedar partido en dos filas (una solo con
 * jid, otra solo con lid) cuando WhatsApp no resolvía ambos formatos a la vez.
 */
async function mergeDuplicateContacts(db: DataSource): Promise<{ mergedGroups: number; deletedRows: number }> {
    const contactRepo = db.getRepository(ContactEntity);
    const rows = await contactRepo.find();

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

        await contactRepo.update(rootId, { jid, lid, pushName });
        for (const row of group) {
            if (row.id !== rootId) {
                await contactRepo.delete(row.id);
                deletedRows++;
            }
        }
        mergedGroups++;
    }

    return { mergedGroups, deletedRows };
}

/** Idempotente: completa `remoteJidAlt`/`contacts` con datos viejos y fusiona contactos duplicados. */
export async function runJidAltBackfill(db: DataSource): Promise<JidAltBackfillResult> {
    console.log('[jid-alt-backfill] Iniciando backfill de jid/lid y fusión de contactos...');

    const { processed, updatedAlt, upsertedContacts } = await backfillFromRawPayload(db);
    const { mergedGroups, deletedRows } = await mergeDuplicateContacts(db);

    console.log(
        `[jid-alt-backfill] Completado: ${processed} mensajes procesados, ${updatedAlt} remoteJidAlt actualizados, ` +
            `${upsertedContacts} contactos creados/actualizados, ${mergedGroups} grupos fusionados, ${deletedRows} filas duplicadas eliminadas.`
    );

    return { processed, updatedAlt, upsertedContacts, mergedGroups, deletedRows };
}
