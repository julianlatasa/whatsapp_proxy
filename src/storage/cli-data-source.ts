import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { BlockedContactEntity } from './entities/blocked-contact.entity.js';
import { ContactEntity } from './entities/contact.entity.js';
import { MessageEntity } from './entities/message.entity.js';

/** DataSource standalone para el CLI de TypeORM (`migration:generate`/`migration:run`), separado del runtime de la app. */
export default new DataSource({
    type: 'better-sqlite3',
    database: process.env.DB_PATH ?? './data/messages.db',
    entities: [MessageEntity, ContactEntity, BlockedContactEntity],
    migrations: ['src/storage/migrations/*.ts'],
});
