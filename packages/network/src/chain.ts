/**
 * Chain definitions for the networks LumiBase supports.
 *
 * IMPORTANT: this file is a TypeScript transcription of
 * specs/network/chains.json. Any change to one must be mirrored in the other.
 * The test file tests/chain.test.ts reads specs/network/chains.json and
 * asserts these definitions match — so drift fails CI, not silently ships.
 *
 * `rpc` is NOT here. RPC endpoints are per-environment configuration, not
 * protocol constants. They are supplied at runtime via loadNetworkConfig()
 * which produces ResolvedChain objects.
 */

import type { ChainConfig, ConfirmationPolicy, NativeCurrency } from '@lumibase/core';

export interface TokenConfig {
  readonly address: `0x${string}`;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly enabled: boolean;
}

/**
 * A chain as declared by the protocol — everything except the RPC URL.
 */
export interface ChainDefinition {
  readonly id: number;
  readonly name: string;
  readonly native: NativeCurrency;
  readonly explorer: string;
  readonly testnet: boolean;
  readonly enabled: boolean;
  readonly confirmation: ConfirmationPolicy;
  readonly tokens: readonly TokenConfig[];
}

/**
 * A chain with its RPC URL resolved from environment configuration.
 */
export interface ResolvedChain extends ChainDefinition {
  readonly rpc: string;
}

const ETH: NativeCurrency = { name: 'Ether', symbol: 'ETH', decimals: 18 };
const SOFT_12: ConfirmationPolicy = { blocks: 12, finality: 'soft' };

export const BASE_SEPOLIA_USDC: TokenConfig = {
  address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  enabled: true,
};

export const BASE_MAINNET_USDC: TokenConfig = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  enabled: false,
};

export const BASE_SEPOLIA: ChainDefinition = {
  id: 84532,
  name: 'Base Sepolia',
  native: ETH,
  explorer: 'https://sepolia.basescan.org',
  testnet: true,
  enabled: true,
  confirmation: SOFT_12,
  tokens: [BASE_SEPOLIA_USDC],
};

export const BASE_MAINNET: ChainDefinition = {
  id: 8453,
  name: 'Base Mainnet',
  native: ETH,
  explorer: 'https://basescan.org',
  testnet: false,
  enabled: false,
  confirmation: SOFT_12,
  tokens: [BASE_MAINNET_USDC],
};

export const DEFINITIONS: readonly ChainDefinition[] = [BASE_SEPOLIA, BASE_MAINNET];

/**
 * Convert a ResolvedChain to the ChainConfig shape expected by
 * @lumibase/core assertions.
 */
export function toChainConfig(chain: ResolvedChain): ChainConfig {
  return {
    id: chain.id,
    name: chain.name,
    native: chain.native,
    rpc: chain.rpc,
    explorer: chain.explorer,
    testnet: chain.testnet,
    enabled: chain.enabled,
  };
}
