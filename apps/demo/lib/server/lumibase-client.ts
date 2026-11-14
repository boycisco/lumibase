import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC_ADDRESS,
} from '@/lib/lumibase/constants';
import { ensureApplicationApiKey, UpstreamLumiBaseError } from './bootstrap';
import type { ValidatedCreatePaymentPayload } from './validation';

export interface LumiBaseForwardResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

async function forwardToLumiBase(
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
  },
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<LumiBaseForwardResult> {
  const { apiKey, config } = await ensureApplicationApiKey(fetchImpl, env);

  let response: Response;
  try {
    response = await fetchImpl(`${config.lumibaseApiUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
  } catch {
    throw new UpstreamLumiBaseError(503, {
      error: {
        code: 'LUMIBASE_UNREACHABLE',
        message: 'Unable to reach the configured LumiBase API.',
        requestId: crypto.randomUUID(),
      },
    });
  }

  let parsedBody: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = null;
    }
  }

  const forwardedHeaders: Record<string, string> = {};
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    forwardedHeaders['Retry-After'] = retryAfter;
  }

  if (!response.ok) {
    if (parsedBody && typeof parsedBody === 'object') {
      return {
        status: response.status,
        body: parsedBody,
        headers: forwardedHeaders,
      };
    }

    return {
      status: response.status,
      body: {
        error: {
          code: 'UPSTREAM_ERROR',
          message: `LumiBase API returned HTTP ${response.status}.`,
          requestId: crypto.randomUUID(),
        },
      },
      headers: forwardedHeaders,
    };
  }

  return {
    status: response.status,
    body: parsedBody,
    headers: forwardedHeaders,
  };
}

export async function createPaymentInLumiBase(
  payload: ValidatedCreatePaymentPayload,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<LumiBaseForwardResult> {
  const { config } = await ensureApplicationApiKey(fetchImpl, env);

  return forwardToLumiBase(
    '/api/v1/payments',
    {
      method: 'POST',
      body: {
        amount: payload.amountBaseUnits,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        token: BASE_SEPOLIA_USDC_ADDRESS,
        recipient: config.demoRecipient,
        payer: payload.payer,
        reference: payload.reference,
        expiresIn: payload.expiresIn,
        metadata: null,
      },
    },
    fetchImpl,
    env,
  );
}

export async function confirmPaymentInLumiBase(
  paymentId: string,
  transactionHash: `0x${string}`,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<LumiBaseForwardResult> {
  return forwardToLumiBase(
    `/api/v1/payments/${paymentId}/confirm`,
    {
      method: 'POST',
      body: { transactionHash },
    },
    fetchImpl,
    env,
  );
}

export async function getPaymentFromLumiBase(
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<LumiBaseForwardResult> {
  return forwardToLumiBase(
    `/api/v1/payments/${paymentId}`,
    { method: 'GET' },
    fetchImpl,
    env,
  );
}

export async function getPaymentStatusFromLumiBase(
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<LumiBaseForwardResult> {
  return forwardToLumiBase(
    `/api/v1/payments/${paymentId}/status`,
    { method: 'GET' },
    fetchImpl,
    env,
  );
}
