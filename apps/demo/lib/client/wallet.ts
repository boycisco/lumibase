import {
  createWalletClient,
  custom,
  getAddress,
  type EIP1193Provider,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_NAME,
  BASE_SEPOLIA_EXPLORER_URL,
  BASE_SEPOLIA_RPC_URL,
  USDC_ABI,
} from '@/lib/lumibase/constants';

export const BASE_SEPOLIA_HEX_CHAIN_ID = '0x14a34' as const;

export interface DiscoveredWalletProvider {
  id: string;
  name: string;
  rdns?: string;
  provider: EIP1193Provider;
}

interface EIP6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: EIP1193Provider;
}

interface EIP6963AnnounceEvent extends Event {
  detail: EIP6963ProviderDetail;
}

export function discoverInjectedProviders(
  timeoutMs = 150,
): Promise<DiscoveredWalletProvider[]> {
  if (typeof window === 'undefined') {
    return Promise.resolve([]);
  }

  const found = new Map<string, DiscoveredWalletProvider>();

  const onAnnounce = (event: Event) => {
    const customEvent = event as EIP6963AnnounceEvent;
    const detail = customEvent.detail;
    if (detail?.provider && detail?.info?.uuid) {
      found.set(detail.info.uuid, {
        id: detail.info.uuid,
        name: detail.info.name || 'Browser Wallet',
        rdns: detail.info.rdns,
        provider: detail.provider,
      });
    }
  };

  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  return new Promise((resolve) => {
    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const list = Array.from(found.values());
      if (list.length === 0) {
        const legacy = (
          window as Window & { ethereum?: EIP1193Provider }
        ).ethereum;
        if (legacy) {
          list.push({
            id: 'window-ethereum',
            name: 'Injected Browser Wallet',
            provider: legacy,
          });
        }
      }
      resolve(list);
    }, timeoutMs);
  });
}

export async function readWalletChainId(
  provider: EIP1193Provider,
): Promise<number> {
  const hexChainId = (await provider.request({
    method: 'eth_chainId',
  })) as string;
  return parseInt(hexChainId, 16);
}

export async function connectEip1193Wallet(provider: EIP1193Provider): Promise<{
  address: `0x${string}`;
  chainId: number;
}> {
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error('No wallet account was authorized.');
  }

  const address = getAddress(accounts[0]);
  const chainId = await readWalletChainId(provider);

  return { address, chainId };
}

export async function switchWalletToBaseSepolia(
  provider: EIP1193Provider,
): Promise<number> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_SEPOLIA_HEX_CHAIN_ID }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_SEPOLIA_HEX_CHAIN_ID,
            chainName: BASE_SEPOLIA_CHAIN_NAME,
            nativeCurrency: {
              name: 'Ether',
              symbol: 'ETH',
              decimals: 18,
            },
            rpcUrls: [BASE_SEPOLIA_RPC_URL],
            blockExplorerUrls: [BASE_SEPOLIA_EXPLORER_URL],
          },
        ],
      });
    } else {
      throw err;
    }
  }

  const activeChainId = await readWalletChainId(provider);
  if (activeChainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Wallet remains on chain ${activeChainId}. Switch to Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}) before sending USDC.`,
    );
  }
  return activeChainId;
}

export async function submitUsdcTransferTx(params: {
  provider: EIP1193Provider;
  account: `0x${string}`;
  usdcAddress: `0x${string}`;
  recipient: `0x${string}`;
  amountBaseUnits: string;
}): Promise<`0x${string}`> {
  const activeChainId = await readWalletChainId(params.provider);
  if (activeChainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Wrong network (chain ${activeChainId}). Switch to Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}) before submitting.`,
    );
  }

  const walletClient = createWalletClient({
    account: params.account,
    chain: baseSepolia,
    transport: custom(params.provider),
  });

  const hash = await walletClient.writeContract({
    address: getAddress(params.usdcAddress),
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [getAddress(params.recipient), BigInt(params.amountBaseUnits)],
    account: params.account,
    chain: baseSepolia,
  });

  return hash;
}

export function formatShortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function extractWalletErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const record = err as {
      code?: number;
      shortMessage?: string;
      message?: string;
    };
    if (record.code === 4001) {
      return 'Request rejected in wallet.';
    }
    if (record.shortMessage) return record.shortMessage;
    if (record.message) return record.message;
  }
  return 'Wallet interaction failed.';
}
