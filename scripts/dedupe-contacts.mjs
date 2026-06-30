import Database from 'better-sqlite3';

/**
 * Fusiona filas duplicadas de `contacts` generadas por la carrera en
 * ContactRepository.upsert (ver fix en src/storage/contact.repository.ts):
 * varios mensajes casi simultáneos de un contacto sin fila todavía podían
 * insertar más de una vez para el mismo jid o el mismo lid.
 *
 * Para cada grupo de filas que comparte jid (no nulo) o lid (no nulo), se
 * queda con la más antigua (menor first_seen_at) y le completa el jid/lid/
 * push_name que falte tomándolo de las duplicadas, antes de borrarlas.
 * No hay otras tablas con FK a contacts.id (messages guarda remoteJid como
 * texto), así que no hace falta reasignar referencias.
 */
const DB_PATH = process.env.DB_PATH ?? './data/messages.db';
const DRY_RUN = process.argv.includes('--dry-run');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function mergeGroups(column) {
    const rows = db
        .prepare(
            `SELECT id, jid, lid, push_name, first_seen_at FROM contacts WHERE ${column} IS NOT NULL ORDER BY ${column}, first_seen_at ASC, id ASC`
        )
        .all();

    const groups = new Map();
    for (const row of rows) {
        const key = row[column];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    const other = column === 'lid' ? 'jid' : 'lid';
    let merged = 0;
    for (const [key, group] of groups) {
        if (group.length < 2) continue;

        const otherValues = new Set(group.map((r) => r[other]).filter((v) => v != null));
        if (otherValues.size > 1) {
            console.warn(
                `[dedupe-contacts] ${column}=${key}: ids ${group.map((r) => r.id).join(',')} comparten ${column} pero tienen ${other} distintos (${[...otherValues].join(', ')}) — conflicto real, no se fusiona`
            );
            continue;
        }

        const [keep, ...dupes] = group;
        const changes = {};
        for (const dupe of dupes) {
            if (dupe.jid && !keep.jid && !changes.jid) changes.jid = dupe.jid;
            if (dupe.lid && !keep.lid && !changes.lid) changes.lid = dupe.lid;
            if (dupe.push_name && !keep.push_name && !changes.push_name) changes.push_name = dupe.push_name;
        }

        const dupeIds = dupes.map((d) => d.id);
        console.log(
            `[dedupe-contacts] ${column}=${key}: conservo id=${keep.id}, elimino id=${dupeIds.join(',')}` +
                (Object.keys(changes).length ? ` (completo ${JSON.stringify(changes)})` : '')
        );

        if (!DRY_RUN) {
            if (Object.keys(changes).length > 0) {
                const setClause = Object.keys(changes)
                    .map((c) => `${c} = @${c}`)
                    .join(', ');
                db.prepare(`UPDATE contacts SET ${setClause} WHERE id = @id`).run({ ...changes, id: keep.id });
            }
            db.prepare(`DELETE FROM contacts WHERE id IN (${dupeIds.map(() => '?').join(',')})`).run(...dupeIds);
        }

        merged += dupeIds.length;
    }

    return merged;
}

const mergedByLid = mergeGroups('lid');
const mergedByJid = mergeGroups('jid');

console.log(
    `[dedupe-contacts] ${DRY_RUN ? '(dry-run) ' : ''}filas fusionadas por lid: ${mergedByLid}, por jid: ${mergedByJid}`
);

db.close();
