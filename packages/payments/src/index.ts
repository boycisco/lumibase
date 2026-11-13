/**
 * LumiBase Payments
 *
 * The flagship capability: accepting and verifying onchain USDC payments on
 * Base. Composes @lumibase/core (exact amounts, addresses, errors),
 * @lumibase/network (chain config, RPC reads, confirmation policy), and
 * @lumibase/database (persistence) into a payment service whose behavior
 * matches specs/payments/*.json exactly.
 */

export { cancelPayment } from './cancel.ts';

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

export { toWirePayment } from './wire.ts';
export type { WirePayment } from './wire.ts';

export const VERSION = '0.1.0';
