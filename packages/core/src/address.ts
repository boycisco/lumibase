/**
 * EVM address parsing and validation.
 *
 * An EVM address is 20 bytes, expressed as a 40-character hex string
 * prefixed by "0x". There are two valid string forms:
 *
 *   - All lowercase:     0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed
 *   - EIP-55 checksummed: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed
 *
 * All-uppercase hex ("0X..." or "0xABC...") is NOT accepted because it
 * carries no checksum information and is ambiguous with lowercase.
 * Mixed-case strings MUST be valid EIP-55 checksums.
 *
 * This file enforces exactly those rules. It never silently repairs input.
 * Canonical internal form is lowercase (`normalizeAddress`).
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes } from '@noble/hashes/utils';
import { validationError } from './error.js';

/** Regex for a strictly lowercase, checksum-less address. */
const LOWERCASE = /^0x[0-9a-f]{40}$/;

/** Regex for any valid-format hex address (case not validated). */
const HEXISH = /^0x[0-9a-fA-F]{40}$/;

/**
 * Return true if the string is a valid EVM address, honoring EIP-55.
 *
 * Rules:
 *   - must start with lowercase "0x"
 *   - must have exactly 40 hex characters after the prefix
 *   - all-lowercase: valid (checksum-less)
 *   - mixed-case: must be a valid EIP-55 checksum, otherwise false
 *   - all-uppercase (after 0x): invalid
 */
export function isAddress(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (!HEXISH.test(value)) return false;

  // All-lowercase (checksum-less) is allowed.
  if (LOWERCASE.test(value)) return true;

  // Otherwise, must be a valid EIP-55 checksum. The input's mixed case
  // must match exactly what EIP-55 derives from its lowercase form.
  const body = value.slice(2);
  return body === checksumBody(body);
}

/**
 * Throw a LumiError if the string is not a valid EVM address.
 *
 * Use this at API boundaries and before any persistence. Never trust a
 * client-provided address without calling this.
 */
export function assertAddress(value: string): string {
  if (typeof value !== 'string') {
    throw validationError('Address must be a string.', {
      received: typeof value,
    });
  }
  if (!HEXISH.test(value)) {
    throw validationError('Address must be 0x followed by 40 hex characters.', {
      value,
    });
  }
  if (!isAddress(value)) {
    throw validationError('Address has an invalid EIP-55 checksum.', { value });
  }
  return value;
}

/**
 * Return the canonical lowercase form of an address.
 *
 * Throws if the input is not a valid address (see isAddress).
 */
export function normalizeAddress(value: string): string {
  assertAddress(value);
  return value.toLowerCase();
}

/**
 * Return the EIP-55 checksummed form of an address.
 *
 * Accepts both lowercase and already-checksummed input. Throws on invalid
 * input (see isAddress).
 */
export function checksumAddress(value: string): string {
  const lower = normalizeAddress(value);
  return `0x${checksumBody(lower.slice(2))}`;
}

/**
 * Compute the EIP-55 checksum casing of a 40-char hex body.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-55
 *
 * The input is always lowercased internally. For each hex character, we
 * look at the corresponding nibble of keccak256(lowercase_body_ascii);
 * if that nibble is >= 8, the character is uppercased, otherwise it is
 * lowercased.
 */
function checksumBody(body: string): string {
  const lower = body.toLowerCase();
  const hash = keccak_256(utf8ToBytes(lower));
  let out = '';
  for (let i = 0; i < lower.length; i += 1) {
    const ch = lower[i]!;
    const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    out += nibble >= 8 ? ch.toUpperCase() : ch.toLowerCase();
  }
  return out;
}
