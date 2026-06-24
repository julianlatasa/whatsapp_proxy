import type { BlockedContactEntity } from '../storage/entities/blocked-contact.entity.js';

/** Derivado 1:1 de las columnas de `blocked_contacts` (ver `storage/entities/blocked-contact.entity.ts`). */
export type StoredBlockedContact = BlockedContactEntity;

export type BlockContactInput = Omit<BlockedContactEntity, 'id' | 'blockedAt'>;
