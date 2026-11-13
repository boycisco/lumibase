/**
 * Token registry operations.
 *
 * Per spec section 10.2, arbitrary tokens from untrusted clients MUST NOT be
 * accepted without validation. This module is the validation layer: given a
 * chain and a token address, it answers "is this a supported token?".
 */

import { validationError } from '@lumibase/core';
import { type ResolvedChain, type TokenConfig } from './chain.ts';

/**
 * Find a token on a chain by its contract address. Comparison is
 * case-insensitive because canonical storage is lowercase but EIP-55
 * checksummed input is common from clients.
 */
export function findToken(chain: ResolvedChain, address: string): TokenConfig | undefined {
  const needle = address.toLowerCase();
  return chain.tokens.find((t) => t.address.toLowerCase() === needle);
}

/**
 * Throw if the token is not registered or not enabled on the given chain.
 *
 * Always call this before building any payment request from client input.
 */
export function assertToken(chain: ResolvedChain, address: string): TokenConfig {
  const token = findToken(chain, address);
  if (!token) {
    throw validationError(`Token ${address} is not registered on ${chain.name}.`, {
      chainId: chain.id,
      address,
    });
  }
  if (!token.enabled) {
    throw validationError(`Token ${token.symbol} on ${chain.name} is disabled.`, {
      chainId: chain.id,
      symbol: token.symbol,
    });
  }
  return token;
}
