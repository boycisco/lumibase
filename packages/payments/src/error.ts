/**
 * Payment-specific error factory.
 *
 * Wraps @lumibase/core's LumiError with the HTTP status codes declared in
 * specs/payments/errors.json. The mapping is a plain record so the test
 * file can cross-check it against the spec at test time.
 *
 * If a new payment error code is added to the spec, this file MUST gain a
 * corresponding entry. The test catches omissions.
 */

import { LumiError } from '@lumibase/core';
import type { PaymentErrorCode } from './types.ts';

/**
 * HTTP status for each payment error code, transcribed from
 * specs/payments/errors.json codes[*].httpStatus.
 */
const STATUS_BY_CODE: Record<PaymentErrorCode, number> = {
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_EXPIRED: 409,
  PAYMENT_ALREADY_CONFIRMED: 409,
  PAYMENT_CANCELLED: 409,
  PAYMENT_INVALID_STATE: 409,
  PAYMENT_VERIFICATION_IN_PROGRESS: 409,
  TRANSACTION_NOT_FOUND: 404,
  TRANSACTION_REVERTED: 422,
  TRANSACTION_ALREADY_PROCESSED: 409,
  TRANSACTION_WRONG_NETWORK: 422,
  TRANSACTION_WRONG_RECIPIENT: 422,
  TRANSACTION_WRONG_TOKEN: 422,
  TRANSACTION_WRONG_SENDER: 422,
  TRANSACTION_NOT_ENOUGH_CONFIRMATIONS: 422,
  TRANSACTION_RPC_FAILURE: 503,
  UNSUPPORTED_CHAIN: 422,
  UNSUPPORTED_TOKEN: 422,
  WEBHOOK_INVALID_ENDPOINT: 422,
};

/**
 * Construct a LumiError with the correct HTTP status for the given payment
 * error code. Callers never pass statusCode — it always comes from the spec
 * mapping above.
 */
export function paymentError(
  code: PaymentErrorCode,
  message: string,
  details?: unknown,
): LumiError {
  return new LumiError(code, message, {
    statusCode: STATUS_BY_CODE[code],
    details,
  });
}
