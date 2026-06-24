import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1782315776173 implements MigrationInterface {
    name = 'InitialSchema1782315776173'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_blocked_contacts_lid"`);
        await queryRunner.query(`DROP INDEX "idx_blocked_contacts_jid"`);
        await queryRunner.query(`CREATE TABLE "temporary_blocked_contacts" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jid" text, "lid" text, "blocked_at" integer NOT NULL DEFAULT ((unixepoch('now','subsec') * 1000)))`);
        await queryRunner.query(`INSERT INTO "temporary_blocked_contacts"("id", "jid", "lid", "blocked_at") SELECT "id", "jid", "lid", "blocked_at" FROM "blocked_contacts"`);
        await queryRunner.query(`DROP TABLE "blocked_contacts"`);
        await queryRunner.query(`ALTER TABLE "temporary_blocked_contacts" RENAME TO "blocked_contacts"`);
        await queryRunner.query(`CREATE INDEX "idx_blocked_contacts_lid" ON "blocked_contacts" ("lid") `);
        await queryRunner.query(`CREATE INDEX "idx_blocked_contacts_jid" ON "blocked_contacts" ("jid") `);
        await queryRunner.query(`DROP INDEX "idx_contacts_lid"`);
        await queryRunner.query(`DROP INDEX "idx_contacts_jid"`);
        await queryRunner.query(`CREATE TABLE "temporary_contacts" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jid" text, "lid" text, "push_name" text, "first_seen_at" integer NOT NULL DEFAULT ((unixepoch('now','subsec') * 1000)))`);
        await queryRunner.query(`INSERT INTO "temporary_contacts"("id", "jid", "lid", "push_name", "first_seen_at") SELECT "id", "jid", "lid", "push_name", "first_seen_at" FROM "contacts"`);
        await queryRunner.query(`DROP TABLE "contacts"`);
        await queryRunner.query(`ALTER TABLE "temporary_contacts" RENAME TO "contacts"`);
        await queryRunner.query(`CREATE INDEX "idx_contacts_lid" ON "contacts" ("lid") `);
        await queryRunner.query(`CREATE INDEX "idx_contacts_jid" ON "contacts" ("jid") `);
        await queryRunner.query(`DROP INDEX "idx_messages_from_me"`);
        await queryRunner.query(`DROP INDEX "idx_messages_remote_jid"`);
        await queryRunner.query(`CREATE TABLE "temporary_messages" ("id" text PRIMARY KEY NOT NULL, "remote_jid" text NOT NULL, "from_me" boolean NOT NULL DEFAULT (0), "participant" text, "push_name" text, "message_timestamp" integer NOT NULL, "message_type" text NOT NULL, "text_content" text, "media_mimetype" text, "media_url" text, "quoted_message_id" text, "raw_payload" text, "is_deleted" boolean NOT NULL DEFAULT (0), "is_edited" boolean NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('received'), "status_timestamp" integer NOT NULL DEFAULT ((unixepoch('now','subsec') * 1000)), "created_at" integer NOT NULL DEFAULT ((unixepoch('now','subsec') * 1000)), "remote_jid_alt" text, "json_ack" text)`);
        await queryRunner.query(`INSERT INTO "temporary_messages"("id", "remote_jid", "from_me", "participant", "push_name", "message_timestamp", "message_type", "text_content", "media_mimetype", "media_url", "quoted_message_id", "raw_payload", "is_deleted", "is_edited", "status", "status_timestamp", "created_at", "remote_jid_alt", "json_ack") SELECT "id", "remote_jid", "from_me", "participant", "push_name", "message_timestamp", "message_type", "text_content", "media_mimetype", "media_url", "quoted_message_id", "raw_payload", "is_deleted", "is_edited", "status", "status_timestamp", "created_at", "remote_jid_alt", "json_ack" FROM "messages"`);
        await queryRunner.query(`DROP TABLE "messages"`);
        await queryRunner.query(`ALTER TABLE "temporary_messages" RENAME TO "messages"`);
        await queryRunner.query(`CREATE INDEX "idx_messages_from_me" ON "messages" ("from_me") `);
        await queryRunner.query(`CREATE INDEX "idx_messages_remote_jid" ON "messages" ("remote_jid") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_messages_remote_jid"`);
        await queryRunner.query(`DROP INDEX "idx_messages_from_me"`);
        await queryRunner.query(`ALTER TABLE "messages" RENAME TO "temporary_messages"`);
        await queryRunner.query(`CREATE TABLE "messages" ("id" text PRIMARY KEY NOT NULL, "remote_jid" text NOT NULL, "from_me" integer NOT NULL DEFAULT (false), "participant" text, "push_name" text, "message_timestamp" integer NOT NULL, "message_type" text NOT NULL, "text_content" text, "media_mimetype" text, "media_url" text, "quoted_message_id" text, "raw_payload" text, "is_deleted" integer NOT NULL DEFAULT (false), "is_edited" integer NOT NULL DEFAULT (false), "status" text NOT NULL DEFAULT ('received'), "status_timestamp" integer NOT NULL DEFAULT (unixepoch('now','subsec') * 1000), "created_at" integer NOT NULL DEFAULT (unixepoch('now','subsec') * 1000), "remote_jid_alt" text, "json_ack" text)`);
        await queryRunner.query(`INSERT INTO "messages"("id", "remote_jid", "from_me", "participant", "push_name", "message_timestamp", "message_type", "text_content", "media_mimetype", "media_url", "quoted_message_id", "raw_payload", "is_deleted", "is_edited", "status", "status_timestamp", "created_at", "remote_jid_alt", "json_ack") SELECT "id", "remote_jid", "from_me", "participant", "push_name", "message_timestamp", "message_type", "text_content", "media_mimetype", "media_url", "quoted_message_id", "raw_payload", "is_deleted", "is_edited", "status", "status_timestamp", "created_at", "remote_jid_alt", "json_ack" FROM "temporary_messages"`);
        await queryRunner.query(`DROP TABLE "temporary_messages"`);
        await queryRunner.query(`CREATE INDEX "idx_messages_remote_jid" ON "messages" ("remote_jid") `);
        await queryRunner.query(`CREATE INDEX "idx_messages_from_me" ON "messages" ("from_me") `);
        await queryRunner.query(`DROP INDEX "idx_contacts_jid"`);
        await queryRunner.query(`DROP INDEX "idx_contacts_lid"`);
        await queryRunner.query(`ALTER TABLE "contacts" RENAME TO "temporary_contacts"`);
        await queryRunner.query(`CREATE TABLE "contacts" ("id" integer PRIMARY KEY NOT NULL, "jid" text, "lid" text, "push_name" text, "first_seen_at" integer NOT NULL DEFAULT (unixepoch('now','subsec') * 1000))`);
        await queryRunner.query(`INSERT INTO "contacts"("id", "jid", "lid", "push_name", "first_seen_at") SELECT "id", "jid", "lid", "push_name", "first_seen_at" FROM "temporary_contacts"`);
        await queryRunner.query(`DROP TABLE "temporary_contacts"`);
        await queryRunner.query(`CREATE INDEX "idx_contacts_jid" ON "contacts" ("jid") `);
        await queryRunner.query(`CREATE INDEX "idx_contacts_lid" ON "contacts" ("lid") `);
        await queryRunner.query(`DROP INDEX "idx_blocked_contacts_jid"`);
        await queryRunner.query(`DROP INDEX "idx_blocked_contacts_lid"`);
        await queryRunner.query(`ALTER TABLE "blocked_contacts" RENAME TO "temporary_blocked_contacts"`);
        await queryRunner.query(`CREATE TABLE "blocked_contacts" ("id" integer PRIMARY KEY NOT NULL, "jid" text, "lid" text, "blocked_at" integer NOT NULL DEFAULT (unixepoch('now','subsec') * 1000))`);
        await queryRunner.query(`INSERT INTO "blocked_contacts"("id", "jid", "lid", "blocked_at") SELECT "id", "jid", "lid", "blocked_at" FROM "temporary_blocked_contacts"`);
        await queryRunner.query(`DROP TABLE "temporary_blocked_contacts"`);
        await queryRunner.query(`CREATE INDEX "idx_blocked_contacts_jid" ON "blocked_contacts" ("jid") `);
        await queryRunner.query(`CREATE INDEX "idx_blocked_contacts_lid" ON "blocked_contacts" ("lid") `);
    }

}
