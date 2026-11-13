/**
 * LumiBase Network
 *
 * Blockchain client and network configuration for supported chains.
 * Provides chain definitions, token registry lookups, environment-driven
 * configuration, and viem client construction.
 */

export {
  BASE_MAINNET,
  BASE_MAINNET_USDC,
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC,
  DEFINITIONS,
  toChainConfig,
} from './chain.ts';
export type { ChainDefinition, ResolvedChain, TokenConfig } from './chain.ts';

export { createClient } from './client.ts';

export { loadNetworkConfig, requireChain } from './config.ts';
export type { NetworkConfig } from './config.ts';

export { assertToken, findToken } from './token.ts';

export const VERSION = '0.1.0';
