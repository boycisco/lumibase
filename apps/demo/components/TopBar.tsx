'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@/lib/lumibase/constants';
import { formatShortAddress } from '@/lib/client/wallet';

interface TopBarProps {
  walletAddress: `0x${string}` | null;
  chainId: number | null;
  connecting: boolean;
  onWalletAction: () => void;
}

export function TopBar({
  walletAddress,
  chainId,
  connecting,
  onWalletAction,
}: TopBarProps) {
  const isWrongChain =
    walletAddress !== null &&
    chainId !== null &&
    chainId !== BASE_SEPOLIA_CHAIN_ID;

  let actionLabel = 'Connect Wallet';
  if (connecting) {
    actionLabel = 'Connecting...';
  } else if (isWrongChain) {
    actionLabel = 'Switch to Base Sepolia';
  } else if (walletAddress) {
    actionLabel = formatShortAddress(walletAddress);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
        <a
          href="#checkout"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
        >
          LumiBase
        </a>

        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <a
            href="#checkout"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Checkout Flow
          </a>
          <a
            href="#lifecycle"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Lifecycle Matrix
          </a>
          <a
            href="#webhooks"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Webhook Verifier
          </a>
          <a
            href="#security"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Security Boundary
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onWalletAction}
            disabled={connecting}
            className={`min-h-[40px] rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 ${
              isWrongChain
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : walletAddress
                  ? 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 font-mono'
                  : 'bg-[#0052FF] text-white hover:bg-blue-700'
            }`}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </header>
  );
}
