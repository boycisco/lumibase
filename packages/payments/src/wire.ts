/**
 * Internal ↔ wire-format conversion for payments.
 *
 * The wire format is defined by specs/schemas/payment.json and is what
 * appears in API responses and event payloads. Internal representation
 * differs in three ways:
 *   - `amount`: bigint internally, decimal string on the wire
 *   - `tokenAddress`: bigint-parallel naming internally, `token` on the wire
 *     (matching the schema)
 *   - dates: Date internally, ISO 8601 strings on the wire
 *
 * The conversion is lossless in both directions. This file is the only
 * place these differences are encoded.
 */

import type { Payment } from './types.ts';

/**
 * Wire-format payment (see specs/schemas/payment.json).
 */
export interface WirePayment {
  readonly id: string;
  readonly applicationId: string;
  readonly chainId: number;
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
  readonly payer: string | null;
  readonly reference: string | null;
  readonly status: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Convert an internal Payment to its wire representation.
 *
 * Optional fields (metadata) are omitted entirely rather than set to null,
 * matching the schema's "not required" semantics. null is a valid value for
 * payer and reference (the schema declares both as string-or-null).
 */
export function toWirePayment(payment: Payment): WirePayment {
  const wire: WirePayment = {
    id: payment.id,
    applicationId: payment.applicationId,
    chainId: payment.chainId,
    token: payment.tokenAddress,
    amount: payment.amount.toString(),
    recipient: payment.recipient,
    payer: payment.payer,
    reference: payment.reference,
    status: payment.status,
    expiresAt: payment.expiresAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
  return payment.metadata !== null ? { ...wire, metadata: payment.metadata } : wire;
}
