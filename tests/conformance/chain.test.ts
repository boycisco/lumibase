import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

interface Token {
  address: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
}

interface Chain {
  id: number;
  name: string;
  testnet: boolean;
  enabled: boolean;
  native: { symbol: string; decimals: number };
  confirmation: { blocks: number };
  tokens: Token[];
}

interface Chains {
  chains: Record<string, Chain>;
}

interface ChainCase {
  id: number;
  name: string;
  testnet: boolean;
  enabled: boolean;
  nativeSymbol: string;
  nativeDecimals: number;
  confirmationBlocks: number;
  tokens: Token[];
}

interface Cases {
  chains: ChainCase[];
}

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(here, relativePath), 'utf8')) as T;
}

const chains = loadJson<Chains>('../../specs/network/chains.json');
const cases = loadJson<Cases>('../fixtures/chain/cases.json');

describe('chains.json matches expectations', () => {
  it.each(cases.chains)('$name ($id) matches fixture', (expected) => {
    const actual = chains.chains[String(expected.id)];
    expect(actual, `chain ${expected.id} missing from chains.json`).toBeDefined();
    expect(actual!.name).toBe(expected.name);
    expect(actual!.testnet).toBe(expected.testnet);
    expect(actual!.enabled).toBe(expected.enabled);
    expect(actual!.native.symbol).toBe(expected.nativeSymbol);
    expect(actual!.native.decimals).toBe(expected.nativeDecimals);
    expect(actual!.confirmation.blocks).toBe(expected.confirmationBlocks);
    expect(actual!.tokens).toHaveLength(expected.tokens.length);
    for (let i = 0; i < expected.tokens.length; i += 1) {
      expect(actual!.tokens[i]).toMatchObject(expected.tokens[i]!);
    }
  });

  it('Base Mainnet is disabled (the safety gate)', () => {
    const mainnet = chains.chains['8453'];
    expect(mainnet, 'Base Mainnet must be present in chains.json').toBeDefined();
    expect(mainnet!.enabled).toBe(false);
    for (const token of mainnet!.tokens) {
      expect(token.enabled, `mainnet token ${token.symbol} must be disabled`).toBe(false);
    }
  });

  it('Base Sepolia is enabled (the testnet)', () => {
    const sepolia = chains.chains['84532'];
    expect(sepolia, 'Base Sepolia must be present in chains.json').toBeDefined();
    expect(sepolia!.enabled).toBe(true);
  });

  it('chain IDs match their map keys', () => {
    for (const [key, chain] of Object.entries(chains.chains)) {
      expect(String(chain.id)).toBe(key);
    }
  });
});
