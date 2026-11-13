/**
 * Chain and confirmation configuration.
 *
 * Core does not know which chains exist. That belongs to a future
 * `packages/network` module. This file only defines the SHAPE of a chain
 * configuration so every LumiBase module agrees on it.
 *
 * Language-agnostic form lives at specs/network/chains.json (Phase 3).
 */

import { validationError } from './error.js';

/**
 * A supported blockchain network.
 *
 * `enabled` is a hard safety gate. Nothing in LumiBase is allowed to
 * transact on a chain whose `enabled` is false, even if a token happens to
 * be registered for it. This is how "do not accidentally enable mainnet"
 * from the spec is enforced in code.
 */
export interface ChainConfig {
  /** EIP-155 chain ID. Base Sepolia is 84532, Base Mainnet is 8453. */
  readonly id: number;
  /** Human-readable name, e.g. "Base Sepolia". */
  readonly name: string;
  /** Native currency metadata. ETH on all Base networks. */
  readonly native: NativeCurrency;
  /** JSON-RPC endpoint URL. */
  readonly rpc: string;
  /** Block explorer base URL, no trailing slash. */
  readonly explorer: string;
  /** True if this is a testnet. UI should display warnings when true. */
  readonly testnet: boolean;
  /** Hard safety gate. `false` means LumiBase will refuse to use this chain. */
  readonly enabled: boolean;
}

export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  /** Native currency decimals. Always 18 for ETH-family chains. */
  readonly decimals: number;
}

/**
 * Confirmation policy for a chain.
 *
 * `blocks` is how many blocks must be mined on top of a transaction before
 * LumiBase treats it as final. Different for different chains, and
 * configurable per environment.
 *
 * `finality` is a hint about what kind of finality that represents:
 *   - "soft": probabilistic, will not be reverted in practice
 *   - "hard": cryptographically final (e.g. Ethereum post-Merge checkpoints)
 */
export interface ConfirmationPolicy {
  readonly blocks: number;
  readonly finality: 'soft' | 'hard';
}

/**
 * Verify that a chain config is internally consistent and safe to use.
 *
 * Does NOT verify that the RPC is reachable — that happens elsewhere. Only
 * checks the data the caller supplied.
 */
export function assertChain(config: ChainConfig): void {
  if (!Number.isInteger(config.id) || config.id <= 0) {
    throw validationError('Chain id must be a positive integer.', {
      id: config.id,
    });
  }
  if (typeof config.name !== 'string' || config.name.length === 0) {
    throw validationError('Chain name must be a non-empty string.');
  }
  if (typeof config.rpc !== 'string' || !/^https?:\/\//.test(config.rpc)) {
    throw validationError('Chain rpc must be an http(s) URL.', {
      rpc: config.rpc,
    });
  }
  if (typeof config.explorer !== 'string' || !/^https?:\/\//.test(config.explorer)) {
    throw validationError('Chain explorer must be an http(s) URL.', {
      explorer: config.explorer,
    });
  }
  if (typeof config.native.symbol !== 'string' || config.native.symbol.length === 0) {
    throw validationError('Chain native currency symbol must be non-empty.');
  }
  if (!Number.isInteger(config.native.decimals) || config.native.decimals < 0) {
    throw validationError('Chain native currency decimals must be a non-negative integer.');
  }
}

/**
 * Throw unless the given chain is enabled.
 *
 * Call this at the top of any code path that will transact or verify on a
 * chain. This is the single point of enforcement for the "mainnet must not
 * be enabled by accident" rule.
 */
export function assertEnabled(config: ChainConfig): void {
  if (!config.enabled) {
    throw validationError(`Chain ${config.name} (${config.id}) is disabled.`, {
      id: config.id,
    });
  }
}

/**
 * Verify that a payment request's declared chain matches the chain config
 * LumiBase will actually transact on. This is the "wrong network" check.
 */
export function assertChainId(config: ChainConfig, expected: number): void {
  if (config.id !== expected) {
    throw validationError(
      `Chain mismatch: expected ${expected}, got ${config.id} (${config.name}).`,
      { expected, actual: config.id },
    );
  }
}
