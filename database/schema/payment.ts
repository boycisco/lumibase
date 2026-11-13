/**
 * Payments table.
 *
 * A payment request (see specs/payments/payment.json). Does NOT represent a
 * transaction; transaction attempts live in the transactions table and are
 * associated back to payments via payment_id.
 *
 * Column notes:
 *   - amount is NUMERIC(78,0). uint256 has 78 decimal digits maximum; storing
 *     as NUMERIC preserves exact integer semantics with no float involvement.
 *     Serialization to/from JS uses strings and @lumibase/core's amount helpers.
 *   - token and recipient store lowercase-hex addresses. The EIP-55 checksum
 *     is a display concern; canonical storage is lowercase so two equal
 *     addresses never produce two distinct rows.
 *   - payer is nullable: some payment requests have no expected payer.
 *   - reference is application-supplied and NOT unique (per specs).
 *   - metadata is jsonb so applications can query into it if needed.
 *   - status is text, not an enum: adding a status in v0.2 should not require
 *     a data migration of every existing row.
 */

import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { applications } from './application.ts';

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'restrict' }),
    reference: text('reference'),
    chainId: integer('chain_id').notNull(),
    tokenAddress: text('token_address').notNull(),
    amount: numeric('amount', { precision: 78, scale: 0 }).notNull(),
    recipient: text('recipient').notNull(),
    payer: text('payer'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    appStatusIdx: index('payments_app_status_idx').on(table.applicationId, table.status),
    expiresAtIdx: index('payments_expires_at_idx').on(table.expiresAt),
    referenceIdx: index('payments_reference_idx').on(table.reference),
  }),
);
