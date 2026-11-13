import { describe, expect, it } from 'vitest';
import { assertAddress, checksumAddress, isAddress, normalizeAddress } from '../src/address.js';
import { LumiError } from '../src/error.js';

// Canonical EIP-55 test vectors from the specification.
const VECTORS = {
  lowercase: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  checksummed: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
};

describe('isAddress', () => {
  it('accepts a lowercase address', () => {
    expect(isAddress(VECTORS.lowercase)).toBe(true);
  });

  it('accepts a valid EIP-55 checksummed address', () => {
    expect(isAddress(VECTORS.checksummed)).toBe(true);
  });

  it('accepts the zero address', () => {
    expect(isAddress('0x0000000000000000000000000000000000000000')).toBe(true);
  });

  it('rejects addresses with invalid EIP-55 checksum', () => {
    // Flip one character's case: no longer a valid checksum.
    const bad = '0x5AAEB6053F3E94C9B9A09f33669435E7Ef1BeAed';
    expect(isAddress(bad)).toBe(false);
  });

  it.each([
    '',
    ' ',
    '0x',
    '0x5',
    '5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', // no 0x
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe', // 39 hex
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed1', // 41 hex
    '0xZZZZ000000000000000000000000000000000000', // non-hex
    '0x000000000000000000000000000000000000000g', // trailing non-hex
    '0X5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', // uppercase 0X
  ])('rejects malformed input %p', (input) => {
    expect(isAddress(input)).toBe(false);
  });

  it('returns false for non-string input', () => {
    // @ts-expect-error testing runtime safety
    expect(isAddress(42)).toBe(false);
    // @ts-expect-error testing runtime safety
    expect(isAddress(null)).toBe(false);
    // @ts-expect-error testing runtime safety
    expect(isAddress(undefined)).toBe(false);
  });
});

describe('assertAddress', () => {
  it('returns the input for valid lowercase', () => {
    expect(assertAddress(VECTORS.lowercase)).toBe(VECTORS.lowercase);
  });

  it('returns the input for valid checksummed', () => {
    expect(assertAddress(VECTORS.checksummed)).toBe(VECTORS.checksummed);
  });

  it('throws for invalid checksum', () => {
    expect(() => assertAddress('0x5AAEB6053F3E94C9B9A09f33669435E7Ef1BeAed')).toThrow(LumiError);
  });

  it('throws for malformed input', () => {
    expect(() => assertAddress('not-an-address')).toThrow(LumiError);
  });
});

describe('normalizeAddress', () => {
  it('lowercases the input', () => {
    expect(normalizeAddress(VECTORS.checksummed)).toBe(VECTORS.lowercase);
  });

  it('is a no-op for already-lowercase input', () => {
    expect(normalizeAddress(VECTORS.lowercase)).toBe(VECTORS.lowercase);
  });

  it('throws for invalid checksum (does not silently repair)', () => {
    expect(() => normalizeAddress('0x5AAEB6053F3E94C9B9A09f33669435E7Ef1BeAed')).toThrow(LumiError);
  });
});

describe('checksumAddress', () => {
  it('returns the EIP-55 form of a lowercase address', () => {
    expect(checksumAddress(VECTORS.lowercase)).toBe(VECTORS.checksummed);
  });

  it('is a no-op for already-checksummed input', () => {
    expect(checksumAddress(VECTORS.checksummed)).toBe(VECTORS.checksummed);
  });

  it('round-trips: normalize(checksum(x)) === x', () => {
    expect(normalizeAddress(checksumAddress(VECTORS.lowercase))).toBe(VECTORS.lowercase);
  });

  it('throws for malformed input', () => {
    expect(() => checksumAddress('0x123')).toThrow(LumiError);
  });
});
