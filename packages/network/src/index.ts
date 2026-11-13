/**
 * LumiBase Network
 *
 * Blockchain client and network configuration for supported chains.
 * Provides chain definitions, token registry lookups, environment-driven
 * configuration, viem client construction, resilient read primitives, and
 * confirmation-policy evaluation.
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

export { checkConfirmations, countConfirmations } from './final.ts';
export type { FinalityResult } from './final.ts';

export { decodeTransfers } from './log.ts';
export type { Erc20Transfer } from './log.ts';

export { getBlockNumber, getReceipt, getTransaction, waitForBlock } from './read.ts';
export type { ReadOptions } from './read.ts';

export { assertToken, findToken } from './token.ts';

export const VERSION = '0.1.0';
