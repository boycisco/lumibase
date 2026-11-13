/**
 * Expiry service.
 *
 * Two operations:
 *
 *   - expirePayment(config, paymentId): single CAS pending -> expired.
 *     Returns null if the payment was not pending (already expired,
 *     confirmed, cancelled, ...). Used by the confirm-time path in Phase 7
 *     if it wants to expire-then-reject; the API worker in Phase 8 uses
 *     expirePending instead.
 *
 *   - expirePending(config, now): batch expire. One UPDATE ... RETURNING
 *     inside a transaction, then one batch INSERT for events. Efficient,
 *     atomic, and it is what the background worker calls periodically.
 *
 * Both operations write a payment.expired event in the SAME transaction as
 * the status change. If either fails, both roll back — the invariant is
 * "expired row <-> expired event exists".
 *
 * Rules enforced (from specs/payments/lifecycle.json):
 *   - Only pending can expire. If a payment is in processing, it must
 *     finish verification first. The CAS `WHERE status='pending'` enforces
 *     this at the SQL layer, so even a buggy caller cannot expire a
 *     processing payment.
 *   - Processing is protected. A payment that is currently processing
 *     simply won't match the WHERE clause.
 *   - Expiration is an explicit transition, not computed on read. This
 *     module is the ONLY mechanism that turns pending into expired.
 */

import { and, eq, lte } from 'drizzle-orm';
import { events, payments } from '@lumibase/database';
import type { ResolvedConfig } from './config.ts';
import { rowToPayment } from './row.ts';
import type { Payment } from './types.ts';
import { toWirePayment } from './wire.ts';

/**
 * Expire a single pending payment whose expiresAt has passed.
 *
 * Idempotent: returns null if the payment is not pending (already expired
 * by a concurrent call, already confirmed, etc.). Callers that need to
 * distinguish "was pending, expired successfully" from "was not pending"
 * can compare the return value to null.
 *
 * IMPORTANT: The CAS does NOT check `expires_at <= now()` here. This
 * function is a low-level primitive; it will expire any pending payment
 * it's given. The worker (`expirePending`) applies the `expires_at`
 * filter. This separation keeps `expirePayment` usable in the confirm
 * path (Phase 7) where the caller has already determined the payment
 * is past expiry.
 */
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

    await tx.insert(events).values({
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

/**
 * Expire every pending payment whose expiresAt is at or before `now`.
 *
 * Called by the background worker (Phase 8). One transaction, one UPDATE
 * with RETURNING, one batch INSERT. Returns the array of payments that
 * were transitioned (empty array if nothing was due).
 *
 * The `now` parameter defaults to config.clock(). Tests inject a specific
 * time to make assertions deterministic.
 */
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

    await tx.insert(events).values(
      rows.map((row, i) => ({
        id: config.idGenerator(),
        applicationId: row.applicationId,
        paymentId: row.id,
        type: 'payment.expired',
        payload: { payment: toWirePayment(expired[i]!) },
        createdAt: now,
      })),
    );

    return expired;
  });
}
