import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

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

const EPOCH_MS_DEFAULT = "(unixepoch('now','subsec') * 1000)";

@Entity('messages')
export class MessageEntity {
    @PrimaryColumn({ type: 'text' })
    id!: string;

    @Index('idx_messages_remote_jid')
    @Column({ name: 'remote_jid', type: 'text' })
    remoteJid!: string;

    /** Formato alternativo de `remoteJid` (lid <-> s.whatsapp.net) cuando Baileys lo expone en `key.remoteJidAlt`. */
    @Column({ name: 'remote_jid_alt', type: 'text', nullable: true })
    remoteJidAlt!: string | null;

    @Index('idx_messages_from_me')
    @Column({ name: 'from_me', type: 'boolean', default: false })
    fromMe!: boolean;

    @Column({ type: 'text', nullable: true })
    participant!: string | null;

    @Column({ name: 'push_name', type: 'text', nullable: true })
    pushName!: string | null;

    @Column({ name: 'message_timestamp', type: 'integer' })
    messageTimestamp!: number;

    @Column({ name: 'message_type', type: 'text', enum: MESSAGE_TYPES })
    messageType!: (typeof MESSAGE_TYPES)[number];

    @Column({ name: 'text_content', type: 'text', nullable: true })
    textContent!: string | null;

    @Column({ name: 'media_mimetype', type: 'text', nullable: true })
    mediaMimetype!: string | null;

    @Column({ name: 'media_url', type: 'text', nullable: true })
    mediaUrl!: string | null;

    @Column({ name: 'quoted_message_id', type: 'text', nullable: true })
    quotedMessageId!: string | null;

    @Column({ name: 'raw_payload', type: 'simple-json', nullable: true })
    rawPayload!: unknown;

    /** Raw de `{key, update}` del evento `messages.update` cuando `update.status === SERVER_ACK`. */
    @Column({ name: 'json_ack', type: 'simple-json', nullable: true })
    jsonAck!: unknown;

    @Column({ name: 'is_deleted', type: 'boolean', default: false })
    isDeleted!: boolean;

    @Column({ name: 'is_edited', type: 'boolean', default: false })
    isEdited!: boolean;

    @Column({ type: 'text', enum: MESSAGE_STATUSES, default: 'received' })
    status!: (typeof MESSAGE_STATUSES)[number];

    @Column({ name: 'status_timestamp', type: 'integer', default: () => EPOCH_MS_DEFAULT })
    statusTimestamp!: number;

    @Column({ name: 'created_at', type: 'integer', default: () => EPOCH_MS_DEFAULT })
    createdAt!: number;
}
