/**
 * Deliveries table.
 *
 * Per-event-per-webhook delivery queue (specs section 14). The unique
 * constraint on (webhook_id, event_id) prevents duplicate deliveries.
 *
 * Status lifecycle:
 *   pending     — awaiting first attempt or a scheduled retry
 *   processing  — claimed by a worker; HTTP in flight (or crashed)
 *   delivered   — 2xx response received (terminal)
 *   failed      — permanent failure, retries exhausted or 4xx/3xx (terminal)
 *
 * lease_expires_at:
 *   Set to now + 60s when a worker claims the row. Cleared on outcome.
 *   If a worker crashes mid-delivery, the row stays 'processing' with a
 *   lease in the past; the next claim cycle reaps it. This avoids the
 *   "stuck in processing forever" failure mode without a separate reaper
 *   process.
 */

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { events } from './event.ts';
import { webhooks } from './webhook.ts';

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    webhookEventUnique: uniqueIndex('deliveries_webhook_event_unique').on(
      table.webhookId,
      table.eventId,
    ),
    pendingIdx: index('deliveries_pending_idx').on(table.status, table.nextAttemptAt),
    eventIdx: index('deliveries_event_idx').on(table.eventId),
  }),
);
