/**
 * Shared test setup for on-chain tests.
 *
 * Types are inferred (not annotated) on purpose:
 *
 *   - `createWalletClient({ chain, account, transport })` returns a client
 *     whose TYPE knows chain and account are set. That is what lets
 *     `walletClient.writeContract({ ... })` be callable WITHOUT passing
 *     `chain` or `account` on every call.
 *
 *   - Annotating as bare `WalletClient` erases that knowledge, and viem then
 *     (correctly) requires `chain: null` and `account` on every call.
 *
 *   - TS2742 ("cannot be named without a reference to...") only fires during
 *     DECLARATION emission. We do not emit test files (`build` uses
 *     tsconfig.build.json with src/ only; `typecheck` uses noEmit), so
 *     inference is safe here.
 *
 * Anvil's default first account (well-known test credentials, never real
 * funds on any network):
 *   address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 *   private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 */

import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const ANVIL_URL = process.env.ANVIL_URL ?? 'http://localhost:8545';

export const ANVIL_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

export const ANVIL_ACCOUNT = privateKeyToAccount(ANVIL_PRIVATE_KEY);

export const anvilChain = defineChain({
  id: 84532,
  name: 'Anvil (Base Sepolia)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [ANVIL_URL] },
  },
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

/**
 * Fail fast if anvil isn't reachable or has the wrong chain ID.
 */
export async function ensureAnvil(): Promise<void> {
  try {
    const id = await publicClient.getChainId();
    if (id !== anvilChain.id) {
      throw new Error(
        `Anvil is running with chain ID ${id}, expected ${anvilChain.id}. ` +
          `Check docker-compose.yml (anvil must be started with --chain-id ${anvilChain.id}).`,
      );
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
