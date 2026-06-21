import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { contacts } from '../storage/schema.js';

/** Derivado 1:1 de las columnas de `contacts` (ver `storage/schema.ts`). */
export type StoredContact = InferSelectModel<typeof contacts>;

export type RegisterContactInput = Omit<InferInsertModel<typeof contacts>, 'id' | 'firstSeenAt'>;
