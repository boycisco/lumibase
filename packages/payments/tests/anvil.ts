/**
 * Anvil connectivity and clients for payment confirm tests.
 *
 * Same anvil instance as @lumibase/network tests. Uses anvil's well-known
 * first account — no real keys, no real funds, exists only on local anvil.
 */

import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const ANVIL_URL = process.env.ANVIL_URL ?? 'http://localhost:8545';

export const ANVIL_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

export const ANVIL_ACCOUNT = privateKeyToAccount(ANVIL_PRIVATE_KEY);

export const anvilChain = defineChain({
  id: 84532,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_URL] } },
});

export const publicClient = createPublicClient({
  chain: anvilChain,
  transport: http(ANVIL_URL),
});

export const walletClient = createWalletClient({
  chain: anvilChain,
  account: ANVIL_ACCOUNT,
  transport: http(ANVIL_URL),
});

export async function ensureAnvil(): Promise<void> {
  try {
    const id = await publicClient.getChainId();
    if (id !== anvilChain.id) {
      throw new Error(`Anvil is running with chain ID ${id}, expected ${anvilChain.id}.`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach anvil at ${ANVIL_URL}.\n` +
        `  Is the container running? Try: docker compose up -d\n` +
        `  Original error: ${detail}`,
    );
  }
}
