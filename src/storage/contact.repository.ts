import { IsNull, type DataSource, type Repository } from 'typeorm';
import { ContactEntity } from './entities/contact.entity.js';
import type { RegisterContactInput, StoredContact } from '../types/contact.types.js';

/** Patrón Repository: aísla el acceso a `contacts` vía TypeORM. */
export class ContactRepository {
    private readonly repo: Repository<ContactEntity>;

    /**
     * Serializa todas las escrituras: upsert y updateLid son lectura-luego-escritura,
     * y dos eventos del mismo contacto casi simultáneos podían insertar filas duplicadas
     * (típico en contactos sin jid resuelto, solo con lid). Ver fix anterior.
     */
    private writeQueue: Promise<unknown> = Promise.resolve();

    constructor(db: DataSource) {
        this.repo = db.getRepository(ContactEntity);
    }

    /**
     * Registra el contacto si no existía (buscando por jid o lid). Si ya existía,
     * completa el jid/lid que faltara y actualiza el pushName si cambió.
     * Devuelve la fila resultante, o null si no había jid ni lid.
     */
    async upsert(input: RegisterContactInput): Promise<StoredContact | null> {
        const jid = input.jid ?? null;
        const lid = input.lid ?? null;
        if (!jid && !lid) return null;

        return this.enqueue(() => this.doUpsert(jid, lid, input.pushName));
    }

    /**
     * Completa el lid de un contacto ya registrado que sólo tiene jid, sin sobreescribir
     * un lid existente. Si el contacto no existe todavía, lo crea con jid+lid.
     * Devuelve true si hubo algún cambio en base de datos.
     */
    async upsertLid(jid: string, lid: string): Promise<boolean> {
        return this.enqueue(async () => {
            const existing = await this.findByJidOrLid(jid, lid);
            if (!existing) {
                await this.repo.insert({ jid, lid, pushName: null });
                return true;
            }
            const needsLid = !existing.lid;
            const needsJid = !existing.jid;
            if (needsLid || needsJid) {
                await this.repo.update(existing.id, {
                    ...(needsLid ? { lid } : {}),
                    ...(needsJid ? { jid } : {}),
                });
                return true;
            }
            return false;
        });
    }

    async findByJid(jid: string): Promise<StoredContact | null> {
        return this.repo.findOne({ where: { jid } });
    }

    async findByLid(lid: string): Promise<StoredContact | null> {
        return this.repo.findOne({ where: { lid } });
    }

    private async doUpsert(jid: string | null, lid: string | null, pushName: string | null): Promise<StoredContact | null> {
        const existing = await this.findByJidOrLid(jid, lid);
        if (!existing) {
            await this.repo.insert({ jid, lid, pushName });
            return this.findByJidOrLid(jid, lid);
        }

        const changes: Partial<RegisterContactInput> = {};
        if (jid && !existing.jid) changes.jid = jid;
        if (lid && !existing.lid) changes.lid = lid;
        if (pushName && pushName !== existing.pushName) changes.pushName = pushName;

        if (Object.keys(changes).length > 0) {
            await this.repo.update(existing.id, changes);
            return this.findByJidOrLid(jid, lid);
        }

        return existing;
    }

    private async findByJidOrLid(jid: string | null, lid: string | null): Promise<StoredContact | null> {
        const conditions = [jid ? { jid } : undefined, lid ? { lid } : undefined].filter(
            (c): c is NonNullable<typeof c> => c !== undefined
        );
        if (conditions.length === 0) return null;
        return this.repo.findOne({ where: conditions });
    }

    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.writeQueue.then(fn);
        this.writeQueue = run.catch(() => {});
        return run;
    }
}
