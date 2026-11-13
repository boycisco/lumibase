/**
 * Confirmation policy application.
 *
 * Given a transaction receipt, the current chain head, and a policy, decide
 * whether the transaction is final enough to act on. This is the answer to
 * the ONLY question that matters before marking a payment as confirmed:
 * "could this still disappear under a reorg?"
 *
 * The function is PURE. No RPC, no database, no clock. Callers supply:
 *   - the receipt (already fetched)
 *   - the current block number (already fetched)
 *   - the policy (from @lumibase/network chain definitions)
 *
 * This design keeps the logic testable without anvil and forces callers
 * (the payment service in Phase 7) to be explicit about every input. See
 * spec section 10.4: "Keep transaction observation separate from payment
 * finalization."
 */

import type { TransactionReceipt } from 'viem';
import type { ConfirmationPolicy } from '@lumibase/core';

/**
 * Verdict for a single receipt.
 *
 * A discriminated union rather than a boolean, because "still pending" and
 * "already reverted" are very different problems and must not be conflated:
 *   - "pending": the tx may still become final. Keep watching.
 *   - "reverted": the tx failed. It will NEVER be final. Fail the attempt.
 *   - "confirmed": the tx is deep enough. Safe to act on.
 */
export type FinalityResult =
  | {
      readonly status: 'confirmed';
      readonly confirmations: number;
      readonly required: number;
    }
  | {
      readonly status: 'pending';
      readonly confirmations: number;
      readonly required: number;
    }
  | {
      readonly status: 'reverted';
      readonly confirmations: number;
      readonly required: number;
    };

/**
 * Compute the number of confirmations for a receipt at a given chain head.
 *
 * Convention (Ethereum standard, used by every block explorer):
 *   confirmations = currentBlock - receipt.blockNumber + 1
 *
 * The transaction's own block counts as 1 confirmation. A `blocks: 12`
 * policy therefore requires currentBlock >= receipt.blockNumber + 11.
 */
export function countConfirmations(receipt: TransactionReceipt, currentBlock: bigint): number {
  if (currentBlock < receipt.blockNumber) {
    // The receipt's blockNumber can only be <= currentBlock if the caller
    // fetched them in a consistent order. If it's inverted, the caller
    // either mixed stale and fresh data or misused the API. Fail loudly
    // rather than silently producing a negative confirmation count.
    throw new Error(
      `currentBlock (${currentBlock}) is less than receipt.blockNumber (${receipt.blockNumber}). ` +
        `Fetch the block number AFTER the receipt, or re-fetch both.`,
    );
  }
  const depth = currentBlock - receipt.blockNumber + 1n;
  // confirmations fit comfortably in a JS number: at 12-second blocks,
  // even 100 years of depth is ~2.6e8, far below Number.MAX_SAFE_INTEGER.
  return Number(depth);
}

/**
 * Decide whether the receipt satisfies the given confirmation policy.
 *
 * Order of checks:
 *   1. If the receipt is reverted, return "reverted" regardless of depth.
 *      A reverted tx can never confirm a payment, no matter how old it is.
 *   2. If depth >= policy.blocks, return "confirmed".
 *   3. Otherwise, return "pending" with the current depth so callers can
 *      log it or schedule a retry.
 */
export function checkConfirmations(
  receipt: TransactionReceipt,
  currentBlock: bigint,
  policy: ConfirmationPolicy,
): FinalityResult {
  const confirmations = countConfirmations(receipt, currentBlock);
  const required = policy.blocks;

  if (receipt.status === 'reverted') {
    return { status: 'reverted', confirmations, required };
  }
  if (confirmations >= required) {
    return { status: 'confirmed', confirmations, required };
  }
  return { status: 'pending', confirmations, required };
}
