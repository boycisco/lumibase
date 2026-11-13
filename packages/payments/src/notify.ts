/**
 * Event recording helper.
 *
 * Every payment lifecycle transition writes:
 *   1. An `events` row (the persisted event payload)
 *   2. One `deliveries` row per enabled webhook owned by the same application
 *
 * Both inserts happen in the CALLER'S transaction, so the invariant "if a
 * payment transitioned, its event and its deliveries all exist atomically"
 * holds. If the deliveries insert fails, the whole transition rolls back.
 *
 * Why one helper instead of two inserts scattered around:
 *   - Prevents forgetting to schedule deliveries when adding a new event type
 *   - Keeps the transaction boundary in one place
 *   - Batch 3's worker can assume deliveries always correspond to events
 */

import { and, eq } from 'drizzle-orm';
import { deliveries, events, webhooks, type Database } from '@lumibase/database';
import type { ResolvedConfig } from './config.ts';

/** Drizzle transaction handle, derived from the Database type. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface RecordEventInput {
  readonly id: string;
  readonly applicationId: string;
  readonly paymentId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

/**
 * Persist a lifecycle event and enqueue one delivery per enabled webhook
 * for the event's application.
 *
 * Returns the number of delivery rows created (0 if the app has no enabled
 * webhooks). Useful for tests.
 */
export async function recordEvent(
  config: ResolvedConfig,
  tx: Tx,
  input: RecordEventInput,
): Promise<number> {
  await tx.insert(events).values({
    id: input.id,
    applicationId: input.applicationId,
    paymentId: input.paymentId,
    type: input.type,
    payload: input.payload,
    createdAt: input.createdAt,
  });

  const enabledWebhooks = await tx
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.applicationId, input.applicationId), eq(webhooks.enabled, true)));

  if (enabledWebhooks.length === 0) return 0;

  await tx.insert(deliveries).values(
    enabledWebhooks.map((w) => ({
      id: config.idGenerator(),
      webhookId: w.id,
      eventId: input.id,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: input.createdAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })),
  );

  return enabledWebhooks.length;
}
