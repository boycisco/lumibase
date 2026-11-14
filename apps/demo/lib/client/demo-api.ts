import type {
  ConfirmPaymentResponse,
  DemoPublicConfig,
  LumiBaseApiErrorEnvelope,
  PaymentStatus,
  PaymentStatusSnapshot,
  WirePayment,
} from '@/lib/lumibase/types';

export interface BffTraceEntry {
  id: string;
  timestamp: string;
  method: 'GET' | 'POST';
  path: string;
  httpStatus: number;
  durationMs: number;
  paymentStatus?: PaymentStatus;
  errorCode?: string | null;
  requestId?: string | null;
  note?: string;
}

export class BffHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly envelope: LumiBaseApiErrorEnvelope | null;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId: string | null;
    retryAfterSeconds: number | null;
    envelope: LumiBaseApiErrorEnvelope | null;
  }) {
    super(params.message);
    this.name = 'BffHttpError';
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.envelope = params.envelope;
  }
}

export type TraceListener = (entry: BffTraceEntry) => void;

async function callBff<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  onTrace?: TraceListener,
): Promise<T> {
  const startedAt = performance.now();
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });

  const durationMs = Math.round(performance.now() - startedAt);
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const maybeEnvelope =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? (parsed as LumiBaseApiErrorEnvelope)
        : null;

    const code = maybeEnvelope?.error?.code ?? `HTTP_${response.status}`;
    const message =
      maybeEnvelope?.error?.message ??
      `Demo server returned HTTP ${response.status}.`;
    const requestId = maybeEnvelope?.error?.requestId ?? null;

    onTrace?.({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      method,
      path,
      httpStatus: response.status,
      durationMs,
      errorCode: code,
      requestId,
    });

    throw new BffHttpError({
      status: response.status,
      code,
      message,
      requestId,
      retryAfterSeconds:
        retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds
          : null,
      envelope: maybeEnvelope,
    });
  }

  const record =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;

  const paymentStatus =
    (record?.status as PaymentStatus | undefined) ??
    ((record?.payment as Record<string, unknown> | undefined)?.status as
      | PaymentStatus
      | undefined);

  const errorCode =
    typeof record?.error === 'string' ? record.error : null;

  onTrace?.({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    method,
    path,
    httpStatus: response.status,
    durationMs,
    paymentStatus,
    errorCode,
  });

  return parsed as T;
}

export function fetchDemoConfig(
  onTrace?: TraceListener,
): Promise<DemoPublicConfig> {
  return callBff<DemoPublicConfig>('GET', '/demo/config', undefined, onTrace);
}

export function createDemoPayment(
  payload: {
    amount: string;
    reference?: string | null;
    expiresIn?: number;
    payer?: string | null;
  },
  onTrace?: TraceListener,
): Promise<WirePayment> {
  return callBff<WirePayment>('POST', '/demo/payments', payload, onTrace);
}

export function confirmDemoPayment(
  paymentId: string,
  transactionHash: string,
  onTrace?: TraceListener,
): Promise<ConfirmPaymentResponse> {
  return callBff<ConfirmPaymentResponse>(
    'POST',
    `/demo/payments/${paymentId}/confirm`,
    { transactionHash },
    onTrace,
  );
}

export function fetchDemoPayment(
  paymentId: string,
  onTrace?: TraceListener,
): Promise<WirePayment> {
  return callBff<WirePayment>(
    'GET',
    `/demo/payments/${paymentId}`,
    undefined,
    onTrace,
  );
}

export function fetchDemoPaymentStatus(
  paymentId: string,
  onTrace?: TraceListener,
): Promise<PaymentStatusSnapshot> {
  return callBff<PaymentStatusSnapshot>(
    'GET',
    `/demo/payments/${paymentId}/status`,
    undefined,
    onTrace,
  );
}
