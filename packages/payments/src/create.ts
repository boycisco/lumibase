/**
 * Create payment service.
 *
 * Accepts a CreatePaymentInput, validates every field, persists the payment
 * and its payment.created event atomically, and returns the internal
 * Payment object. The caller (the API layer in Phase 8) is responsible for
 * converting to wire format for the response.
 *
 * Validation order: shape (400) -> addresses (400) -> semantic (422) ->
 * persistence. Every rejection happens before the DB is touched.
 *
 * The payment row and its payment.created event are written in a SINGLE
 * database transaction (Option B from Phase 6 design). If either insert
 * fails, both roll back.
 *
 * `applicationId` is assumed to have been authenticated by the caller
 * (Phase 8). The FK constraint on payments.application_id is defense in
 * depth against a missing application.
 */

import { normalizeAddress, serializeAmount, validationError } from '@lumibase/core';
import { events, payments } from '@lumibase/database';
import { findToken } from '@lumibase/network';
import type { ResolvedConfig } from './config.ts';
import { paymentError } from './error.ts';
import type { CreatePaymentInput, Payment } from './types.ts';
import { toWirePayment } from './wire.ts';

/** 30 days in seconds. Upper bound on expiresIn. */
export const MAX_EXPIRES_IN = 30 * 24 * 60 * 60;

/** 8 KiB per specs/payments/payment.json metadata description. */
export const MAX_METADATA_BYTES = 8 * 1024;

/** 256 chars per specs/schemas/payment.json reference.maxLength. */
export const MAX_REFERENCE_LENGTH = 256; /**
 * Create a new payment request in pending state.
 */
export async function createPayment(
  config: ResolvedConfig,
  input: CreatePaymentInput,
): Promise<Payment> {
  // ---- 1. Shape validation ----

  if (input.amount <= 0n) {
    throw validationError('Amount must be a positive integer (base units).');
  }
  serializeAmount(input.amount);

  if (!Number.isInteger(input.expiresIn) || input.expiresIn <= 0) {
    throw validationError('expiresIn must be a positive integer (seconds).', {
      expiresIn: input.expiresIn,
    });
  }
  if (input.expiresIn > MAX_EXPIRES_IN) {
    throw validationError(`expiresIn must be at most ${MAX_EXPIRES_IN} seconds (30 days).`, {
      expiresIn: input.expiresIn,
      max: MAX_EXPIRES_IN,
    });
  }

  if (input.reference !== undefined && input.reference !== null) {
    if (typeof input.reference !== 'string') {
      throw validationError('reference must be a string or null.');
    }
    if (input.reference.length > MAX_REFERENCE_LENGTH) {
      throw validationError(`reference must be at most ${MAX_REFERENCE_LENGTH} characters.`, {
        length: input.reference.length,
        max: MAX_REFERENCE_LENGTH,
      });
    }
  }

  if (input.metadata !== undefined && input.metadata !== null) {
    if (typeof input.metadata !== 'object') {
      throw validationError('metadata must be an object or null.');
    }
    const bytes = Buffer.byteLength(JSON.stringify(input.metadata), 'utf8');
    if (bytes > MAX_METADATA_BYTES) {
      throw validationError(
        `metadata serialized size must be at most ${MAX_METADATA_BYTES} bytes.`,
        { bytes, max: MAX_METADATA_BYTES },
      );
    }
  }
  // ---- 2. Address validation ----

  const recipient = normalizeAddress(input.recipient) as `0x${string}`;
  const payer: `0x${string}` | null =
    input.payer === undefined || input.payer === null
      ? null
      : (normalizeAddress(input.payer) as `0x${string}`);

  // ---- 3. Semantic validation ----

  const chain = config.chains.chains.get(input.chainId);
  if (!chain) {
    throw paymentError('UNSUPPORTED_CHAIN', `Chain ${input.chainId} is not supported.`, {
      chainId: input.chainId,
    });
  }
  if (!chain.enabled) {
    throw paymentError(
      'UNSUPPORTED_CHAIN',
      `Chain ${input.chainId} (${chain.name}) is currently disabled.`,
      { chainId: input.chainId },
    );
  }

  const token = findToken(chain, input.token);
  if (!token) {
    throw paymentError(
      'UNSUPPORTED_TOKEN',
      `Token ${input.token} is not registered on chain ${input.chainId}.`,
      { chainId: input.chainId, token: input.token },
    );
  }
  if (!token.enabled) {
    throw paymentError(
      'UNSUPPORTED_TOKEN',
      `Token ${token.symbol} on chain ${input.chainId} is currently disabled.`,
      { chainId: input.chainId, symbol: token.symbol },
    );
  }
  // ---- 4. Persistence ----

  const id = config.idGenerator();
  const now = config.clock();
  const expiresAt = new Date(now.getTime() + input.expiresIn * 1000);

  const payment: Payment = {
    id,
    applicationId: input.applicationId,
    reference: input.reference ?? null,
    chainId: chain.id,
    tokenAddress: token.address.toLowerCase() as `0x${string}`,
    amount: input.amount,
    recipient,
    payer,
    status: 'pending',
    expiresAt,
    metadata: input.metadata ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const eventId = config.idGenerator();

  await config.db.transaction(async (tx) => {
    await tx.insert(payments).values({
      id: payment.id,
      applicationId: payment.applicationId,
      reference: payment.reference,
      chainId: payment.chainId,
      tokenAddress: payment.tokenAddress,
      amount: payment.amount.toString(),
      recipient: payment.recipient,
      payer: payment.payer,
      status: payment.status,
      expiresAt: payment.expiresAt,
      metadata: payment.metadata,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    });

    await tx.insert(events).values({
      id: eventId,
      applicationId: payment.applicationId,
      paymentId: payment.id,
      type: 'payment.created',
      payload: { payment: toWirePayment(payment) },
      createdAt: now,
    });
  });

  return payment;
}
