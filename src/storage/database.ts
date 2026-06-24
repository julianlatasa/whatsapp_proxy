import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DataSource } from 'typeorm';
import { BlockedContactEntity } from './entities/blocked-contact.entity.js';
import { ContactEntity } from './entities/contact.entity.js';
import { MessageEntity } from './entities/message.entity.js';

export type AppDatabase = DataSource;

const ENTITIES = [MessageEntity, ContactEntity, BlockedContactEntity];

/**
 * Patrón Singleton: la conexión SQLite (envuelta en TypeORM) se abre una
 * sola vez por proceso. Repositorios y otros consumidores piden la
 * instancia vía `getInstance` en lugar de construir su propia conexión.
 *
 * Las entidades viven en `storage/entities/*.entity.ts`. No hay migraciones:
 * el esquema se sincroniza automáticamente (`synchronize`) solo la primera
 * vez, cuando la base de datos está vacía, para que un volumen nuevo (p. ej.
 * en Northflank) quede con las tablas creadas sin pasos manuales. Si las
 * tablas ya existen no se vuelve a tocar el esquema, para no arriesgar los
 * datos ya guardados ante un cambio futuro en las entidades.
 */
export class DatabaseConnection {
    private static instance: DataSource | null = null;

    private constructor() {}

    static async getInstance(dbPath: string): Promise<DataSource> {
        if (!DatabaseConnection.instance) {
            mkdirSync(dirname(dbPath), { recursive: true });

            const probe = new DataSource({ type: 'better-sqlite3', database: dbPath, entities: ENTITIES });
            await probe.initialize();
            const hasTables = (await probe.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'")).length > 0;
            await probe.destroy();

            const dataSource = new DataSource({
                type: 'better-sqlite3',
                database: dbPath,
                entities: ENTITIES,
                synchronize: !hasTables,
            });

            await dataSource.initialize();
            await dataSource.query('PRAGMA journal_mode = WAL');
            await dataSource.query('PRAGMA wal_autocheckpoint = 100');

            if (!hasTables) {
                console.log('[database] Base de datos vacía: esquema sincronizado desde las entidades.');
            }

            DatabaseConnection.instance = dataSource;
        }
        return DatabaseConnection.instance;
    }

    static async close(): Promise<void> {
        await DatabaseConnection.instance?.destroy();
        DatabaseConnection.instance = null;
    }
}
