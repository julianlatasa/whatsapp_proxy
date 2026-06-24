import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import { BlockedContactEntity } from './entities/blocked-contact.entity.js';
import { ContactEntity } from './entities/contact.entity.js';
import { MessageEntity } from './entities/message.entity.js';

export type AppDatabase = DataSource;

const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Patrón Singleton: la conexión SQLite (envuelta en TypeORM) se abre una
 * sola vez por proceso. Repositorios y otros consumidores piden la
 * instancia vía `getInstance` en lugar de construir su propia conexión.
 *
 * Las entidades viven en `storage/entities/*.entity.ts`; las migraciones
 * (generadas con `npm run migration:generate`) viven en `./migrations` y se
 * aplican automáticamente acá para que un volumen nuevo (p. ej. en
 * Northflank) quede con las tablas creadas sin pasos manuales.
 */
export class DatabaseConnection {
    private static instance: DataSource | null = null;

    private constructor() {}

    static async getInstance(dbPath: string): Promise<DataSource> {
        if (!DatabaseConnection.instance) {
            mkdirSync(dirname(dbPath), { recursive: true });

            const dataSource = new DataSource({
                type: 'better-sqlite3',
                database: dbPath,
                entities: [MessageEntity, ContactEntity, BlockedContactEntity],
                migrations: [join(MIGRATIONS_FOLDER, '*.js')],
            });

            await dataSource.initialize();
            await dataSource.query('PRAGMA journal_mode = WAL');
            await dataSource.query('PRAGMA wal_autocheckpoint = 100');

            console.log(`[database] Aplicando migraciones desde ${MIGRATIONS_FOLDER}...`);
            await dataSource.runMigrations();
            console.log('[database] Migraciones aplicadas.');

            DatabaseConnection.instance = dataSource;
        }
        return DatabaseConnection.instance;
    }

    static async close(): Promise<void> {
        await DatabaseConnection.instance?.destroy();
        DatabaseConnection.instance = null;
    }
}
