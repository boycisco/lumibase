/**
 * Verification logic — the heart of "never trust the client".
 *
 * Two layers:
 *
 *   - matchTransfers: PURE. Takes a payment and an already-decoded list of
 *     ERC-20 Transfer events (see @lumibase/network's decodeTransfers).
 *     Returns a verdict. No RPC, no DB, no clock. This is what gets
 *     exhaustively tested in unit tests.
 *
 *   - verifyTransfers: thin chain around the primitives. Checks reverted,
 *     checks confirmations, decodes transfers, then calls matchTransfers.
 *     This is what Phase 7 Batch 2's confirm() will call.
 *
 * The split exists because:
 *   - matchTransfers is the money-sensitive logic. Every branch must be
 *     provable without anvil or a DB.
 *   - verifyTransfers is orchestration. Its correctness depends on
 *     @lumibase/network primitives (already proven in Phase 5).
 *
 * Verdict kinds map to lifecycle.json transitions:
 *   matched     -> confirmed
 *   underpaid   -> underpaid
 *   overpaid    -> overpaid
 *   everything else -> rejected attempt, revert payment to pending
 */

import type { TransactionReceipt } from 'viem';
import type { ConfirmationPolicy } from '@lumibase/core';
import { checkConfirmations, decodeTransfers, type Erc20Transfer } from '@lumibase/network';
import type { Payment } from './types.ts';

/**
 * Verdict from matchTransfers. Only the amount-matching phases; revert and
 * confirmations checks live in verifyTransfers.
 */
export type MatchVerdict =
  | { readonly kind: 'no_transfer' }
  | { readonly kind: 'wrong_token'; readonly expected: string; readonly saw: readonly string[] }
  | { readonly kind: 'wrong_recipient'; readonly expected: string; readonly saw: readonly string[] }
  | { readonly kind: 'wrong_sender'; readonly expected: string; readonly saw: readonly string[] }
  | { readonly kind: 'ambiguous'; readonly count: number }
  | {
      readonly kind: 'underpaid';
      readonly expected: bigint;
      readonly actual: bigint;
      readonly transfer: Erc20Transfer;
    }
  | {
      readonly kind: 'overpaid';
      readonly expected: bigint;
      readonly actual: bigint;
      readonly transfer: Erc20Transfer;
    }
  | { readonly kind: 'matched'; readonly transfer: Erc20Transfer };

/**
 * Final verdict from verifyTransfers. Adds revert and confirmation cases
 * that only make sense once we have the receipt + current block.
 */
export type VerifyVerdict =
  | { readonly kind: 'reverted' }
  | {
      readonly kind: 'not_enough_confirmations';
      readonly confirmations: number;
      readonly required: number;
    }
  | MatchVerdict;

/**
 * Match a payment request against a decoded list of ERC-20 Transfer events.
 *
 * Filters in order:
 *   1. Token contract must equal payment.tokenAddress
 *   2. Transfer.to must equal payment.recipient
 *   3. If payment.payer set, Transfer.from must equal payment.payer
 *   4. Exactly one transfer must remain (ambiguity is rejected)
 *   5. Amount comparison: equal / underpaid / overpaid
 *
 * The order matters: "wrong token" is reported before "wrong recipient",
 * because if a receipt contains a transfer of a totally different asset,
 * "wrong recipient" would be misleading — the recipient wasn't touched
 * with OUR token at all.
 */
export function matchTransfers(
  payment: Payment,
  transfers: readonly Erc20Transfer[],
): MatchVerdict {
  if (transfers.length === 0) {
    return { kind: 'no_transfer' };
  }

  const tokenLower = payment.tokenAddress.toLowerCase();
  const byToken = transfers.filter((t) => t.token.toLowerCase() === tokenLower);
  if (byToken.length === 0) {
    return {
      kind: 'wrong_token',
      expected: payment.tokenAddress,
      saw: transfers.map((t) => t.token),
    };
  }

  const recipLower = payment.recipient.toLowerCase();
  const byRecipient = byToken.filter((t) => t.to.toLowerCase() === recipLower);
  if (byRecipient.length === 0) {
    return {
      kind: 'wrong_recipient',
      expected: payment.recipient,
      saw: byToken.map((t) => t.to),
    };
  }

  let bySender = byRecipient;
  if (payment.payer !== null) {
    const payerLower = payment.payer.toLowerCase();
    bySender = byRecipient.filter((t) => t.from.toLowerCase() === payerLower);
    if (bySender.length === 0) {
      return {
        kind: 'wrong_sender',
        expected: payment.payer,
        saw: byRecipient.map((t) => t.from),
      };
    }
  }

  if (bySender.length > 1) {
    return { kind: 'ambiguous', count: bySender.length };
  }

  const transfer = bySender[0]!;
  if (transfer.value === payment.amount) {
    return { kind: 'matched', transfer };
  }
  if (transfer.value < payment.amount) {
    return {
      kind: 'underpaid',
      expected: payment.amount,
      actual: transfer.value,
      transfer,
    };
  }
  return {
    kind: 'overpaid',
    expected: payment.amount,
    actual: transfer.value,
    transfer,
  };
}

/**
 * Full verification of a receipt against a payment.
 *
 * Order (spec §10.1):
 *   1. Transaction must have succeeded on chain (not reverted).
 *   2. Transaction must be sufficiently confirmed.
 *   3. One Transfer must match token + recipient + (payer) + amount.
 *
 * Chain assumptions:
 *   - The receipt exists (caller fetched it with getReceipt).
 *   - The receipt is from the payment's chain (client is chain-scoped).
 *   - currentBlock >= receipt.blockNumber (caller used waitForBlock).
 */
export function verifyTransfers(
  receipt: TransactionReceipt,
  payment: Payment,
  currentBlock: bigint,
  policy: ConfirmationPolicy,
): VerifyVerdict {
  if (receipt.status === 'reverted') {
    return { kind: 'reverted' };
  }
  const finality = checkConfirmations(receipt, currentBlock, policy);
  if (finality.status === 'reverted') {
    return { kind: 'reverted' };
  }
  if (finality.status === 'pending') {
    return {
      kind: 'not_enough_confirmations',
      confirmations: finality.confirmations,
      required: finality.required,
    };
  }
  const transfers = decodeTransfers(receipt);
  return matchTransfers(payment, transfers);
}
