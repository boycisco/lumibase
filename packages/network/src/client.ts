/**
 * viem client factory.
 *
 * Produces a PublicClient for a ResolvedChain. Runs every safety check from
 * @lumibase/core before constructing the client:
 *   - assertChain validates the chain config shape (id, rpc, explorer, native)
 *   - assertEnabled blocks disabled chains (the mainnet safety gate)
 *   - assertChainId cross-checks the viem chain id against the config
 *
 * PublicClient (not WalletClient) is used because LumiBase never holds or
 * uses private keys. It reads the chain; clients sign. When a user submits
 * a transaction, they sign in their wallet and hand us the hash — we verify
 * it. See spec section 15: "LumiBase does not need custody of user funds
 * to support direct wallet payments."
 */

import { assertChain, assertChainId, assertEnabled, type ChainConfig } from '@lumibase/core';
import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import { toChainConfig, type ResolvedChain } from './chain.ts';

/**
 * Build a viem Chain object from a ResolvedChain. Viem uses this for
 * chain-id cross-checks when it reads from RPC.
 */
function toViemChain(chain: ResolvedChain): Chain {
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.native,
    rpcUrls: {
      default: { http: [chain.rpc] },
    },
    blockExplorers: {
      default: { name: chain.name, url: chain.explorer },
    },
    testnet: chain.testnet,
  };
}

export function createClient(chain: ResolvedChain): PublicClient {
  const config: ChainConfig = toChainConfig(chain);
  assertChain(config);
  assertEnabled(config);
  assertChainId(config, chain.id);

  const viemChain = toViemChain(chain);
  assertChainId(config, viemChain.id);

  return createPublicClient({
    chain: viemChain,
    transport: http(chain.rpc),
  });
}
