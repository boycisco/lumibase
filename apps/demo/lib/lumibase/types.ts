export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'underpaid'
  | 'overpaid'
  | 'expired'
  | 'cancelled'
  | 'failed';

export type VerificationErrorCode =
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_REVERTED'
  | 'TRANSACTION_WRONG_RECIPIENT'
  | 'TRANSACTION_WRONG_TOKEN'
  | 'TRANSACTION_WRONG_SENDER'
  | 'TRANSACTION_NOT_ENOUGH_CONFIRMATIONS'
  | 'TRANSACTION_ALREADY_PROCESSED'
  | 'TRANSACTION_RPC_FAILURE'
  | 'PAYMENT_VERIFICATION_IN_PROGRESS'
  | 'PAYMENT_EXPIRED'
  | 'PAYMENT_INVALID_STATE';

export interface DemoPublicConfig {
  chainId: 84532;
  chainName: string;
  usdc: `0x${string}`;
  decimals: 6;
  recipient: `0x${string}`;
  explorer: string;
}

export interface WirePayment {
  id: string;
  applicationId?: string;
  amount: string;
  chainId: number;
  token: string;
  recipient: string;
  payer: string | null;
  reference: string | null;
  status: PaymentStatus;
  transactionHash?: string | null;
  blockNumber?: string | null;
  confirmedAmount?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface PaymentStatusSnapshot {
  id: string;
  status: PaymentStatus;
  updatedAt: string;
}

export interface ConfirmPaymentResponse {
  payment: WirePayment;
  error: VerificationErrorCode | string | null;
}

export interface LumiBaseApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export type ConfirmInterpretation =
  | {
      kind: 'terminal_success';
      status: PaymentStatus;
      error: null;
    }
  | {
      kind: 'terminal_expired';
      status: 'expired';
      error: 'PAYMENT_EXPIRED';
    }
  | {
      kind: 'non_terminal_error';
      status: 'pending' | 'processing';
      error: string;
    };
