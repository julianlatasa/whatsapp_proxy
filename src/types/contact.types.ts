import type { ContactEntity } from '../storage/entities/contact.entity.js';

/** Derivado 1:1 de las columnas de `contacts` (ver `storage/entities/contact.entity.ts`). */
export type StoredContact = ContactEntity;

export type RegisterContactInput = Omit<ContactEntity, 'id' | 'firstSeenAt'>;
