/**
 * Record a single transaction attempt (spec §8: transaction vs payment).
 *
 * Every confirm call that reaches the blockchain writes exactly one row
 * here — before or after verification, depending on what we learned.
 * A rejected attempt (wrong recipient, reverted, etc.) leaves a row with
 * status "rejected"; the parent payment returns to pending so the caller
 * may try a different transaction.
 *
 * Uniqueness of (chain_id, hash) is a HARD constraint from lifecycle.json
 * atomicity.transactionUniqueness. Postgres enforces it; this function
 * translates the violation into a structured result so callers do not
 * parse error strings.
 */

import { and, eq } from 'drizzle-orm';
import { transactions } from '@lumibase/database';
import type { ResolvedConfig } from './config.ts';

/** Attempt outcome. `verified` = passed all checks. */
export type AttemptStatus = 'verified' | 'rejected' | 'orphaned';

export interface RecordAttemptInput {
  readonly paymentId: string;
  readonly chainId: number;
  readonly hash: `0x${string}`;
  readonly sender: `0x${string}` | null;
  readonly recipient: `0x${string}`;
  readonly tokenAddress: `0x${string}`;
  readonly amount: bigint;
  readonly blockNumber: bigint | null;
  readonly status: AttemptStatus;
}

export type RecordAttemptResult =
  | { readonly kind: 'recorded'; readonly id: string }
  | { readonly kind: 'duplicate'; readonly existingPaymentId: string };

export async function recordAttempt(
  config: ResolvedConfig,
  input: RecordAttemptInput,
): Promise<RecordAttemptResult> {
  const now = config.clock();
  const id = config.idGenerator();

  try {
    await config.db.insert(transactions).values({
      id,
      paymentId: input.paymentId,
      chainId: input.chainId,
      hash: input.hash,
      sender: input.sender,
      recipient: input.recipient,
      tokenAddress: input.tokenAddress,
      amount: input.amount.toString(),
      blockNumber: input.blockNumber,
      status: input.status,
      verifiedAt: input.status === 'verified' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: 'recorded', id };
  } catch (err) {
    if (isUniqueViolation(err, 'transactions_chain_hash_unique')) {
      const [existing] = await config.db
        .select({ paymentId: transactions.paymentId })
        .from(transactions)
        .where(and(eq(transactions.chainId, input.chainId), eq(transactions.hash, input.hash)))
        .limit(1);
      return {
        kind: 'duplicate',
        existingPaymentId: existing?.paymentId ?? 'unknown',
      };
    }
    throw err;
  }
}

/**
 * Detect a Postgres unique-constraint violation from a Drizzle-wrapped
 * error. Postgres SQLSTATE 23505 is unique_violation; Drizzle passes
 * `code` through on the error object.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code === '23505') return true;
  const msg = err.message.toLowerCase();
  return msg.includes('duplicate key') && msg.includes(constraint.toLowerCase());
}
