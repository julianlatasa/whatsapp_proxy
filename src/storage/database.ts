import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/**
 * Patrón Singleton: la conexión SQLite (envuelta en Drizzle) se abre una
 * sola vez por proceso. Repositorios y otros consumidores piden la
 * instancia vía `getInstance` en lugar de construir su propia conexión.
 *
 * El esquema de tablas se aplica con `npm run db:push` (drizzle-kit), no
 * embebido en el código — ver `drizzle.config.ts` y `storage/schema.ts`.
 */
export class DatabaseConnection {
    private static instance: AppDatabase | null = null;
    private static sqlite: Database.Database | null = null;

    private constructor() {}

    static getInstance(dbPath: string): AppDatabase {
        if (!DatabaseConnection.instance) {
            const sqlite = new Database(dbPath);
            sqlite.pragma('journal_mode = WAL');

            DatabaseConnection.sqlite = sqlite;
            DatabaseConnection.instance = drizzle(sqlite, { schema });
        }
        return DatabaseConnection.instance;
    }

    static close(): void {
        DatabaseConnection.sqlite?.close();
        DatabaseConnection.sqlite = null;
        DatabaseConnection.instance = null;
    }
}
