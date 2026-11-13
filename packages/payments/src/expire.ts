/**
 * Expiry service.
 *
 * Two operations, both writing `payment.expired` via recordEvent (which
 * also queues deliveries for enabled webhooks):
 *
 *   - expirePayment(config, paymentId): single CAS pending -> expired.
 *     Returns null if the payment was not pending.
 *
 *   - expirePending(config, now): batch expire. One UPDATE ... RETURNING
 *     inside a transaction, then recordEvent for each expired payment.
 */

import { and, eq, lte } from 'drizzle-orm';
import { payments } from '@lumibase/database';
import type { ResolvedConfig } from './config.ts';
import { recordEvent } from './notify.ts';
import { rowToPayment } from './row.ts';
import type { Payment } from './types.ts';
import { toWirePayment } from './wire.ts';

export async function expirePayment(
  config: ResolvedConfig,
  paymentId: string,
): Promise<Payment | null> {
  const now = config.clock();

  return config.db.transaction(async (tx) => {
    const [row] = await tx
      .update(payments)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'pending')))
      .returning();

    if (!row) return null;

    const payment = rowToPayment(row);

    await recordEvent(config, tx, {
      id: config.idGenerator(),
      applicationId: row.applicationId,
      paymentId: row.id,
      type: 'payment.expired',
      payload: { payment: toWirePayment(payment) },
      createdAt: now,
    });

    return payment;
  });
}

export async function expirePending(
  config: ResolvedConfig,
  now: Date = config.clock(),
): Promise<Payment[]> {
  return config.db.transaction(async (tx) => {
    const rows = await tx
      .update(payments)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(payments.status, 'pending'), lte(payments.expiresAt, now)))
      .returning();

    if (rows.length === 0) return [];

    const expired = rows.map(rowToPayment);

    // Loop recordEvent instead of a single batch insert so each event's
    // deliveries are scheduled atomically with that event. Slightly more
    // queries per expired payment, but the invariant "event <-> deliveries"
    // is preserved at the row level.
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      await recordEvent(config, tx, {
        id: config.idGenerator(),
        applicationId: row.applicationId,
        paymentId: row.id,
        type: 'payment.expired',
        payload: { payment: toWirePayment(expired[i]!) },
        createdAt: now,
      });
    }

    return expired;
  });
}
