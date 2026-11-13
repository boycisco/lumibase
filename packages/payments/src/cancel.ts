/**
 * Cancellation service.
 *
 * Application-initiated. The caller (Phase 8 API) has already authenticated
 * `applicationId`, but this service still filters by it in the CAS to
 * prevent one application from cancelling another application's payment.
 *
 * Design decisions (documented because they are not in the spec):
 *
 *   - Cancel emits NO event in v0.1. Per specs/payments/events.json:
 *     "v0.1 does not emit a payment.cancelled event. Cancellation is
 *     initiated by the application, so the canceller already knows."
 *
 *   - Cancelling an already-cancelled payment is a no-op returning the
 *     current state. Rationale: a user clicking "cancel" twice when the
 *     network timed out should get a 200, not a 409. This is idempotency
 *     scoped to cancel only; the confirm endpoint's idempotency is
 *     defined separately in lifecycle.json.
 *
 *   - Cancelling any OTHER non-pending status (confirmed, expired, failed,
 *     underpaid, overpaid) throws PAYMENT_INVALID_STATE. Those statuses
 *     are terminal via different paths; the caller cannot retroactively
 *     cancel them.
 */

import { and, eq } from 'drizzle-orm';
import { payments } from '@lumibase/database';
import type { ResolvedConfig } from './config.ts';
import { paymentError } from './error.ts';
import { rowToPayment } from './row.ts';
import type { Payment } from './types.ts';

interface CancelPaymentInput {
  readonly paymentId: string;
  readonly applicationId: string;
}

export async function cancelPayment(
  config: ResolvedConfig,
  input: CancelPaymentInput,
): Promise<Payment> {
  const now = config.clock();

  return config.db.transaction(async (tx) => {
    // Attempt atomic CAS pending -> cancelled.
    const [row] = await tx
      .update(payments)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(payments.id, input.paymentId),
          eq(payments.applicationId, input.applicationId),
          eq(payments.status, 'pending'),
        ),
      )
      .returning();

    if (row) return rowToPayment(row);

    // CAS failed. Determine why with a re-read.
    const [existing] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, input.paymentId), eq(payments.applicationId, input.applicationId)))
      .limit(1);

    if (!existing) {
      // Not found or belongs to another app — indistinguishable.
      throw paymentError('PAYMENT_NOT_FOUND', `Payment ${input.paymentId} not found.`, {
        paymentId: input.paymentId,
      });
    }

    // Idempotent on already-cancelled.
    if (existing.status === 'cancelled') {
      return rowToPayment(existing);
    }

    // Any other non-pending status is not cancellable.
    throw paymentError(
      'PAYMENT_INVALID_STATE',
      `Payment ${input.paymentId} is in status "${existing.status}" and cannot be cancelled.`,
      { paymentId: input.paymentId, status: existing.status },
    );
  });
}
