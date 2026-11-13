import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BASE_MAINNET,
  BASE_MAINNET_USDC,
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC,
  DEFINITIONS,
} from '../src/chain.ts';

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, '../../../specs/network/chains.json');

interface SpecToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  enabled: boolean;
}

interface SpecChain {
  id: number;
  name: string;
  testnet: boolean;
  enabled: boolean;
  native: { name: string; symbol: string; decimals: number };
  explorer: string;
  confirmation: { blocks: number; finality: string };
  tokens: SpecToken[];
}

interface Spec {
  chains: Record<string, SpecChain>;
}

const spec: Spec = JSON.parse(readFileSync(specPath, 'utf8'));

describe('chain definitions match specs/network/chains.json', () => {
  it.each(DEFINITIONS)('chain $name ($id) matches spec', (def) => {
    const expected = spec.chains[String(def.id)];
    expect(expected, `chain ${def.id} missing from spec`).toBeDefined();
    expect(def.name).toBe(expected!.name);
    expect(def.testnet).toBe(expected!.testnet);
    expect(def.enabled).toBe(expected!.enabled);
    expect(def.native).toEqual(expected!.native);
    expect(def.explorer).toBe(expected!.explorer);
    expect(def.confirmation.blocks).toBe(expected!.confirmation.blocks);
    expect(def.confirmation.finality).toBe(expected!.confirmation.finality);
    expect(def.tokens).toHaveLength(expected!.tokens.length);
    for (let i = 0; i < expected!.tokens.length; i += 1) {
      expect(def.tokens[i]).toEqual(expected!.tokens[i]);
    }
  });

  it("spec has no chains that we don't define", () => {
    const specIds = Object.keys(spec.chains).map(Number).sort();
    const defIds = DEFINITIONS.map((d) => d.id).sort();
    expect(defIds).toEqual(specIds);
  });
});

describe('safety gates', () => {
  it('Base Sepolia is enabled and testnet', () => {
    expect(BASE_SEPOLIA.enabled).toBe(true);
    expect(BASE_SEPOLIA.testnet).toBe(true);
  });

  it('Base Mainnet is disabled and not testnet', () => {
    expect(BASE_MAINNET.enabled).toBe(false);
    expect(BASE_MAINNET.testnet).toBe(false);
  });

  it('Base Mainnet USDC is disabled', () => {
    expect(BASE_MAINNET_USDC.enabled).toBe(false);
  });

  it('Base Sepolia USDC is enabled', () => {
    expect(BASE_SEPOLIA_USDC.enabled).toBe(true);
  });

  it('USDC uses 6 decimals on both chains', () => {
    expect(BASE_SEPOLIA_USDC.decimals).toBe(6);
    expect(BASE_MAINNET_USDC.decimals).toBe(6);
  });
});
