import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const EPOCH_MS_DEFAULT = "(unixepoch('now','subsec') * 1000)";

@Entity('contacts')
export class ContactEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Index('idx_contacts_jid')
    @Column({ type: 'text', nullable: true })
    jid!: string | null;

    @Index('idx_contacts_lid')
    @Column({ type: 'text', nullable: true })
    lid!: string | null;

    @Column({ name: 'push_name', type: 'text', nullable: true })
    pushName!: string | null;

    @Column({ name: 'first_seen_at', type: 'integer', default: () => EPOCH_MS_DEFAULT })
    firstSeenAt!: number;
}
