import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * Patrón Singleton: la conexión SQLite (envuelta en Drizzle) se abre una
 * sola vez por proceso. Repositorios y otros consumidores piden la
 * instancia vía `getInstance` en lugar de construir su propia conexión.
 *
 * El esquema de tablas se mantiene en `storage/schema.ts`; los archivos SQL
 * de migración (generados con `npx drizzle-kit generate`) viven en
 * `./drizzle` y se aplican automáticamente acá para que un volumen nuevo
 * (p. ej. en Northflank) quede con las tablas creadas sin pasos manuales.
 */
export class DatabaseConnection {
    private static instance: AppDatabase | null = null;
    private static sqlite: Database.Database | null = null;

    private constructor() {}

    static getInstance(dbPath: string): AppDatabase {
        if (!DatabaseConnection.instance) {
            const sqlite = new Database(dbPath);
            sqlite.pragma('journal_mode = WAL');
            sqlite.pragma('wal_autocheckpoint = 100');

            const db = drizzle(sqlite, { schema });
            console.log(`[database] Aplicando migraciones desde ${MIGRATIONS_FOLDER}...`);
            migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
            console.log('[database] Migraciones aplicadas.');

            DatabaseConnection.sqlite = sqlite;
            DatabaseConnection.instance = db;
        }
        return DatabaseConnection.instance;
    }

    static close(): void {
        DatabaseConnection.sqlite?.close();
        DatabaseConnection.sqlite = null;
        DatabaseConnection.instance = null;
    }
}
