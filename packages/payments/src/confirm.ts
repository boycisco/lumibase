/**
 * Confirm service.
 *
 * 1. Read payment (filtered by application)
 * 2. Terminal -> idempotent return
 * 3. Processing -> PAYMENT_VERIFICATION_IN_PROGRESS
 * 4. Pending + expired -> CAS to expired + emit, return PAYMENT_EXPIRED
 * 5. Claim: CAS pending -> processing + recordEvent(payment.processing)
 * 6. Fetch receipt; missing -> revert, return TRANSACTION_NOT_FOUND
 * 7. waitForBlock + verifyTransfers
 * 8. Branch: finalize (CAS + attempt + recordEvent(final)) or reject
 *
 * recordEvent is used for the two lifecycle events emitted here so their
 * webhook deliveries are scheduled in the same transaction as the event.
 */

import type { PublicClient, TransactionReceipt } from 'viem';
import { and, eq } from 'drizzle-orm';
import { payments, transactions } from '@lumibase/database';
import { createClient, getReceipt, waitForBlock, type Erc20Transfer } from '@lumibase/network';
import type { ResolvedConfig } from './config.ts';
import { expirePayment } from './expire.ts';
import { isUniqueViolation } from './attempt.ts';
import { recordEvent } from './notify.ts';
import { getPayment } from './read.ts';
import { rowToPayment } from './row.ts';
import { toWirePayment } from './wire.ts';
import { verifyTransfers } from './verify.ts';
import { TERMINAL_STATUSES, type Payment, type PaymentErrorCode } from './types.ts';

export interface ConfirmInput {
  readonly paymentId: string;
  readonly applicationId: string;
  readonly transactionHash: `0x${string}`;
}

export interface ConfirmResult {
  readonly payment: Payment;
  readonly error: PaymentErrorCode | null;
}

export async function confirmPayment(
  config: ResolvedConfig,
  input: ConfirmInput,
): Promise<ConfirmResult> {
  const now = config.clock();

  const payment = await getPayment(config, {
    paymentId: input.paymentId,
    applicationId: input.applicationId,
  });

  if (TERMINAL_STATUSES.has(payment.status)) {
    return { payment, error: null };
  }

  if (payment.status === 'processing') {
    return { payment, error: 'PAYMENT_VERIFICATION_IN_PROGRESS' };
  }

  if (payment.expiresAt <= now) {
    const expired = await expirePayment(config, payment.id);
    if (expired) {
      return { payment: expired, error: 'PAYMENT_EXPIRED' };
    }
    const current = await getPayment(config, {
      paymentId: input.paymentId,
      applicationId: input.applicationId,
    });
    return handleNonPendingState(current);
  }

  const claimed = await claim(config, payment, input.transactionHash);
  if (!claimed.ok) return claimed.result;

  return await verify(config, claimed.payment, input.transactionHash);
}

function handleNonPendingState(payment: Payment): ConfirmResult {
  if (TERMINAL_STATUSES.has(payment.status)) {
    return { payment, error: null };
  }
  if (payment.status === 'processing') {
    return { payment, error: 'PAYMENT_VERIFICATION_IN_PROGRESS' };
  }
  return { payment, error: 'PAYMENT_INVALID_STATE' };
}

async function claim(
  config: ResolvedConfig,
  payment: Payment,
  hash: `0x${string}`,
): Promise<{ ok: true; payment: Payment } | { ok: false; result: ConfirmResult }> {
  const now = config.clock();
  const claimed = await config.db.transaction(async (tx) => {
    const [row] = await tx
      .update(payments)
      .set({ status: 'processing', updatedAt: now })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
      .returning();
    if (!row) return null;
    const claimed = rowToPayment(row);
    await recordEvent(config, tx, {
      id: config.idGenerator(),
      applicationId: payment.applicationId,
      paymentId: payment.id,
      type: 'payment.processing',
      payload: {
        payment: toWirePayment(claimed),
        transactionHash: hash,
      },
      createdAt: now,
    });
    return claimed;
  });

  if (claimed) return { ok: true, payment: claimed };

  const current = await getPayment(config, {
    paymentId: payment.id,
    applicationId: payment.applicationId,
  });
  return { ok: false, result: handleNonPendingState(current) };
}

async function verify(
  config: ResolvedConfig,
  payment: Payment,
  hash: `0x${string}`,
): Promise<ConfirmResult> {
  const chain = config.chains.chains.get(payment.chainId);
  if (!chain || !chain.enabled) {
    return revert(config, payment, 'UNSUPPORTED_CHAIN');
  }

  let client: PublicClient;
  try {
    client = createClient(chain);
  } catch {
    return revert(config, payment, 'UNSUPPORTED_CHAIN');
  }

  let receipt: TransactionReceipt | null;
  try {
    receipt = await getReceipt(client, hash);
  } catch {
    return revert(config, payment, 'TRANSACTION_RPC_FAILURE');
  }
  if (!receipt) {
    return revert(config, payment, 'TRANSACTION_NOT_FOUND');
  }

  let head: bigint;
  try {
    head = await waitForBlock(client, receipt.blockNumber);
  } catch {
    return revert(config, payment, 'TRANSACTION_RPC_FAILURE');
  }

  const verdict = verifyTransfers(receipt, payment, head, chain.confirmation);

  switch (verdict.kind) {
    case 'matched':
      return finalize(config, payment, receipt, verdict.transfer, 'confirmed');
    case 'underpaid':
      return finalize(config, payment, receipt, verdict.transfer, 'underpaid');
    case 'overpaid':
      return finalize(config, payment, receipt, verdict.transfer, 'overpaid');
    case 'reverted':
      return reject(config, payment, receipt, 'TRANSACTION_REVERTED');
    case 'not_enough_confirmations':
      return reject(config, payment, receipt, 'TRANSACTION_NOT_ENOUGH_CONFIRMATIONS');
    case 'no_transfer':
      return reject(config, payment, receipt, 'TRANSACTION_WRONG_RECIPIENT');
    case 'wrong_token':
      return reject(config, payment, receipt, 'TRANSACTION_WRONG_TOKEN');
    case 'wrong_recipient':
      return reject(config, payment, receipt, 'TRANSACTION_WRONG_RECIPIENT');
    case 'wrong_sender':
      return reject(config, payment, receipt, 'TRANSACTION_WRONG_SENDER');
    case 'ambiguous':
      return reject(config, payment, receipt, 'PAYMENT_INVALID_STATE');
  }
}

async function revert(
  config: ResolvedConfig,
  payment: Payment,
  error: PaymentErrorCode,
): Promise<ConfirmResult> {
  const now = config.clock();
  const [row] = await config.db
    .update(payments)
    .set({ status: 'pending', updatedAt: now })
    .where(and(eq(payments.id, payment.id), eq(payments.status, 'processing')))
    .returning();
  if (!row) {
    throw new Error(`Payment ${payment.id} left processing state unexpectedly (revert)`);
  }
  return { payment: rowToPayment(row), error };
}

async function reject(
  config: ResolvedConfig,
  payment: Payment,
  receipt: TransactionReceipt,
  error: PaymentErrorCode,
): Promise<ConfirmResult> {
  const now = config.clock();

  const [row] = await config.db
    .update(payments)
    .set({ status: 'pending', updatedAt: now })
    .where(and(eq(payments.id, payment.id), eq(payments.status, 'processing')))
    .returning();
  if (!row) {
    throw new Error(`Payment ${payment.id} left processing state unexpectedly (reject)`);
  }

  let actualError: PaymentErrorCode = error;
  try {
    await config.db.insert(transactions).values({
      id: config.idGenerator(),
      paymentId: payment.id,
      chainId: payment.chainId,
      hash: receipt.transactionHash,
      sender: null,
      recipient: payment.recipient,
      tokenAddress: payment.tokenAddress,
      amount: '0',
      blockNumber: receipt.blockNumber,
      status: 'rejected',
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (isUniqueViolation(err, 'transactions_chain_hash_unique')) {
      actualError = 'TRANSACTION_ALREADY_PROCESSED';
    } else {
      throw err;
    }
  }

  return { payment: rowToPayment(row), error: actualError };
}

async function finalize(
  config: ResolvedConfig,
  payment: Payment,
  receipt: TransactionReceipt,
  transfer: Erc20Transfer,
  newStatus: 'confirmed' | 'underpaid' | 'overpaid',
): Promise<ConfirmResult> {
  const now = config.clock();

  try {
    return await config.db.transaction(async (tx) => {
      const [row] = await tx
        .update(payments)
        .set({ status: newStatus, updatedAt: now })
        .where(and(eq(payments.id, payment.id), eq(payments.status, 'processing')))
        .returning();
      if (!row) {
        throw new Error(`Payment ${payment.id} left processing state unexpectedly (finalize)`);
      }
      const finalPayment = rowToPayment(row);

      await tx.insert(transactions).values({
        id: config.idGenerator(),
        paymentId: payment.id,
        chainId: payment.chainId,
        hash: receipt.transactionHash,
        sender: transfer.from,
        recipient: transfer.to,
        tokenAddress: transfer.token,
        amount: transfer.value.toString(),
        blockNumber: receipt.blockNumber,
        status: 'verified',
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await recordEvent(config, tx, {
        id: config.idGenerator(),
        applicationId: payment.applicationId,
        paymentId: payment.id,
        type: `payment.${newStatus}`,
        payload: {
          payment: toWirePayment(finalPayment),
          transaction: {
            hash: receipt.transactionHash,
            blockNumber: receipt.blockNumber.toString(),
          },
        },
        createdAt: now,
      });

      return { payment: finalPayment, error: null };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'transactions_chain_hash_unique')) {
      return reject(config, payment, receipt, 'TRANSACTION_ALREADY_PROCESSED');
    }
    throw err;
  }
}
