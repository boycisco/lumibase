/**
 * Load network configuration from environment.
 *
 * Reads RPC URLs from the supplied environment record (defaults to
 * process.env) and combines them with the ChainDefinitions in chain.ts
 * to produce ResolvedChain objects.
 *
 * Missing RPC URLs do NOT throw. A chain with no RPC simply isn't available
 * — createClient() will fail loudly if someone tries to use it. This lets
 * unit tests run without any RPC configured and lets deployments opt into
 * the specific networks they need.
 */

import { BASE_MAINNET, BASE_SEPOLIA, type ChainDefinition, type ResolvedChain } from './chain.ts';

export interface NetworkConfig {
  /** Chains keyed by chain id. Only chains with configured RPC are present. */
  readonly chains: ReadonlyMap<number, ResolvedChain>;
}

const RPC_ENV_VAR: Record<number, string> = {
  [BASE_SEPOLIA.id]: 'BASE_SEPOLIA_RPC',
  [BASE_MAINNET.id]: 'BASE_MAINNET_RPC',
};

export function loadNetworkConfig(
  env: Record<string, string | undefined> = process.env,
): NetworkConfig {
  const chains = new Map<number, ResolvedChain>();
  const definitions: ChainDefinition[] = [BASE_SEPOLIA, BASE_MAINNET];
  for (const def of definitions) {
    const envVar = RPC_ENV_VAR[def.id];
    const rpc = envVar ? env[envVar] : undefined;
    if (rpc && rpc.length > 0) {
      chains.set(def.id, { ...def, rpc });
    }
  }
  return { chains };
}

/**
 * Retrieve a resolved chain, or throw. Use this when the caller knows the
 * chain is configured (e.g. the API startup path) and wants a clear error
 * if it isn't.
 */
export function requireChain(config: NetworkConfig, chainId: number): ResolvedChain {
  const chain = config.chains.get(chainId);
  if (!chain) {
    throw new Error(`Chain ${chainId} is not configured (missing RPC URL environment variable).`);
  }
  return chain;
}
