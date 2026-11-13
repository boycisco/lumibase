/**
 * Webhooks table.
 *
 * Per spec section 12: "The actual signing secret must be handled securely.
 * If stored, encrypt it using an appropriate key-management approach rather
 * than storing it as plaintext."
 *
 * We use `secretCiphertext`: an AES-256-GCM ciphertext of the plaintext
 * signing secret, keyed from WEBHOOK_SECRET. The plaintext is returned to
 * the caller exactly once at creation time. At delivery time (Batch 3+),
 * the ciphertext is decrypted to produce the HMAC signing key.
 *
 * A one-way hash would satisfy "never store plaintext" but would also make
 * signing impossible. Encryption-at-rest with a master key is the only
 * approach that meets both the spec's storage requirement and the signing
 * requirement.
 */

import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { applications } from './application.ts';

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    secretCiphertext: text('secret_ciphertext').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    appIdx: index('webhooks_app_idx').on(table.applicationId),
  }),
);
