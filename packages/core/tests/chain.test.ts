import { describe, expect, it } from 'vitest';
import { assertChain, assertChainId, assertEnabled, type ChainConfig } from '../src/chain.js';
import { LumiError } from '../src/error.js';

const GOOD: ChainConfig = {
  id: 84532,
  name: 'Base Sepolia',
  native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpc: 'https://sepolia.base.org',
  explorer: 'https://sepolia.basescan.org',
  testnet: true,
  enabled: true,
};

describe('assertChain', () => {
  it('accepts a well-formed config', () => {
    expect(() => assertChain(GOOD)).not.toThrow();
  });

  it('rejects id <= 0', () => {
    expect(() => assertChain({ ...GOOD, id: 0 })).toThrow(LumiError);
    expect(() => assertChain({ ...GOOD, id: -1 })).toThrow(LumiError);
  });

  it('rejects non-integer id', () => {
    expect(() => assertChain({ ...GOOD, id: 1.5 })).toThrow(LumiError);
  });

  it('rejects missing name', () => {
    expect(() => assertChain({ ...GOOD, name: '' })).toThrow(LumiError);
  });

  it('rejects non-http rpc', () => {
    expect(() => assertChain({ ...GOOD, rpc: 'ws://example.com' })).toThrow(LumiError);
    expect(() => assertChain({ ...GOOD, rpc: '' })).toThrow(LumiError);
  });

  it('rejects non-http explorer', () => {
    expect(() => assertChain({ ...GOOD, explorer: 'ftp://x' })).toThrow(LumiError);
  });
});

describe('assertEnabled', () => {
  it('passes for enabled chains', () => {
    expect(() => assertEnabled(GOOD)).not.toThrow();
  });

  it('throws for disabled chains (the mainnet safety gate)', () => {
    expect(() => assertEnabled({ ...GOOD, enabled: false })).toThrow(LumiError);
  });
});

describe('assertChainId', () => {
  it('passes when ids match', () => {
    expect(() => assertChainId(GOOD, 84532)).not.toThrow();
  });

  it('throws when ids differ (wrong network)', () => {
    expect(() => assertChainId(GOOD, 8453)).toThrow(LumiError);
  });
});
