import { eq, or } from 'drizzle-orm';
import type { AppDatabase } from './database.js';
import { blockedContacts } from './schema.js';
import type { BlockContactInput, StoredBlockedContact } from '../types/blocked-contact.types.js';

/** Patrón Repository: aísla el acceso a `blocked_contacts` vía Drizzle. */
export class BlockedContactRepository {
    constructor(private readonly db: AppDatabase) {}

    /** Bloquea un contacto por jid y/o lid. No-op si ya hay un bloqueo para alguno de los dos. */
    block(input: BlockContactInput): StoredBlockedContact | null {
        const jid = input.jid ?? null;
        const lid = input.lid ?? null;
        if (!jid && !lid) return null;
        if (this.isBlocked(jid, lid)) return null;

        const result = this.db.insert(blockedContacts).values(input).run();
        return this.db.select().from(blockedContacts).where(eq(blockedContacts.id, Number(result.lastInsertRowid))).get() ?? null;
    }

    /** Elimina cualquier bloqueo que coincida con el jid o el lid dados. */
    unblock(jid: string | null, lid: string | null): void {
        const conditions = [jid ? eq(blockedContacts.jid, jid) : undefined, lid ? eq(blockedContacts.lid, lid) : undefined].filter(
            (c): c is NonNullable<typeof c> => c !== undefined
        );
        if (conditions.length === 0) return;

        this.db.delete(blockedContacts).where(or(...conditions)).run();
    }

    /** True si el jid o el lid dados coinciden con algún contacto bloqueado. */
    isBlocked(jid: string | null, lid: string | null): boolean {
        const conditions = [jid ? eq(blockedContacts.jid, jid) : undefined, lid ? eq(blockedContacts.lid, lid) : undefined].filter(
            (c): c is NonNullable<typeof c> => c !== undefined
        );
        if (conditions.length === 0) return false;

        const row = this.db.select().from(blockedContacts).where(or(...conditions)).get();
        return row != null;
    }

    list(): StoredBlockedContact[] {
        return this.db.select().from(blockedContacts).all();
    }
}
