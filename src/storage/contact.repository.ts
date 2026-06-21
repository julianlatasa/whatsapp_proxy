import { and, eq, isNull, or } from 'drizzle-orm';
import type { AppDatabase } from './database.js';
import { contacts } from './schema.js';
import type { RegisterContactInput, StoredContact } from '../types/contact.types.js';

/** Patrón Repository: aísla el acceso a `contacts` vía Drizzle. */
export class ContactRepository {
    constructor(private readonly db: AppDatabase) {}

    /**
     * Registra el contacto si no existía (buscando por jid o por lid). Si ya
     * existía, completa el jid/lid que faltara y actualiza el pushName si
     * cambió. Devuelve la fila resultante, o null si no había jid ni lid.
     */
    upsert(input: RegisterContactInput): StoredContact | null {
        const jid = input.jid ?? null;
        const lid = input.lid ?? null;
        if (!jid && !lid) return null;

        const existing = this.findByJidOrLid(jid, lid);
        if (!existing) {
            this.db.insert(contacts).values(input).run();
            return this.findByJidOrLid(jid, lid);
        }

        const changes: Partial<RegisterContactInput> = {};
        if (jid && !existing.jid) changes.jid = jid;
        if (lid && !existing.lid) changes.lid = lid;
        if (input.pushName && input.pushName !== existing.pushName) changes.pushName = input.pushName;

        if (Object.keys(changes).length > 0) {
            this.db.update(contacts).set(changes).where(eq(contacts.id, existing.id)).run();
            return this.findByJidOrLid(jid, lid);
        }

        return existing;
    }

    /** Completa el lid de un contacto ya registrado, sin sobreescribir uno existente. */
    updateLid(jid: string, lid: string): void {
        this.db
            .update(contacts)
            .set({ lid })
            .where(and(eq(contacts.jid, jid), isNull(contacts.lid)))
            .run();
    }

    findByJid(jid: string): StoredContact | null {
        const row = this.db.select().from(contacts).where(eq(contacts.jid, jid)).get();
        return row ?? null;
    }

    findByLid(lid: string): StoredContact | null {
        const row = this.db.select().from(contacts).where(eq(contacts.lid, lid)).get();
        return row ?? null;
    }

    private findByJidOrLid(jid: string | null, lid: string | null): StoredContact | null {
        const conditions = [jid ? eq(contacts.jid, jid) : undefined, lid ? eq(contacts.lid, lid) : undefined].filter(
            (c): c is NonNullable<typeof c> => c !== undefined
        );
        if (conditions.length === 0) return null;

        const row = this.db.select().from(contacts).where(or(...conditions)).get();
        return row ?? null;
    }
}
