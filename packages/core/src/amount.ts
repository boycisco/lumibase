/**
 * Exact integer arithmetic for token amounts.
 *
 * LumiBase NEVER uses JavaScript `number` for money. All amounts are
 * `bigint` values representing the smallest indivisible unit of a token
 * ("base units"). For USDC, that is 6 decimals, so 1.50 USDC is 1_500_000n.
 *
 * Inputs (JSON, HTTP, env vars) arrive as decimal strings. Conversion must
 * go through the functions here. Do NOT use Number(str), parseInt, or any
 * arithmetic on `number` values for amounts. Both silently lose precision
 * above 2^53 and coerce malformed input to 0.
 *
 * The rules here mirror specs/payments/lifecycle.json (Phase 3). Python and
 * Rust implementations must behave identically; do not change behavior here
 * without changing the spec.
 */

import { validationError } from './error.js';

/** 2^256 - 1, the largest value a uint256 token amount can represent. */
export const MAX_UINT256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

/** Highest supported token decimals. Real tokens do not exceed this. */
const MAX_DECIMALS = 36;

/** Digits in MAX_UINT256. Used to reject huge strings before BigInt parsing. */
const MAX_DIGITS = MAX_UINT256.toString().length;

const DECIMAL_STRING = /^(0|[1-9][0-9]*)$/;
const HUMAN_AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * Parse a non-negative integer (in base units) from its decimal string form.
 *
 * Rejects: negative values, decimals, scientific notation, leading "+",
 * leading zeros (except "0"), whitespace, hex, empty strings, and anything
 * larger than uint256.
 */
export function deserializeAmount(value: string): bigint {
  if (typeof value !== 'string') {
    throw validationError('Amount must be a decimal string.', {
      received: typeof value,
    });
  }
  if (value.length > MAX_DIGITS) {
    throw validationError('Amount exceeds the maximum uint256 value.', { value });
  }
  if (!DECIMAL_STRING.test(value)) {
    throw validationError('Amount must be a non-negative integer string without leading zeros.', {
      value,
    });
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) {
    throw validationError('Amount exceeds the maximum uint256 value.', { value });
  }
  return parsed;
}

/**
 * Serialize a base-unit bigint to its canonical decimal string form.
 *
 * The returned string never has a leading "+", never has leading zeros
 * (except "0" itself), and never has a decimal point.
 */
export function serializeAmount(value: bigint): string {
  if (typeof value !== 'bigint') {
    throw validationError('Amount must be a bigint.', {
      received: typeof value,
    });
  }
  if (value < 0n) {
    throw validationError('Amount must not be negative.', { value: value.toString() });
  }
  if (value > MAX_UINT256) {
    throw validationError('Amount exceeds the maximum uint256 value.', {
      value: value.toString(),
    });
  }
  return value.toString();
}

/**
 * Convert a human-readable decimal string ("1.50") to base units (1_500_000n
 * for a 6-decimal token).
 *
 * If the human amount has more fractional digits than the token allows, this
 * throws. It NEVER rounds or truncates. Silent rounding of money is the
 * failure mode this function exists to prevent.
 */
export function parseUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof value !== 'string') {
    throw validationError('Human amount must be a string.', {
      received: typeof value,
    });
  }
  if (!HUMAN_AMOUNT.test(value)) {
    throw validationError(
      "Human amount must be a non-negative decimal string like '1.5' or '150'.",
      { value },
    );
  }
  const [whole = '0', fraction = ''] = value.split('.');
  if (whole.length > MAX_DIGITS) {
    throw validationError('Amount exceeds the maximum uint256 value.', { value });
  }
  if (fraction.length > decimals) {
    throw validationError(
      `Human amount has ${fraction.length} fractional digits but token only allows ${decimals}.`,
      { value, decimals },
    );
  }
  const padded = fraction.padEnd(decimals, '0');
  const combined = BigInt(whole + padded);
  if (combined > MAX_UINT256) {
    throw validationError('Amount exceeds the maximum uint256 value.', { value });
  }
  return combined;
}

/**
 * Convert base units back to a human-readable decimal string.
 *
 * Trailing fractional zeros are trimmed, so 1_500_000n at 6 decimals
 * becomes "1.5", not "1.500000". Whole numbers have no decimal point.
 */
export function formatUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (typeof value !== 'bigint') {
    throw validationError('Amount must be a bigint.', {
      received: typeof value,
    });
  }
  if (value < 0n) {
    throw validationError('Amount must not be negative.', { value: value.toString() });
  }
  if (decimals === 0) return value.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fractionStr}`;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw validationError(`decimals must be an integer between 0 and ${MAX_DECIMALS}.`, {
      decimals,
    });
  }
}
