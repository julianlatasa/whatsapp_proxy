import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const EPOCH_MS_DEFAULT = "(unixepoch('now','subsec') * 1000)";

/** Contactos bloqueados: el remitente puede identificarse por `jid` (s.whatsapp.net) y/o `lid`. */
@Entity('blocked_contacts')
export class BlockedContactEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Index('idx_blocked_contacts_jid')
    @Column({ type: 'text', nullable: true })
    jid!: string | null;

    @Index('idx_blocked_contacts_lid')
    @Column({ type: 'text', nullable: true })
    lid!: string | null;

    @Column({ name: 'blocked_at', type: 'integer', default: () => EPOCH_MS_DEFAULT })
    blockedAt!: number;
}
