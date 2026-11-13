/**
 * Read service: fetch a single payment or list payments by application.
 *
 * Every query filters by applicationId. This is the enforcement point for
 * "cross-application data isolation" from spec section 15. A caller with
 * application A's credentials cannot learn anything about application B's
 * payments — not whether they exist, not how many there are, not their
 * status.
 *
 * Authorization model: `applicationId` is trusted by this layer (Phase 8
 * authenticates it). But even though the caller supplies it, we must not
 * pass it through as an OR condition — it is the WHERE clause's primary
 * filter, always. If a caller passes the wrong applicationId, the query
 * returns zero rows and we throw PAYMENT_NOT_FOUND, indistinguishable from
 * "this payment does not exist".
 */

import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { payments } from '@lumibase/database';
import type { ResolvedConfig } from './config.ts';
import { paymentError } from './error.ts';
import { rowToPayment } from './row.ts';
import type { Payment, PaymentStatus } from './types.ts';

/** Default page size for listPayments. */
export const DEFAULT_LIST_LIMIT = 20;

/** Maximum page size for listPayments. */
export const MAX_LIST_LIMIT = 100;

interface GetPaymentInput {
  readonly paymentId: string;
  readonly applicationId: string;
}

interface ListPaymentsInput {
  readonly applicationId: string;
  readonly status?: PaymentStatus;
  readonly reference?: string;
  readonly chainId?: number;
  readonly limit?: number;
}

export async function getPayment(config: ResolvedConfig, input: GetPaymentInput): Promise<Payment> {
  const rows = await config.db
    .select()
    .from(payments)
    .where(and(eq(payments.id, input.paymentId), eq(payments.applicationId, input.applicationId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw paymentError('PAYMENT_NOT_FOUND', `Payment ${input.paymentId} not found.`, {
      paymentId: input.paymentId,
    });
  }

  return rowToPayment(row);
}

export async function listPayments(
  config: ResolvedConfig,
  input: ListPaymentsInput,
): Promise<Payment[]> {
  const limit = normalizeLimit(input.limit);

  const conditions: SQL[] = [eq(payments.applicationId, input.applicationId)];
  if (input.status !== undefined) {
    conditions.push(eq(payments.status, input.status));
  }
  if (input.reference !== undefined) {
    conditions.push(eq(payments.reference, input.reference));
  }
  if (input.chainId !== undefined) {
    conditions.push(eq(payments.chainId, input.chainId));
  }

  const rows = await config.db
    .select()
    .from(payments)
    .where(and(...conditions))
    .orderBy(desc(payments.createdAt), asc(payments.id))
    .limit(limit);

  return rows.map(rowToPayment);
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value)) {
    throw paymentError('PAYMENT_INVALID_STATE', 'limit must be an integer.', { limit: value });
  }
  if (value < 1) return DEFAULT_LIST_LIMIT;
  return Math.min(value, MAX_LIST_LIMIT);
}
