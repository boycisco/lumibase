/**
 * Deliveries table.
 *
 * Per-event-per-webhook delivery queue (specs section 14). The unique
 * constraint on (webhook_id, event_id) guarantees that no event can produce
 * two delivery rows for the same webhook — that is the mechanism that
 * prevents duplicate deliveries even under retry and worker crash scenarios.
 *
 * Workers pop deliveries by selecting where status = 'pending' and
 * nextAttemptAt <= now(), then atomically transition to 'delivering'. The
 * full worker is implemented in Phase 9.
 *
 * ON DELETE CASCADE: if a webhook is deleted, its pending deliveries are
 * deleted with it. Event history remains in the events table.
 */

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { events } from "./event.ts";
import { webhooks } from "./webhook.ts";

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    webhookEventUnique: uniqueIndex("deliveries_webhook_event_unique").on(
      table.webhookId,
      table.eventId,
    ),
    pendingIdx: index("deliveries_pending_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    eventIdx: index("deliveries_event_idx").on(table.eventId),
  }),
);