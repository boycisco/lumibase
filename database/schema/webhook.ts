/**
 * Webhooks table.
 *
 * Per specs section 15: never store the plaintext signing secret. secretHash
 * holds a hash of the secret (suitable for verification); the plaintext
 * secret is returned to the caller exactly once at creation time and is
 * never retrievable again. Actual delivery signing uses a separate
 * encrypted-at-rest secret (v0.2 concern, added with the delivery worker).
 *
 * For v0.1, secretHash is the SHA-256 of the plaintext signing secret.
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
    secretHash: text('secret_hash').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    appIdx: index('webhooks_app_idx').on(table.applicationId),
  }),
);
