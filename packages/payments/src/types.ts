/**
 * Payment domain types.
 *
 * These types are the TypeScript transcription of specs/payments/*.json.
 * The corresponding test file (tests/types.test.ts) reads those spec files
 * and asserts these runtime arrays match EXACTLY. Any drift fails CI.
 *
 * Internal representation choices:
 *   - `amount` is `bigint`, not string, not number. Every amount that enters
 *     the service is converted once at the API boundary (Phase 8) and stays
 *     bigint everywhere inside the payment module.
 *   - `tokenAddress`, `recipient`, `payer` are lowercase hex (`0x${string}`).
 *     Canonical storage is lowercase; EIP-55 display conversion happens at
 *     the API boundary.
 *   - Dates are `Date` objects internally; ISO strings on the wire.
 *   - `metadata` is a plain JSON object or null.
 *
 * The wire format (what consumers see in API responses and webhook events)
 * is defined by specs/schemas/payment.json. Conversion between internal and
 * wire happens in the API layer, never inside this module.
 */

/**
 * The eight payment lifecycle statuses from
 * specs/payments/lifecycle.json statuses.
 */
export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'expired'
  | 'failed'
  | 'cancelled'
  | 'underpaid'
  | 'overpaid';

/**
 * Payment-specific API error codes from specs/payments/errors.json codes.
 * Cross-cutting codes (VALIDATION_ERROR, NOT_FOUND, ...) are inherited from
 * @lumibase/core's LumiError and are NOT listed here.
 */
export type PaymentErrorCode =
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_EXPIRED'
  | 'PAYMENT_ALREADY_CONFIRMED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_INVALID_STATE'
  | 'PAYMENT_VERIFICATION_IN_PROGRESS'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_REVERTED'
  | 'TRANSACTION_ALREADY_PROCESSED'
  | 'TRANSACTION_WRONG_NETWORK'
  | 'TRANSACTION_WRONG_RECIPIENT'
  | 'TRANSACTION_WRONG_TOKEN'
  | 'TRANSACTION_WRONG_SENDER'
  | 'TRANSACTION_NOT_ENOUGH_CONFIRMATIONS'
  | 'TRANSACTION_RPC_FAILURE'
  | 'UNSUPPORTED_CHAIN'
  | 'UNSUPPORTED_TOKEN'
  | 'WEBHOOK_INVALID_ENDPOINT';

/**
 * Reason codes attached to `payment.failed` events (specs/payments/errors.json
 * reasons.values). Distinct from PaymentErrorCode: these describe the failing
 * payment outcome in a webhook, whereas codes describe a failing API request.
 *
 * Reserved for v0.2+: `failed` is unreachable through the v0.1 confirm path
 * (see lifecycle.json failure.v01ConfirmNeverFails).
 */
export type PaymentFailedReason =
  | 'RECIPIENT_MISMATCH'
  | 'TOKEN_MISMATCH'
  | 'SENDER_MISMATCH'
  | 'TRANSACTION_REVERTED'
  | 'INSUFFICIENT_CONFIRMATIONS'
  | 'VERIFICATION_TIMEOUT'
  | 'TRANSACTION_ALREADY_PROCESSED';

/**
 * Runtime-iterable list of statuses. Order is spec order (lifecycle.json
 * statuses declaration order). Used for validation, tests, and admin UIs.
 */
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'pending',
  'processing',
  'confirmed',
  'expired',
  'failed',
  'cancelled',
  'underpaid',
  'overpaid',
];

/**
 * Runtime-iterable list of error codes. Matches specs/payments/errors.json
 * codes keys exactly.
 */
export const PAYMENT_ERROR_CODES: readonly PaymentErrorCode[] = [
  'PAYMENT_NOT_FOUND',
  'PAYMENT_EXPIRED',
  'PAYMENT_ALREADY_CONFIRMED',
  'PAYMENT_CANCELLED',
  'PAYMENT_INVALID_STATE',
  'PAYMENT_VERIFICATION_IN_PROGRESS',
  'TRANSACTION_NOT_FOUND',
  'TRANSACTION_REVERTED',
  'TRANSACTION_ALREADY_PROCESSED',
  'TRANSACTION_WRONG_NETWORK',
  'TRANSACTION_WRONG_RECIPIENT',
  'TRANSACTION_WRONG_TOKEN',
  'TRANSACTION_WRONG_SENDER',
  'TRANSACTION_NOT_ENOUGH_CONFIRMATIONS',
  'TRANSACTION_RPC_FAILURE',
  'UNSUPPORTED_CHAIN',
  'UNSUPPORTED_TOKEN',
  'WEBHOOK_INVALID_ENDPOINT',
];

/**
 * Runtime-iterable list of payment.failed reason codes.
 */
export const PAYMENT_FAILED_REASONS: readonly PaymentFailedReason[] = [
  'RECIPIENT_MISMATCH',
  'TOKEN_MISMATCH',
  'SENDER_MISMATCH',
  'TRANSACTION_REVERTED',
  'INSUFFICIENT_CONFIRMATIONS',
  'VERIFICATION_TIMEOUT',
  'TRANSACTION_ALREADY_PROCESSED',
];

/**
 * Statuses that, per lifecycle.json rules, cannot transition to anything else.
 * Used to enforce no_recovery_from_terminal.
 */
export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'confirmed',
  'expired',
  'failed',
  'cancelled',
  'underpaid',
  'overpaid',
]);

/**
 * Internal payment representation.
 *
 * Note: `amount` is `bigint`. Database uses `numeric(78,0)`; Drizzle returns
 * that as a string; the service converts to bigint at the boundary.
 */
export interface Payment {
  readonly id: string;
  readonly applicationId: string;
  readonly reference: string | null;
  readonly chainId: number;
  readonly tokenAddress: `0x${string}`;
  readonly amount: bigint;
  readonly recipient: `0x${string}`;
  readonly payer: `0x${string}` | null;
  readonly status: PaymentStatus;
  readonly expiresAt: Date;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Input to the create-payment service method (Batch 2).
 *
 * `amount` is bigint. The API layer (Phase 8) converts the wire-format
 * string using @lumibase/core's deserializeAmount before calling the service.
 * That keeps the payment module free of any string parsing or floating-point
 * risk.
 *
 * `expiresIn` is seconds from `clock()`. Service computes `expiresAt =
 * clock() + expiresIn*1000`.
 */
export interface CreatePaymentInput {
  readonly applicationId: string;
  readonly chainId: number;
  readonly token: `0x${string}`;
  readonly amount: bigint;
  readonly recipient: `0x${string}`;
  readonly payer?: `0x${string}` | null;
  readonly reference?: string | null;
  readonly expiresIn: number;
  readonly metadata?: Record<string, unknown> | null;
}
