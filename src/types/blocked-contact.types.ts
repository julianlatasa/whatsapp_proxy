import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { blockedContacts } from '../storage/schema.js';

/** Derivado 1:1 de las columnas de `blocked_contacts` (ver `storage/schema.ts`). */
export type StoredBlockedContact = InferSelectModel<typeof blockedContacts>;

export type BlockContactInput = Omit<InferInsertModel<typeof blockedContacts>, 'id' | 'blockedAt'>;
