'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, isAddress, parseUnits, type EIP1193Provider } from 'viem';
import { motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EXPLORER_URL,
  BASE_SEPOLIA_USDC_DECIMALS,
  getVerificationOutcomeSpec,
  interpretConfirmationResponse,
  isTerminalPaymentStatus,
} from '@/lib/lumibase/constants';
import type { ConfirmInterpretation, DemoPublicConfig, WirePayment } from '@/lib/lumibase/types';
import {
  BffHttpError,
  confirmDemoPayment,
  createDemoPayment,
  fetchDemoConfig,
  fetchDemoPayment,
  fetchDemoPaymentStatus,
  type BffTraceEntry,
} from '@/lib/client/demo-api';
import {
  connectEip1193Wallet,
  discoverInjectedProviders,
  extractWalletErrorMessage,
  formatShortAddress,
  submitUsdcTransferTx,
  switchWalletToBaseSepolia,
  type DiscoveredWalletProvider,
} from '@/lib/client/wallet';
import { DeveloperReference } from './DeveloperReference';
import { StatusIndicator } from './StatusIndicator';
import { TopBar } from './TopBar';

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 60;
const AMOUNT_DECIMAL_REGEX = /^\d+(?:\.\d+)?$/;
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

interface AmountPreview {
  valid: boolean;
  baseUnits: string | null;
  error: string | null;
}

function previewUsdcAmount(raw: string): AmountPreview {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, baseUnits: null, error: null };
  }
  if (!AMOUNT_DECIMAL_REGEX.test(trimmed)) {
    return {
      valid: false,
      baseUnits: null,
      error: 'Enter a positive decimal amount (for example, 1.5).',
    };
  }
  const [, frac = ''] = trimmed.split('.');
  if (frac.length > BASE_SEPOLIA_USDC_DECIMALS) {
    return {
      valid: false,
      baseUnits: null,
      error: 'Amount has more than 6 decimal places.',
    };
  }
  try {
    const parsed = parseUnits(trimmed, BASE_SEPOLIA_USDC_DECIMALS);
    if (parsed <= BigInt(0)) {
      return {
        valid: false,
        baseUnits: null,
        error: 'Amount must be greater than 0 USDC.',
      };
    }
    return { valid: true, baseUnits: parsed.toString(), error: null };
  } catch {
    return {
      valid: false,
      baseUnits: null,
      error: 'Amount could not be parsed.',
    };
  }
}

function formatExpiryCountdown(expiresAtIso: string, nowMs: number): string {
  const diffSec = Math.floor((Date.parse(expiresAtIso) - nowMs) / 1000);
  if (!Number.isFinite(diffSec)) return 'Unknown';
  if (diffSec <= 0) return 'Expired';
  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function PaymentConsole() {
  // Server public config
  const [config, setConfig] = useState<DemoPublicConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<BffHttpError | null>(null);

  // Wallet state
  const [providers, setProviders] = useState<DiscoveredWalletProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [activeProvider, setActiveProvider] = useState<EIP1193Provider | null>(null);
  const [walletAddress, setWalletAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [switchingChain, setSwitchingChain] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Create payment form
  const [amountInput, setAmountInput] = useState('1.5');
  const [referenceInput, setReferenceInput] = useState('demo-order-001');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expiresInSeconds, setExpiresInSeconds] = useState(1800);
  const [payerInput, setPayerInput] = useState('');
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [createError, setCreateError] = useState<BffHttpError | string | null>(null);

  // Active payment + verification state
  const [payment, setPayment] = useState<WirePayment | null>(null);
  const [submittedTxHash, setSubmittedTxHash] = useState<`0x${string}` | null>(null);
  const [manualTxHashInput, setManualTxHashInput] = useState('');
  const [showManualHashForm, setShowManualHashForm] = useState(false);
  const [sendingTx, setSendingTx] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmInterpretation, setConfirmInterpretation] = useState<ConfirmInterpretation | null>(
    null,
  );
  const [actionError, setActionError] = useState<BffHttpError | string | null>(null);

  // Polling state
  const [isPolling, setIsPolling] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [pollNetworkWarning, setPollNetworkWarning] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  // Clock tick for expiry display
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Developer request trace log
  const [traces, setTraces] = useState<BffTraceEntry[]>([]);
  const recordTrace = useCallback((entry: BffTraceEntry) => {
    setTraces((prev) => [entry, ...prev].slice(0, 30));
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const data = await fetchDemoConfig(recordTrace);
      setConfig(data);
    } catch (err) {
      if (err instanceof BffHttpError) {
        setConfigError(err);
      } else {
        setConfigError(
          new BffHttpError({
            status: 503,
            code: 'BFF_UNREACHABLE',
            message: 'Unable to reach demo server /demo/config endpoint.',
            requestId: null,
            retryAfterSeconds: null,
            envelope: null,
          }),
        );
      }
      setConfig(null);
    } finally {
      setConfigLoading(false);
    }
  }, [recordTrace]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await fetchDemoConfig(recordTrace);
        if (active) {
          setConfig(data);
          setConfigError(null);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof BffHttpError) {
          setConfigError(err);
        } else {
          setConfigError(
            new BffHttpError({
              status: 503,
              code: 'BFF_UNREACHABLE',
              message: 'Unable to reach demo server /demo/config endpoint.',
              requestId: null,
              retryAfterSeconds: null,
              envelope: null,
            }),
          );
        }
        setConfig(null);
      } finally {
        if (active) {
          setConfigLoading(false);
        }
      }
    })();

    void discoverInjectedProviders().then((discovered) => {
      if (!active) return;
      setProviders(discovered);
      if (discovered.length > 0) {
        setSelectedProviderId(discovered[0].id);
      }
    });

    return () => {
      active = false;
    };
  }, [recordTrace]);

  useEffect(() => {
    if (!payment || isTerminalPaymentStatus(payment.status)) return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [payment]);

  // Subscribe to EIP-1193 wallet account/chain events
  useEffect(() => {
    const provider = activeProvider as
      | (EIP1193Provider & {
          on?: (event: string, listener: (...args: unknown[]) => void) => void;
          removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
        })
      | null;

    if (!provider?.on || !provider?.removeListener) return;

    const handleAccountsChanged = (accountsArg: unknown) => {
      const accounts = Array.isArray(accountsArg) ? (accountsArg as string[]) : [];
      if (accounts.length === 0) {
        setWalletAddress(null);
      } else {
        setWalletAddress(accounts[0] as `0x${string}`);
      }
    };

    const handleChainChanged = (hexChainArg: unknown) => {
      if (typeof hexChainArg === 'string') {
        setChainId(parseInt(hexChainArg, 16));
      }
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [activeProvider]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const startBoundedPolling = useCallback(
    (paymentId: string) => {
      stopPolling();
      setIsPolling(true);
      setPollCount(0);
      setPollNetworkWarning(null);

      let attempts = 0;

      const tick = async () => {
        attempts += 1;
        setPollCount(attempts);

        try {
          const snapshot = await fetchDemoPaymentStatus(paymentId, recordTrace);
          setPollNetworkWarning(null);

          setPayment((prev) =>
            prev && prev.id === snapshot.id
              ? {
                  ...prev,
                  status: snapshot.status,
                  updatedAt: snapshot.updatedAt,
                }
              : prev,
          );

          if (isTerminalPaymentStatus(snapshot.status)) {
            stopPolling();
            try {
              const full = await fetchDemoPayment(paymentId, recordTrace);
              setPayment(full);
              setConfirmInterpretation({
                kind: full.status === 'expired' ? 'terminal_expired' : 'terminal_success',
                status: full.status,
                error: full.status === 'expired' ? 'PAYMENT_EXPIRED' : null,
              } as ConfirmInterpretation);
            } catch {
              setConfirmInterpretation({
                kind: snapshot.status === 'expired' ? 'terminal_expired' : 'terminal_success',
                status: snapshot.status,
                error: snapshot.status === 'expired' ? 'PAYMENT_EXPIRED' : null,
              } as ConfirmInterpretation);
            }
            return;
          }
        } catch (err) {
          // Network or transient error must NOT falsely change payment status (§8.4)
          setPollNetworkWarning(
            err instanceof BffHttpError
              ? `${err.code}: ${err.message}`
              : 'Temporary network error while checking status; payment state unchanged.',
          );
        }

        if (attempts >= MAX_POLL_ATTEMPTS) {
          stopPolling();
          setPollNetworkWarning(
            'Polling reached the bounded limit. Use Check Status to refresh manually.',
          );
          return;
        }

        pollTimerRef.current = window.setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
      };

      pollTimerRef.current = window.setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    },
    [recordTrace, stopPolling],
  );

  const handleConnectWallet = async (overrideProvider?: DiscoveredWalletProvider) => {
    setWalletError(null);
    setWalletConnecting(true);
    try {
      let target = overrideProvider;
      if (!target) {
        const list = providers.length > 0 ? providers : await discoverInjectedProviders();
        if (list.length > 0) {
          setProviders(list);
          target = list.find((p) => p.id === selectedProviderId) ?? list[0];
        }
      }

      if (!target) {
        setWalletError(
          'No EIP-1193 wallet extension detected. Install MetaMask, Coinbase Wallet, or another EVM browser wallet.',
        );
        return;
      }

      const { address, chainId: activeChain } = await connectEip1193Wallet(target.provider);
      setActiveProvider(target.provider);
      setSelectedProviderId(target.id);
      setWalletAddress(address);
      setChainId(activeChain);
    } catch (err) {
      setWalletError(extractWalletErrorMessage(err));
    } finally {
      setWalletConnecting(false);
    }
  };

  const handleSwitchToBaseSepolia = async () => {
    if (!activeProvider) return;
    setWalletError(null);
    setSwitchingChain(true);
    try {
      const nextChain = await switchWalletToBaseSepolia(activeProvider);
      setChainId(nextChain);
    } catch (err) {
      setWalletError(extractWalletErrorMessage(err));
    } finally {
      setSwitchingChain(false);
    }
  };

  const handleTopBarWalletAction = () => {
    if (walletAddress !== null && chainId !== null && chainId !== BASE_SEPOLIA_CHAIN_ID) {
      void handleSwitchToBaseSepolia();
      return;
    }
    if (!walletAddress) {
      void handleConnectWallet();
      return;
    }
    const el = document.getElementById('wallet-panel');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const amountPreview = useMemo(() => previewUsdcAmount(amountInput), [amountInput]);

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!amountPreview.valid) {
      setCreateError(amountPreview.error ?? 'Enter a valid USDC amount before continuing.');
      return;
    }

    const trimmedPayer = payerInput.trim();
    if (trimmedPayer && !isAddress(trimmedPayer, { strict: false })) {
      setCreateError('Optional payer restriction must be a valid EVM address.');
      return;
    }

    stopPolling();
    setCreatingPayment(true);
    setActionError(null);
    setSubmittedTxHash(null);
    setConfirmInterpretation(null);

    try {
      const created = await createDemoPayment(
        {
          amount: amountInput.trim(),
          reference: referenceInput.trim() || null,
          expiresIn: expiresInSeconds,
          payer: trimmedPayer || null,
        },
        recordTrace,
      );
      setPayment(created);
      setNowMs(Date.now());
    } catch (err) {
      setCreateError(err instanceof BffHttpError ? err : 'Failed to create payment request.');
    } finally {
      setCreatingPayment(false);
    }
  };

  const runConfirmation = useCallback(
    async (paymentId: string, txHash: string) => {
      setConfirming(true);
      setActionError(null);
      try {
        const result = await confirmDemoPayment(paymentId, txHash, recordTrace);
        setPayment(result.payment);
        const interpretation = interpretConfirmationResponse(result);
        setConfirmInterpretation(interpretation);

        if (
          interpretation.kind === 'terminal_success' ||
          interpretation.kind === 'terminal_expired'
        ) {
          stopPolling();
        } else if (
          interpretation.status === 'processing' ||
          interpretation.error === 'PAYMENT_VERIFICATION_IN_PROGRESS'
        ) {
          startBoundedPolling(paymentId);
        }
      } catch (err) {
        setActionError(
          err instanceof BffHttpError
            ? err
            : 'Verification request failed before reaching LumiBase.',
        );
      } finally {
        setConfirming(false);
      }
    },
    [recordTrace, startBoundedPolling, stopPolling],
  );

  const handleSendUsdcAndVerify = async () => {
    if (!payment || !config || !activeProvider || !walletAddress) return;
    setActionError(null);

    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      setActionError(
        `Wallet is on chain ${chainId ?? 'unknown'}. Switch to Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}) first.`,
      );
      return;
    }

    setSendingTx(true);
    try {
      const hash = await submitUsdcTransferTx({
        provider: activeProvider,
        account: walletAddress,
        usdcAddress: config.usdc,
        recipient: config.recipient,
        amountBaseUnits: payment.amount,
      });

      setSubmittedTxHash(hash);
      setManualTxHashInput(hash);
      setSendingTx(false);

      await runConfirmation(payment.id, hash);
    } catch (err) {
      setSendingTx(false);
      setActionError(extractWalletErrorMessage(err));
    }
  };

  const handleVerifyCustomHash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment) return;
    const trimmed = manualTxHashInput.trim();
    if (!TX_HASH_REGEX.test(trimmed)) {
      setActionError('Enter a valid 66-character 0x-prefixed Base Sepolia transaction hash.');
      return;
    }
    setSubmittedTxHash(trimmed as `0x${string}`);
    await runConfirmation(payment.id, trimmed);
  };

  const handleRefreshPayment = async () => {
    if (!payment) return;
    setActionError(null);
    try {
      const updated = await fetchDemoPayment(payment.id, recordTrace);
      setPayment(updated);
      if (isTerminalPaymentStatus(updated.status)) {
        stopPolling();
        setConfirmInterpretation({
          kind: updated.status === 'expired' ? 'terminal_expired' : 'terminal_success',
          status: updated.status,
          error: updated.status === 'expired' ? 'PAYMENT_EXPIRED' : null,
        } as ConfirmInterpretation);
      }
    } catch (err) {
      setActionError(err instanceof BffHttpError ? err : 'Failed to refresh payment.');
    }
  };

  const handleResetPayment = () => {
    stopPolling();
    setPayment(null);
    setSubmittedTxHash(null);
    setManualTxHashInput('');
    setConfirmInterpretation(null);
    setActionError(null);
    setCreateError(null);
    setPollNetworkWarning(null);
  };

  const handleCopy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopiedId(label);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === label ? null : prev));
    }, 1500);
  };

  const isOnBaseSepolia = chainId === BASE_SEPOLIA_CHAIN_ID;
  const isTerminal = payment ? isTerminalPaymentStatus(payment.status) : false;
  const verificationSpec =
    confirmInterpretation?.kind === 'non_terminal_error'
      ? getVerificationOutcomeSpec(confirmInterpretation.error)
      : null;

  const explorerBase = config?.explorer ?? BASE_SEPOLIA_EXPLORER_URL;

  const timelineSteps = useMemo(() => {
    const step1Done = Boolean(walletAddress && isOnBaseSepolia);
    const step2Done = Boolean(payment);
    const step3Done = Boolean(submittedTxHash || payment?.transactionHash);
    const step4Done = Boolean(
      confirmInterpretation !== null || isTerminal || payment?.status === 'processing',
    );
    const step5Done = isTerminal;

    return [
      {
        title: 'Wallet connected on Base Sepolia',
        detail: walletAddress
          ? isOnBaseSepolia
            ? `${formatShortAddress(walletAddress)} · Chain ${chainId}`
            : `Wrong chain (${chainId}) — switch required`
          : 'Awaiting EIP-1193 connection',
        done: step1Done,
        active: !step1Done,
      },
      {
        title: 'Payment request created via BFF',
        detail: payment
          ? `${formatUnits(BigInt(payment.amount), BASE_SEPOLIA_USDC_DECIMALS)} USDC (${payment.amount} base units)`
          : 'POST /demo/payments',
        done: step2Done,
        active: step1Done && !step2Done,
      },
      {
        title: 'USDC transfer submitted by wallet',
        detail:
          (submittedTxHash ?? payment?.transactionHash)
            ? formatShortAddress((submittedTxHash ?? payment?.transactionHash) as string)
            : 'ERC-20 transfer(recipient, amount)',
        done: step3Done,
        active: step2Done && !step3Done && !isTerminal,
      },
      {
        title: 'Independent LumiBase verification',
        detail: confirming
          ? 'Verifying on Base Sepolia...'
          : confirmInterpretation?.kind === 'non_terminal_error'
            ? confirmInterpretation.error
            : isTerminal
              ? 'Verification settled'
              : 'POST /demo/payments/:id/confirm',
        done: step4Done,
        active: step3Done && !step5Done,
      },
      {
        title: 'Authoritative terminal outcome',
        detail: payment && isTerminal ? payment.status : 'Awaiting settlement',
        done: step5Done,
        active: false,
      },
    ];
  }, [
    chainId,
    confirmInterpretation,
    confirming,
    isOnBaseSepolia,
    isTerminal,
    payment,
    submittedTxHash,
    walletAddress,
  ]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar
        walletAddress={walletAddress}
        chainId={chainId}
        connecting={walletConnecting}
        onWalletAction={handleTopBarWalletAction}
      />

      <main className="mx-auto max-w-[1280px] px-6 py-10">
        {/* Hero / Header Summary */}
        <section id="checkout" className="scroll-mt-24 mb-8 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span>Base Sepolia</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">Chain 84532</span>
            <span aria-hidden="true">·</span>
            <span>USDC (6 decimals)</span>
            <span aria-hidden="true">·</span>
            <span>Same-Origin BFF Proxy</span>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl space-y-2">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance]">
                Base Sepolia USDC Payment Verification
              </h1>
              <p className="text-base leading-relaxed text-slate-600">
                Create a payment request, sign an on-chain USDC transfer with your wallet, and
                observe LumiBase independently verify the receipt through the server-side BFF.
              </p>
            </div>

            {config && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs space-y-1 shrink-0">
                <div className="font-medium text-slate-500">Server-Configured Recipient</div>
                <div className="flex items-center gap-2 font-mono font-medium text-slate-900">
                  <span>{formatShortAddress(config.recipient)}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('recipient', config.recipient)}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Copy recipient address"
                  >
                    {copiedId === 'recipient' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Operator Configuration Banner when BFF fails closed (503 / 401) */}
        {!configLoading && configError && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            aria-live="polite"
            className="mb-8 rounded-xl border border-amber-300 bg-amber-50/70 p-6 space-y-4"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
                  <span>Demo Server Configuration Required (HTTP {configError.status})</span>
                </div>
                <p className="text-sm text-amber-900 max-w-3xl">{configError.message}</p>
                <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-amber-800">
                  <span>code: {configError.code}</span>
                  {configError.requestId && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>requestId: {configError.requestId}</span>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void loadConfig()}
                className="min-h-[40px] inline-flex items-center gap-2 rounded-lg border border-amber-400 bg-white px-4 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100/60 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry /demo/config</span>
              </button>
            </div>

            <div className="rounded-lg border border-amber-200 bg-white/90 p-4 font-mono text-xs text-slate-700 space-y-1">
              <div className="font-sans text-xs font-semibold text-slate-900 mb-1.5">
                Required Server Environment Variables (fail-safe; no defaults substituted)
              </div>
              <div>LUMIBASE_API_URL=http://localhost:3000</div>
              <div>API_SECRET=&lt;lumibase-admin-secret&gt;</div>
              <div>DEMO_RECIPIENT=0x&lt;base-sepolia-recipient-address&gt;</div>
            </div>
          </motion.section>
        )}

        {/* Primary 2-Column Workspace */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
          {/* Left Column: Sequential Payment Execution */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white divide-y divide-slate-200">
            {/* Step 1: Wallet & Network */}
            <section id="wallet-panel" className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h2 className="text-base font-semibold text-slate-900">
                    01. Connect Wallet and Verify Network
                  </h2>
                  <p className="text-sm text-slate-600">
                    Connect an EIP-1193 wallet on Base Sepolia (Chain ID 84532).
                  </p>
                </div>

                {walletAddress && (
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    {isOnBaseSepolia ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Base Sepolia Ready</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Chain {chainId}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {!walletAddress ? (
                <div className="space-y-3">
                  {providers.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => void handleConnectWallet(p)}
                          disabled={walletConnecting}
                          className="min-h-[40px] inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors"
                        >
                          <Wallet className="h-4 w-4 text-slate-600" aria-hidden="true" />
                          <span>Connect {p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {providers.length <= 1 && (
                    <button
                      type="button"
                      onClick={() => void handleConnectWallet()}
                      disabled={walletConnecting}
                      className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-[#0052FF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
                    >
                      {walletConnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Wallet className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>
                        {walletConnecting ? 'Connecting Wallet...' : 'Connect EIP-1193 Wallet'}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 text-xs">
                    <div>
                      <div className="text-slate-500 mb-1">Connected Address</div>
                      <div className="font-mono font-medium text-slate-900 break-all">
                        {walletAddress}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 mb-1">Active Network</div>
                      <div className="font-mono font-medium text-slate-900 tabular-nums">
                        {isOnBaseSepolia
                          ? 'Base Sepolia (84532)'
                          : chainId === 8453
                            ? 'Base Mainnet (8453 — Disabled in v0.1)'
                            : `Chain ID ${chainId ?? 'Unknown'}`}
                      </div>
                    </div>
                  </div>

                  {!isOnBaseSepolia && (
                    <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-amber-950">
                        <span className="font-semibold">Wrong network.</span> LumiBase v0.1 payments
                        require Base Sepolia (84532). Base Mainnet is disabled.
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSwitchToBaseSepolia()}
                        disabled={switchingChain}
                        className="min-h-[40px] inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                      >
                        {switchingChain && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        )}
                        <span>Switch to Base Sepolia</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {walletError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                    aria-hidden="true"
                  />
                  <span>{walletError}</span>
                </div>
              )}
            </section>

            {/* Step 2: Create Payment Request */}
            <section className="p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h2 className="text-base font-semibold text-slate-900">
                    02. Create Payment Request
                  </h2>
                  <p className="text-sm text-slate-600">
                    Enter a USDC amount (up to 6 decimals). Recipient, chain, and token are enforced
                    by the BFF.
                  </p>
                </div>

                {payment && (
                  <button
                    type="button"
                    onClick={handleResetPayment}
                    className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    Create New Payment
                  </button>
                )}
              </div>

              {!payment ? (
                <form onSubmit={(e) => void handleCreatePayment(e)} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">Amount (USDC)</span>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amountInput}
                          onChange={(e) => setAmountInput(e.target.value)}
                          placeholder="1.5"
                          aria-invalid={Boolean(amountPreview.error)}
                          className={`w-full rounded-lg border px-3.5 py-2.5 pr-16 font-mono text-sm tabular-nums text-slate-900 focus:outline-none ${
                            amountPreview.error
                              ? 'border-red-400 focus:border-red-600'
                              : 'border-slate-300 focus:border-blue-600'
                          }`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                          USDC
                        </span>
                      </div>
                      <div className="min-h-[18px] text-xs">
                        {amountPreview.error ? (
                          <span className="text-red-600 font-medium">{amountPreview.error}</span>
                        ) : amountPreview.baseUnits ? (
                          <span className="font-mono tabular-nums text-slate-500">
                            Wire base units: {amountPreview.baseUnits}
                          </span>
                        ) : (
                          <span className="text-slate-400">6 decimal places maximum</span>
                        )}
                      </div>
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">
                        Order Reference (Optional)
                      </span>
                      <input
                        type="text"
                        maxLength={256}
                        value={referenceInput}
                        onChange={(e) => setReferenceInput(e.target.value)}
                        placeholder="demo-order-001"
                        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                      <div className="text-xs text-slate-400 tabular-nums">
                        {referenceInput.length}/256 chars · non-unique
                      </div>
                    </label>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
                    >
                      {showAdvanced ? (
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Advanced Payment Parameters</span>
                    </button>

                    {showAdvanced && (
                      <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold text-slate-700">
                            Expiry Window
                          </span>
                          <select
                            value={expiresInSeconds}
                            onChange={(e) => setExpiresInSeconds(Number(e.target.value))}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                          >
                            <option value={300}>5 minutes (300s)</option>
                            <option value={1800}>30 minutes (1800s default)</option>
                            <option value={3600}>1 hour (3600s)</option>
                            <option value={86400}>24 hours (86400s)</option>
                          </select>
                        </label>

                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold text-slate-700">
                            Restrict Payer Address (Optional)
                          </span>
                          <input
                            type="text"
                            value={payerInput}
                            onChange={(e) => setPayerInput(e.target.value)}
                            placeholder="0x... (leave empty for any sender)"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {createError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-1"
                    >
                      <div className="font-semibold">
                        {typeof createError === 'string'
                          ? createError
                          : `${createError.code} (HTTP ${createError.status})`}
                      </div>
                      {typeof createError !== 'string' && (
                        <>
                          <div>{createError.message}</div>
                          {createError.requestId && (
                            <div className="font-mono text-[11px] text-red-700">
                              requestId: {createError.requestId}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                    <div className="text-xs text-slate-500">
                      {config
                        ? `Recipient locked to ${formatShortAddress(config.recipient)}`
                        : 'Waiting for /demo/config'}
                    </div>
                    <button
                      type="submit"
                      disabled={creatingPayment || !config || !amountPreview.valid}
                      className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-[#0052FF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {creatingPayment ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>
                        {creatingPayment ? 'Creating Payment...' : 'Create Payment Request'}
                      </span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-500">Payment ID</div>
                      <div className="flex items-center gap-2 font-mono text-xs font-semibold text-slate-900 break-all">
                        <span>{payment.id}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy('paymentId', payment.id)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
                          aria-label="Copy payment ID"
                        >
                          {copiedId === 'paymentId' ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <StatusIndicator status={payment.status} />
                  </div>

                  <dl className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500">Amount</dt>
                      <dd className="mt-1 font-mono font-semibold tabular-nums text-slate-900">
                        {formatUnits(BigInt(payment.amount), BASE_SEPOLIA_USDC_DECIMALS)} USDC
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Base Units</dt>
                      <dd className="mt-1 font-mono tabular-nums text-slate-700">
                        {payment.amount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Recipient</dt>
                      <dd className="mt-1 font-mono text-slate-900">
                        {formatShortAddress(payment.recipient)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Expires In</dt>
                      <dd className="mt-1 font-mono tabular-nums text-slate-900">
                        {formatExpiryCountdown(payment.expiresAt, nowMs)}
                      </dd>
                    </div>
                  </dl>

                  {payment.reference && (
                    <div className="text-xs text-slate-500">
                      Reference:{' '}
                      <span className="font-mono text-slate-800">{payment.reference}</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Step 3: Transfer & Verification */}
            <section className="p-6 space-y-5">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold text-slate-900">
                  03. Submit USDC Transfer and Verify with LumiBase
                </h2>
                <p className="text-sm text-slate-600">
                  Wallet submission broadcasts the ERC-20 transfer. LumiBase must independently
                  verify the receipt before confirming.
                </p>
              </div>

              {!payment ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                  Create a payment request above to enable wallet transfer and LumiBase
                  verification.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Primary Actions */}
                  {!isTerminal && (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleSendUsdcAndVerify()}
                        disabled={sendingTx || confirming || !walletAddress || !isOnBaseSepolia}
                        className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-[#0052FF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sendingTx ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="h-4 w-4" aria-hidden="true" />
                        )}
                        <span>
                          {sendingTx
                            ? 'Confirming in Wallet...'
                            : `Send ${formatUnits(
                                BigInt(payment.amount),
                                BASE_SEPOLIA_USDC_DECIMALS,
                              )} USDC via Wallet`}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowManualHashForm((v) => !v)}
                        className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        {showManualHashForm ? 'Hide Manual Hash Input' : 'Submit Existing Tx Hash'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleRefreshPayment()}
                        className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Check Status</span>
                      </button>
                    </div>
                  )}

                  {/* Manual Tx Hash Submission (also useful to test idempotency or error paths) */}
                  {(showManualHashForm || isTerminal) && (
                    <form
                      onSubmit={(e) => void handleVerifyCustomHash(e)}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5"
                    >
                      <label className="block text-xs font-semibold text-slate-700">
                        {isTerminal
                          ? 'Test Idempotent Terminal Confirmation (Optional)'
                          : 'Submit Base Sepolia Transaction Hash to POST /demo/payments/:id/confirm'}
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          value={manualTxHashInput}
                          onChange={(e) => setManualTxHashInput(e.target.value)}
                          placeholder="0x..."
                          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={confirming}
                          className="min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap disabled:opacity-60"
                        >
                          {confirming && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          )}
                          <span>Verify with LumiBase</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Submitted Wallet Transaction Box (explicitly distinct from LumiBase confirmation) */}
                  {(submittedTxHash || payment.transactionHash) && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800">
                          Submitted Wallet Transaction
                        </span>
                        <a
                          href={`${explorerBase}/tx/${submittedTxHash ?? payment.transactionHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
                        >
                          <span>View on BaseScan</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </div>
                      <div className="font-mono text-slate-700 break-all">
                        {submittedTxHash ?? payment.transactionHash}
                      </div>
                      {!isTerminal && (
                        <div className="text-slate-500">
                          Wallet submission alone is not payment confirmation. LumiBase verification
                          determines final status.
                        </div>
                      )}
                    </div>
                  )}

                  {/* HTTP / Wallet Action Error */}
                  {actionError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-1"
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                        <span>
                          {typeof actionError === 'string'
                            ? 'Action Error'
                            : `${actionError.code} (HTTP ${actionError.status})`}
                        </span>
                      </div>
                      <div>
                        {typeof actionError === 'string' ? actionError : actionError.message}
                      </div>
                      {typeof actionError !== 'string' && actionError.requestId && (
                        <div className="font-mono text-[11px] text-red-700">
                          requestId: {actionError.requestId}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Authoritative Confirmation / Lifecycle Outcome Display */}
                  {confirming && (
                    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                      <Loader2
                        className="h-4 w-4 animate-spin shrink-0 text-blue-700"
                        aria-hidden="true"
                      />
                      <span>LumiBase is verifying the transaction receipt on Base Sepolia...</span>
                    </div>
                  )}

                  {!confirming &&
                    confirmInterpretation?.kind === 'non_terminal_error' &&
                    verificationSpec && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3 text-xs text-amber-950">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-semibold text-sm">
                            <AlertTriangle
                              className="h-4 w-4 text-amber-700 shrink-0"
                              aria-hidden="true"
                            />
                            <span>
                              Verification Outcome:{' '}
                              <code className="font-mono">{verificationSpec.code}</code>
                            </span>
                          </div>
                          <span className="font-mono text-xs text-amber-800">
                            payment.status = {payment.status}
                          </span>
                        </div>
                        <p className="text-sm text-amber-900">
                          <span className="font-semibold">{verificationSpec.meaning}.</span>{' '}
                          {verificationSpec.guidance}
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                          {verificationSpec.action === 'retry_same_hash' && submittedTxHash && (
                            <button
                              type="button"
                              onClick={() => void runConfirmation(payment.id, submittedTxHash)}
                              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 transition-colors"
                            >
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Retry Verification with Same Hash</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                  {isPolling && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-900">
                      <div className="flex items-center gap-2">
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin text-blue-700 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="tabular-nums">
                          Polling <code className="font-mono">GET /demo/payments/:id/status</code>{' '}
                          (attempt {pollCount}/{MAX_POLL_ATTEMPTS})...
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={stopPolling}
                        className="rounded border border-blue-300 bg-white px-2.5 py-1 font-semibold text-blue-800 hover:bg-blue-50"
                      >
                        Stop Polling
                      </button>
                    </div>
                  )}

                  {pollNetworkWarning && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      {pollNetworkWarning}
                    </div>
                  )}

                  {/* Terminal States (§8.1 - §8.5) */}
                  {payment.status === 'confirmed' && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-base font-semibold text-emerald-900">
                          <ShieldCheck
                            className="h-5 w-5 text-emerald-700 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Payment Confirmed by LumiBase</span>
                        </div>
                        <span className="font-mono text-xs font-semibold text-emerald-800">
                          Terminal · Polling Stopped
                        </span>
                      </div>
                      <p className="text-sm text-emerald-900">
                        LumiBase independently verified the exact Base Sepolia USDC transfer ({' '}
                        <span className="font-mono tabular-nums">
                          {formatUnits(
                            BigInt(payment.confirmedAmount ?? payment.amount),
                            BASE_SEPOLIA_USDC_DECIMALS,
                          )}{' '}
                          USDC
                        </span>
                        ) to{' '}
                        <span className="font-mono">{formatShortAddress(payment.recipient)}</span>.
                      </p>
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {(payment.transactionHash ?? submittedTxHash) && (
                          <a
                            href={`${explorerBase}/tx/${
                              payment.transactionHash ?? submittedTxHash
                            }`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100/50"
                          >
                            <span>Inspect Receipt on BaseScan</span>
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={handleResetPayment}
                          className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                        >
                          Start Another Payment
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {(payment.status === 'underpaid' || payment.status === 'overpaid') && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-base font-semibold text-amber-950">
                          <AlertTriangle
                            className="h-5 w-5 text-amber-700 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            {payment.status === 'underpaid'
                              ? 'Payment Terminal: Underpaid'
                              : 'Payment Terminal: Overpaid'}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-semibold text-amber-800">
                          Terminal
                        </span>
                      </div>
                      <p className="text-sm text-amber-900">
                        {payment.status === 'underpaid'
                          ? 'A matching transfer was found, but the transferred amount was lower than requested. In LumiBase v0.1, underpaid is terminal and additional transfers will not automatically complete this payment.'
                          : 'A matching transfer was found, but the transferred amount exceeded the requested amount. In LumiBase v0.1, overpaid is terminal with no automatic refund.'}
                      </p>
                      <button
                        type="button"
                        onClick={handleResetPayment}
                        className="rounded-lg bg-amber-800 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-900"
                      >
                        Create New Payment Request
                      </button>
                    </div>
                  )}

                  {(payment.status === 'expired' ||
                    payment.status === 'cancelled' ||
                    payment.status === 'failed') && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-base font-semibold text-red-950">
                          <XCircle className="h-5 w-5 text-red-700 shrink-0" aria-hidden="true" />
                          <span>Payment Terminal: {payment.status.toUpperCase()}</span>
                        </div>
                        <span className="font-mono text-xs font-semibold text-red-800">
                          Terminal
                        </span>
                      </div>
                      <p className="text-sm text-red-900">
                        {payment.status === 'expired'
                          ? 'This payment request expired before confirmation completed. Create a new payment request to continue.'
                          : 'This payment request reached a terminal closed state.'}
                      </p>
                      <button
                        type="button"
                        onClick={handleResetPayment}
                        className="rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold text-white hover:bg-red-900"
                      >
                        Create New Payment Request
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Lifecycle Timeline & Same-Origin BFF Request Log */}
          <aside className="lg:col-span-5 space-y-6">
            {/* Lifecycle Progression */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Payment Journey State</h2>
                <span className="text-xs font-mono text-slate-500">
                  {payment ? payment.status : 'idle'}
                </span>
              </div>

              <ol className="space-y-3.5">
                {timelineSteps.map((step, index) => (
                  <li key={step.title} className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-mono font-semibold tabular-nums ${
                        step.done
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : step.active
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-300 bg-white text-slate-500'
                      }`}
                    >
                      {step.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm font-medium ${
                          step.done || step.active ? 'text-slate-900' : 'text-slate-500'
                        }`}
                      >
                        {step.title}
                      </div>
                      <div className="truncate font-mono text-xs text-slate-500">{step.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Same-Origin BFF Request Log */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Same-Origin BFF Traffic</h2>
                  <p className="text-xs text-slate-500">
                    Browser calls only <code className="font-mono">/demo/*</code>. No API keys or
                    LumiBase URLs leave the server.
                  </p>
                </div>
                {traces.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTraces([])}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900"
                  >
                    Clear
                  </button>
                )}
              </div>

              {traces.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-500">
                  No requests recorded yet.
                </div>
              ) : (
                <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-100 border-t border-slate-100">
                  {traces.map((entry) => (
                    <div
                      key={entry.id}
                      className="py-2.5 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 font-mono text-slate-900">
                          <span className="font-semibold">{entry.method}</span>
                          <span className="truncate">{entry.path}</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {entry.paymentStatus && <span>status={entry.paymentStatus} </span>}
                          {entry.errorCode && (
                            <span className="text-amber-700">error={entry.errorCode} </span>
                          )}
                          {entry.requestId && <span>req={entry.requestId.slice(0, 8)}…</span>}
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div
                          className={`font-semibold ${
                            entry.httpStatus >= 200 && entry.httpStatus < 300
                              ? 'text-emerald-700'
                              : entry.httpStatus >= 500
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {entry.httpStatus}
                        </div>
                        <div className="text-[11px] text-slate-400">{entry.durationMs}ms</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        <DeveloperReference />
      </main>
    </div>
  );
}
