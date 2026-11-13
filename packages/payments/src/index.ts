/**
 * LumiBase Payments
 *
 * The flagship capability: accepting and verifying onchain USDC payments on
 * Base. Composes @lumibase/core (exact amounts, addresses, errors),
 * @lumibase/network (chain config, RPC reads, confirmation policy), and
 * @lumibase/database (persistence) into a payment service whose behavior
 * matches specs/payments/*.json exactly.
 *
 * Batch 1 (this version) provides types, errors, and config only. Service
 * methods are added in Batches 2-4.
 */

export { paymentError } from './error.ts';

export { resolveConfig } from './config.ts';
export type { PaymentConfig, ResolvedConfig } from './config.ts';

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

export const VERSION = '0.1.0';
