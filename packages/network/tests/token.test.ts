import { describe, expect, it } from 'vitest';
import { LumiError } from '@lumibase/core';
import {
  BASE_MAINNET,
  BASE_MAINNET_USDC,
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC,
  type ResolvedChain,
} from '../src/chain.ts';
import { assertToken, findToken } from '../src/token.ts';

const sepolia: ResolvedChain = { ...BASE_SEPOLIA, rpc: 'https://example.com' };
const mainnet: ResolvedChain = { ...BASE_MAINNET, rpc: 'https://example.com' };

describe('findToken', () => {
  it('finds USDC on Base Sepolia (exact case)', () => {
    const t = findToken(sepolia, BASE_SEPOLIA_USDC.address);
    expect(t).toBe(BASE_SEPOLIA_USDC);
  });

  it('finds USDC on Base Sepolia (lowercase)', () => {
    const t = findToken(sepolia, BASE_SEPOLIA_USDC.address.toLowerCase());
    expect(t).toBe(BASE_SEPOLIA_USDC);
  });

  it('finds USDC on Base Sepolia (uppercase hex body)', () => {
    const upper = '0x' + BASE_SEPOLIA_USDC.address.slice(2).toUpperCase();
    const t = findToken(sepolia, upper);
    expect(t).toBe(BASE_SEPOLIA_USDC);
  });

  it('returns undefined for an unknown address', () => {
    expect(findToken(sepolia, '0x0000000000000000000000000000000000000000')).toBeUndefined();
  });

  it('does not find Mainnet USDC on Sepolia', () => {
    expect(findToken(sepolia, BASE_MAINNET_USDC.address)).toBeUndefined();
  });
});

describe('assertToken', () => {
  it('returns the token for a registered enabled token', () => {
    expect(assertToken(sepolia, BASE_SEPOLIA_USDC.address)).toBe(BASE_SEPOLIA_USDC);
  });

  it('throws LumiError for an unknown token', () => {
    expect(() => assertToken(sepolia, '0x0000000000000000000000000000000000000000')).toThrow(
      LumiError,
    );
  });

  it('throws LumiError for a disabled token (Mainnet USDC)', () => {
    expect(() => assertToken(mainnet, BASE_MAINNET_USDC.address)).toThrow(LumiError);
  });
});
