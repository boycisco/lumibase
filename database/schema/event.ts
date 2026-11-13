/**
 * Events table.
 *
 * Lifecycle events (see specs/payments/events.json). Every event that the
 * system emits is persisted here BEFORE any webhook delivery is scheduled —
 * this guarantees that even if the delivery worker crashes, the event itself
 * is on disk and can be replayed.
 *
 * paymentId is nullable because some events in future phases may not
 * reference a specific payment (e.g. application-level events). For v0.1,
 * every event here is payment-scoped.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { applications } from './application.ts';
import { payments } from './payment.ts';

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').references(() => payments.id, {
      onDelete: 'cascade',
    }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    appCreatedIdx: index('events_app_created_idx').on(table.applicationId, table.createdAt),
    paymentIdx: index('events_payment_idx').on(table.paymentId),
  }),
);
