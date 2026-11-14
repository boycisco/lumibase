import type {
  ConfirmInterpretation,
  ConfirmPaymentResponse,
  PaymentStatus,
  VerificationErrorCode,
} from './types';

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_SEPOLIA_CHAIN_NAME = 'Base Sepolia' as const;
export const BASE_SEPOLIA_USDC_ADDRESS =
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const BASE_SEPOLIA_USDC_DECIMALS = 6 as const;
export const BASE_SEPOLIA_EXPLORER_URL = 'https://sepolia.basescan.org' as const;
export const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org' as const;

export const MAX_EXPIRES_IN_SECONDS = 2_592_000; // 30 days
export const DEFAULT_EXPIRES_IN_SECONDS = 1800; // 30 minutes
export const MAX_REFERENCE_LENGTH = 256;

export const USDC_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

export const TERMINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'confirmed',
  'underpaid',
  'overpaid',
  'expired',
  'cancelled',
  'failed',
]);

export const NON_TERMINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'pending',
  'processing',
]);

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.has(status);
}

export interface LifecycleStatusInfo {
  status: PaymentStatus;
  label: string;
  terminal: boolean;
  meaning: string;
}

export const PAYMENT_LIFECYCLE_SPECS: readonly LifecycleStatusInfo[] = [
  {
    status: 'pending',
    label: 'Pending',
    terminal: false,
    meaning: 'Awaiting a valid payment',
  },
  {
    status: 'processing',
    label: 'Processing',
    terminal: false,
    meaning: 'Verification is in progress',
  },
  {
    status: 'confirmed',
    label: 'Confirmed',
    terminal: true,
    meaning: 'Exact payment independently verified',
  },
  {
    status: 'underpaid',
    label: 'Underpaid',
    terminal: true,
    meaning: 'Matching transfer found, amount too low',
  },
  {
    status: 'overpaid',
    label: 'Overpaid',
    terminal: true,
    meaning: 'Matching transfer found, amount too high',
  },
  {
    status: 'expired',
    label: 'Expired',
    terminal: true,
    meaning: 'Payment request expired',
  },
  {
    status: 'cancelled',
    label: 'Cancelled',
    terminal: true,
    meaning: 'Payment request cancelled',
  },
  {
    status: 'failed',
    label: 'Failed (Reserved)',
    terminal: true,
    meaning: 'Reserved for a future version; not emitted by the v0.1 confirmation flow',
  },
];

export type VerificationRetryAction =
  | 'retry_same_hash'
  | 'poll_status'
  | 'do_not_retry';

export interface VerificationOutcomeSpec {
  code: VerificationErrorCode;
  meaning: string;
  safeToRetrySameHash: boolean;
  action: VerificationRetryAction;
  guidance: string;
}

export const VERIFICATION_OUTCOME_SPECS: Record<
  VerificationErrorCode,
  VerificationOutcomeSpec
> = {
  TRANSACTION_NOT_FOUND: {
    code: 'TRANSACTION_NOT_FOUND',
    meaning: 'Hash not yet known on Base Sepolia',
    safeToRetrySameHash: true,
    action: 'retry_same_hash',
    guidance:
      'Retry verification in a few seconds; the transaction may still be propagating or unmined.',
  },
  TRANSACTION_REVERTED: {
    code: 'TRANSACTION_REVERTED',
    meaning: 'Mined on-chain but reverted',
    safeToRetrySameHash: false,
    action: 'do_not_retry',
    guidance:
      'The transaction failed on-chain. Do not retry this hash; submit a new USDC transfer.',
  },
  TRANSACTION_WRONG_RECIPIENT: {
    code: 'TRANSACTION_WRONG_RECIPIENT',
    meaning: 'Transfer went to a different address',
    safeToRetrySameHash: false,
    action: 'do_not_retry',
    guidance:
      'Transfer recipient did not match the server-configured payment recipient. Send a new transfer to the exact recipient.',
  },
  TRANSACTION_WRONG_TOKEN: {
    code: 'TRANSACTION_WRONG_TOKEN',
    meaning: 'Transfer used a different token contract',
    safeToRetrySameHash: false,
    action: 'do_not_retry',
    guidance:
      'Transfer did not use Base Sepolia USDC. Submit a transfer using the official USDC contract.',
  },
  TRANSACTION_WRONG_SENDER: {
    code: 'TRANSACTION_WRONG_SENDER',
    meaning: 'Transfer came from a different sender than the specified payer',
    safeToRetrySameHash: false,
    action: 'do_not_retry',
    guidance:
      'Switch to the expected payer wallet and submit a new transfer.',
  },
  TRANSACTION_NOT_ENOUGH_CONFIRMATIONS: {
    code: 'TRANSACTION_NOT_ENOUGH_CONFIRMATIONS',
    meaning: 'Mined, but fewer than required policy confirmation blocks',
    safeToRetrySameHash: true,
    action: 'retry_same_hash',
    guidance: 'Wait ~30 seconds for additional Base Sepolia blocks and retry the same hash.',
  },
  TRANSACTION_ALREADY_PROCESSED: {
    code: 'TRANSACTION_ALREADY_PROCESSED',
    meaning: 'Transaction hash is already associated with another payment',
    safeToRetrySameHash: false,
    action: 'do_not_retry',
    guidance: 'This transaction hash has already been consumed. Submit a fresh USDC transfer.',
  },
  TRANSACTION_RPC_FAILURE: {
    code: 'TRANSACTION_RPC_FAILURE',
    meaning: 'Base Sepolia RPC temporarily unreachable',
    safeToRetrySameHash: true,
    action: 'retry_same_hash',
    guidance: 'RPC node error encountered. Retry verification in a few seconds.',
  },
  PAYMENT_VERIFICATION_IN_PROGRESS: {
    code: 'PAYMENT_VERIFICATION_IN_PROGRESS',
    meaning: 'Another confirmation check is currently running',
    safeToRetrySameHash: false,
    action: 'poll_status',
    guidance: 'Do not re-submit confirm; poll payment status until verification settles.',
  },
  PAYMENT_EXPIRED: {
    code: 'PAYMENT_EXPIRED',
    meaning: 'Payment expired before confirmation completed',
    safeToRetrySameHash: false,
    action: 'do_not_retry',
    guidance: 'This payment is now terminally expired. Create a new payment request.',
  },
  PAYMENT_INVALID_STATE: {
    code: 'PAYMENT_INVALID_STATE',
    meaning: 'Unexpected internal payment state',
    safeToRetrySameHash: false,
    action: 'do_not_retry',
    guidance: 'Report as an unexpected API state error.',
  },
};

export function getVerificationOutcomeSpec(
  code: string | null | undefined,
): VerificationOutcomeSpec | null {
  if (!code) return null;
  return (
    VERIFICATION_OUTCOME_SPECS[code as VerificationErrorCode] ?? {
      code: code as VerificationErrorCode,
      meaning: 'Verification returned an outcome code',
      safeToRetrySameHash: false,
      action: 'do_not_retry',
      guidance: 'Inspect the payment status and error code before taking action.',
    }
  );
}

/**
 * Interprets POST /demo/payments/:id/confirm response following §8.3:
 * 1. Inspect payment.status first.
 * 2. Interpret error based on step 1.
 */
export function interpretConfirmationResponse(
  response: ConfirmPaymentResponse,
): ConfirmInterpretation {
  const { payment, error } = response;

  if (isTerminalPaymentStatus(payment.status)) {
    if (payment.status === 'expired' && error === 'PAYMENT_EXPIRED') {
      return {
        kind: 'terminal_expired',
        status: 'expired',
        error: 'PAYMENT_EXPIRED',
      };
    }

    return {
      kind: 'terminal_success',
      status: payment.status,
      error: null,
    };
  }

  return {
    kind: 'non_terminal_error',
    status: payment.status === 'processing' ? 'processing' : 'pending',
    error: error ?? 'PAYMENT_VERIFICATION_IN_PROGRESS',
  };
}
