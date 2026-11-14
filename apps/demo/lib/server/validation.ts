import { formatUnits, getAddress, isAddress, parseUnits } from 'viem';
import {
  BASE_SEPOLIA_USDC_DECIMALS,
  DEFAULT_EXPIRES_IN_SECONDS,
  MAX_EXPIRES_IN_SECONDS,
  MAX_REFERENCE_LENGTH,
} from '@/lib/lumibase/constants';

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_INPUT_REGEX = /^\d+(?:\.\d+)?$/;

export class RequestValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export interface ValidatedCreatePaymentPayload {
  amountBaseUnits: string;
  humanAmount: string;
  reference: string | null;
  expiresIn: number;
  payer: `0x${string}` | null;
}

/**
 * Converts a human-readable USDC amount string into 6-decimal base units.
 * Explicitly rejects > 6 decimal places without silent truncation or rounding.
 */
export function validateAndConvertUsdcAmount(rawAmount: unknown): {
  baseUnits: string;
  humanAmount: string;
} {
  if (typeof rawAmount !== 'string') {
    throw new RequestValidationError(
      'Amount must be provided as a decimal string (for example, "1.5").',
    );
  }

  const trimmed = rawAmount.trim();
  if (!trimmed) {
    throw new RequestValidationError('Amount is required.');
  }

  if (!DECIMAL_INPUT_REGEX.test(trimmed)) {
    throw new RequestValidationError(
      'Amount must be a positive decimal number using digits and at most one decimal point.',
    );
  }

  const [, fractionalPart = ''] = trimmed.split('.');
  if (fractionalPart.length > BASE_SEPOLIA_USDC_DECIMALS) {
    throw new RequestValidationError('Amount has more than 6 decimal places.');
  }

  let parsed: bigint;
  try {
    parsed = parseUnits(trimmed, BASE_SEPOLIA_USDC_DECIMALS);
  } catch {
    throw new RequestValidationError('Amount could not be parsed as 6-decimal USDC.');
  }

  if (parsed <= BigInt(0)) {
    throw new RequestValidationError('Amount must be greater than 0.');
  }

  if (parsed > MAX_UINT256) {
    throw new RequestValidationError('Amount exceeds maximum uint256 value.');
  }

  return {
    baseUnits: parsed.toString(),
    humanAmount: formatUnits(parsed, BASE_SEPOLIA_USDC_DECIMALS),
  };
}

export function validatePaymentId(id: string): string {
  const trimmed = id.trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw new RequestValidationError('Payment ID must be a valid UUID.');
  }
  return trimmed;
}

export function validateTransactionHash(rawHash: unknown): `0x${string}` {
  if (typeof rawHash !== 'string') {
    throw new RequestValidationError('transactionHash must be a hex string.');
  }
  const trimmed = rawHash.trim();
  if (!TX_HASH_REGEX.test(trimmed)) {
    throw new RequestValidationError(
      'transactionHash must be a 66-character 0x-prefixed hex hash.',
    );
  }
  return trimmed as `0x${string}`;
}

export function validateCreatePaymentBody(body: unknown): ValidatedCreatePaymentPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestValidationError('Request body must be a JSON object.');
  }

  const record = body as Record<string, unknown>;

  if (
    record.recipient !== undefined ||
    record.chainId !== undefined ||
    record.token !== undefined
  ) {
    throw new RequestValidationError(
      'recipient, chainId, and token are controlled by server configuration and cannot be set by the browser.',
    );
  }

  const { baseUnits, humanAmount } = validateAndConvertUsdcAmount(record.amount);

  let reference: string | null = null;
  if (record.reference !== undefined && record.reference !== null) {
    if (typeof record.reference !== 'string') {
      throw new RequestValidationError('reference must be a string or null.');
    }
    const trimmedRef = record.reference.trim();
    if (trimmedRef.length > MAX_REFERENCE_LENGTH) {
      throw new RequestValidationError(
        `reference must be at most ${MAX_REFERENCE_LENGTH} characters.`,
      );
    }
    reference = trimmedRef.length > 0 ? trimmedRef : null;
  }

  let expiresIn = DEFAULT_EXPIRES_IN_SECONDS;
  if (record.expiresIn !== undefined && record.expiresIn !== null) {
    if (
      typeof record.expiresIn !== 'number' ||
      !Number.isInteger(record.expiresIn) ||
      record.expiresIn < 1 ||
      record.expiresIn > MAX_EXPIRES_IN_SECONDS
    ) {
      throw new RequestValidationError(
        `expiresIn must be a positive integer up to ${MAX_EXPIRES_IN_SECONDS} seconds (30 days).`,
      );
    }
    expiresIn = record.expiresIn;
  }

  let payer: `0x${string}` | null = null;
  if (record.payer !== undefined && record.payer !== null && record.payer !== '') {
    if (typeof record.payer !== 'string' || !isAddress(record.payer, { strict: false })) {
      throw new RequestValidationError('payer must be a valid EVM address or null.');
    }
    payer = getAddress(record.payer);
  }

  return {
    amountBaseUnits: baseUnits,
    humanAmount,
    reference,
    expiresIn,
    payer,
  };
}
