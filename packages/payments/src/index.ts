/**
 * LumiBase Payments
 *
 * The flagship capability: accepting and verifying onchain USDC payments on
 * Base. Composes @lumibase/core, @lumibase/network, and @lumibase/database
 * into a payment service whose behavior matches specs/payments/*.json.
 */

export { recordAttempt } from './attempt.ts';
export type { AttemptStatus, RecordAttemptInput, RecordAttemptResult } from './attempt.ts';

export { cancelPayment } from './cancel.ts';

export { confirmPayment } from './confirm.ts';
export type { ConfirmInput, ConfirmResult } from './confirm.ts';

export {
  MAX_EXPIRES_IN,
  MAX_METADATA_BYTES,
  MAX_REFERENCE_LENGTH,
  createPayment,
} from './create.ts';

export { paymentError } from './error.ts';

export { resolveConfig } from './config.ts';
export type { PaymentConfig, ResolvedConfig } from './config.ts';

export { expirePayment, expirePending } from './expire.ts';

export { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, getPayment, listPayments } from './read.ts';

export {
  PAYMENT_ERROR_CODES,
  PAYMENT_FAILED_REASONS,
  PAYMENT_STATUSES,
  TERMINAL_STATUSES,
} from './types.ts';
export type {
  CreatePaymentInput,
  Payment,
  PaymentErrorCode,
  PaymentFailedReason,
  PaymentStatus,
} from './types.ts';

export { matchTransfers, verifyTransfers } from './verify.ts';
export type { MatchVerdict, VerifyVerdict } from './verify.ts';

export { toWirePayment } from './wire.ts';
export type { WirePayment } from './wire.ts';

export const VERSION = '0.1.0';
