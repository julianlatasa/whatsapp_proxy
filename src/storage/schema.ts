import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Fuente de verdad de los literales de `messageType`/`status` — `message.types.ts` los deriva de acá. */
export const MESSAGE_TYPES = [
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'reactionMessage',
    'buttonsResponseMessage',
    'listResponseMessage',
    'contactMessage',
    'pollCreationMessage',
    'groupStub',
    'unknown',
] as const;

export const MESSAGE_STATUSES = ['pending', 'sent', 'received', 'pushed', 'acked'] as const;

const epochMs = sql`(unixepoch('now','subsec') * 1000)`;

export const messages = sqliteTable(
    'messages',
    {
        id: text('id').primaryKey(),
        remoteJid: text('remote_jid').notNull(),
        /** Formato alternativo de `remoteJid` (lid <-> s.whatsapp.net) cuando Baileys lo expone en `key.remoteJidAlt`. */
        remoteJidAlt: text('remote_jid_alt'),
        fromMe: integer('from_me', { mode: 'boolean' }).notNull().default(false),
        participant: text('participant'),

        pushName: text('push_name'),
        messageTimestamp: integer('message_timestamp').notNull(),

        messageType: text('message_type', { enum: MESSAGE_TYPES }).notNull(),
        textContent: text('text_content'),

        mediaMimetype: text('media_mimetype'),
        mediaUrl: text('media_url'),

        quotedMessageId: text('quoted_message_id'),

        rawPayload: text('raw_payload', { mode: 'json' }),
        /** Raw de `{key, update}` del evento `messages.update` cuando `update.status === SERVER_ACK`. */
        jsonAck: text('json_ack', { mode: 'json' }),

        isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
        isEdited: integer('is_edited', { mode: 'boolean' }).notNull().default(false),

        status: text('status', { enum: MESSAGE_STATUSES }).notNull().default('received'),
        statusTimestamp: integer('status_timestamp').notNull().default(epochMs),

        createdAt: integer('created_at').notNull().default(epochMs),
    },
    (table) => [index('idx_messages_remote_jid').on(table.remoteJid), index('idx_messages_from_me').on(table.fromMe)]
);

export const contacts = sqliteTable(
    'contacts',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        jid: text('jid'),
        lid: text('lid'),
        pushName: text('push_name'),
        firstSeenAt: integer('first_seen_at').notNull().default(epochMs),
    },
    (table) => [index('idx_contacts_jid').on(table.jid), index('idx_contacts_lid').on(table.lid)]
);

/** Contactos bloqueados: el remitente puede identificarse por `jid` (s.whatsapp.net) y/o `lid`. */
export const blockedContacts = sqliteTable(
    'blocked_contacts',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        jid: text('jid'),
        lid: text('lid'),
        blockedAt: integer('blocked_at').notNull().default(epochMs),
    },
    (table) => [index('idx_blocked_contacts_jid').on(table.jid), index('idx_blocked_contacts_lid').on(table.lid)]
);
