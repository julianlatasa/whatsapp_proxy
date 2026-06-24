import type { DataSource, Repository } from 'typeorm';
import { BlockedContactEntity } from './entities/blocked-contact.entity.js';
import type { BlockContactInput, StoredBlockedContact } from '../types/blocked-contact.types.js';

/** Patrón Repository: aísla el acceso a `blocked_contacts` vía TypeORM. */
export class BlockedContactRepository {
    private readonly repo: Repository<BlockedContactEntity>;

    constructor(db: DataSource) {
        this.repo = db.getRepository(BlockedContactEntity);
    }

    /** Bloquea un contacto por jid y/o lid. No-op si ya hay un bloqueo para alguno de los dos. */
    async block(input: BlockContactInput): Promise<StoredBlockedContact | null> {
        const jid = input.jid ?? null;
        const lid = input.lid ?? null;
        if (!jid && !lid) return null;
        if (await this.isBlocked(jid, lid)) return null;

        const inserted = await this.repo.insert({ jid, lid });
        const id = Number(inserted.identifiers[0]?.id);
        return this.repo.findOne({ where: { id } });
    }

    /** Elimina cualquier bloqueo que coincida con el jid o el lid dados. */
    async unblock(jid: string | null, lid: string | null): Promise<void> {
        const conditions = [jid ? { jid } : undefined, lid ? { lid } : undefined].filter(
            (c): c is NonNullable<typeof c> => c !== undefined
        );
        if (conditions.length === 0) return;

        await this.repo.delete(conditions);
    }

    /** True si el jid o el lid dados coinciden con algún contacto bloqueado. */
    async isBlocked(jid: string | null, lid: string | null): Promise<boolean> {
        const conditions = [jid ? { jid } : undefined, lid ? { lid } : undefined].filter(
            (c): c is NonNullable<typeof c> => c !== undefined
        );
        if (conditions.length === 0) return false;

        const row = await this.repo.findOne({ where: conditions });
        return row != null;
    }

    async list(): Promise<StoredBlockedContact[]> {
        return this.repo.find();
    }
}
