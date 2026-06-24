import { IsNull, type DataSource, type Repository } from 'typeorm';
import { ContactEntity } from './entities/contact.entity.js';
import type { RegisterContactInput, StoredContact } from '../types/contact.types.js';

/** Patrón Repository: aísla el acceso a `contacts` vía TypeORM. */
export class ContactRepository {
    private readonly repo: Repository<ContactEntity>;

    constructor(db: DataSource) {
        this.repo = db.getRepository(ContactEntity);
    }

    /**
     * Registra el contacto si no existía (buscando por jid o por lid). Si ya
     * existía, completa el jid/lid que faltara y actualiza el pushName si
     * cambió. Devuelve la fila resultante, o null si no había jid ni lid.
     */
    async upsert(input: RegisterContactInput): Promise<StoredContact | null> {
        const jid = input.jid ?? null;
        const lid = input.lid ?? null;
        if (!jid && !lid) return null;

        const existing = await this.findByJidOrLid(jid, lid);
        if (!existing) {
            await this.repo.insert({ jid, lid, pushName: input.pushName });
            return this.findByJidOrLid(jid, lid);
        }

        const changes: Partial<RegisterContactInput> = {};
        if (jid && !existing.jid) changes.jid = jid;
        if (lid && !existing.lid) changes.lid = lid;
        if (input.pushName && input.pushName !== existing.pushName) changes.pushName = input.pushName;

        if (Object.keys(changes).length > 0) {
            await this.repo.update(existing.id, changes);
            return this.findByJidOrLid(jid, lid);
        }

        return existing;
    }

    /** Completa el lid de un contacto ya registrado, sin sobreescribir uno existente. */
    async updateLid(jid: string, lid: string): Promise<void> {
        await this.repo.update({ jid, lid: IsNull() }, { lid });
    }

    async findByJid(jid: string): Promise<StoredContact | null> {
        return this.repo.findOne({ where: { jid } });
    }

    async findByLid(lid: string): Promise<StoredContact | null> {
        return this.repo.findOne({ where: { lid } });
    }

    private async findByJidOrLid(jid: string | null, lid: string | null): Promise<StoredContact | null> {
        const conditions = [jid ? { jid } : undefined, lid ? { lid } : undefined].filter(
            (c): c is NonNullable<typeof c> => c !== undefined
        );
        if (conditions.length === 0) return null;

        return this.repo.findOne({ where: conditions });
    }
}
