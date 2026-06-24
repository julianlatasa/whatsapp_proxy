import 'reflect-metadata';
import { DatabaseConnection } from '../dist/storage/database.js';
import { runJidAltBackfill } from '../dist/storage/jid-alt-backfill.js';

const DB_PATH = process.env.DB_PATH ?? './data/messages.db';

const db = await DatabaseConnection.getInstance(DB_PATH);
const result = await runJidAltBackfill(db);

console.log(`Mensajes con raw_payload procesados: ${result.processed}`);
console.log(`Mensajes con remote_jid_alt actualizado: ${result.updatedAlt}`);
console.log(`Contactos creados/actualizados: ${result.upsertedContacts}`);
console.log(`Grupos de contactos duplicados fusionados: ${result.mergedGroups}`);
console.log(`Filas de contactos eliminadas por duplicado: ${result.deletedRows}`);

await DatabaseConnection.close();
