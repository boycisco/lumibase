import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC_ADDRESS,
  getVerificationOutcomeSpec,
  interpretConfirmationResponse,
  isTerminalPaymentStatus,
} from '@/lib/lumibase/constants';
import type { ConfirmPaymentResponse, WirePayment } from '@/lib/lumibase/types';
import {
  ensureApplicationApiKey,
  getBootstrapStatusForTest,
  resetBootstrapForTesting,
} from '@/lib/server/bootstrap';
import {
  assertValidServerConfig,
  DemoConfigurationError,
  validateServerConfig,
} from '@/lib/server/config';
import {
  confirmPaymentInLumiBase,
  createPaymentInLumiBase,
  getPaymentFromLumiBase,
  getPaymentStatusFromLumiBase,
} from '@/lib/server/lumibase-client';
import {
  checkRateLimit,
  resetRateLimiterForTesting,
} from '@/lib/server/rate-limit';
import {
  RequestValidationError,
  validateAndConvertUsdcAmount,
  validateCreatePaymentBody,
  validatePaymentId,
  validateTransactionHash,
} from '@/lib/server/validation';
import { GET as getConfigRoute } from '@/app/demo/config/route';
import { POST as createPaymentRoute } from '@/app/demo/payments/route';
import { GET as getPaymentRoute } from '@/app/demo/payments/[id]/route';
import { POST as confirmPaymentRoute } from '@/app/demo/payments/[id]/confirm/route';
import { GET as getStatusRoute } from '@/app/demo/payments/[id]/status/route';

const VALID_ENV = {
  LUMIBASE_API_URL: 'http://127.0.0.1:4999/',
  API_SECRET: 'test-admin-secret-never-exposed',
  DEMO_RECIPIENT: '0x1111111111111111111111111111111111111111',
  DEMO_PORT: '4000',
  NODE_ENV: 'test',
};

const SAMPLE_PAYMENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const SAMPLE_TX_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

function makeWirePayment(overrides: Partial<WirePayment> = {}): WirePayment {
  return {
    id: SAMPLE_PAYMENT_ID,
    amount: '1500000',
    chainId: BASE_SEPOLIA_CHAIN_ID,
    token: BASE_SEPOLIA_USDC_ADDRESS,
    recipient: '0x1111111111111111111111111111111111111111',
    payer: null,
    reference: 'demo-order-001',
    status: 'pending',
    transactionHash: null,
    blockNumber: null,
    confirmedAmount: null,
    expiresAt: '2026-11-14T13:00:00.000Z',
    createdAt: '2026-11-14T12:30:00.000Z',
    updatedAt: '2026-11-14T12:30:00.000Z',
    metadata: null,
    ...overrides,
  };
}

describe('Server configuration validation (§12)', () => {
  it('fails safely when LUMIBASE_API_URL, API_SECRET, or DEMO_RECIPIENT is missing', () => {
    const result = validateServerConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual([
        'LUMIBASE_API_URL',
        'API_SECRET',
        'DEMO_RECIPIENT',
      ]);
    }

    expect(() => assertValidServerConfig({})).toThrow(DemoConfigurationError);
  });

  it('rejects invalid LUMIBASE_API_URL and invalid DEMO_RECIPIENT without placeholders', () => {
    const result = validateServerConfig({
      LUMIBASE_API_URL: 'ftp://invalid.example.com',
      API_SECRET: 'secret',
      DEMO_RECIPIENT: 'not-an-address',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalid.length).toBe(2);
    }
  });

  it('normalizes trailing slash and checksums valid EVM recipient', () => {
    const config = assertValidServerConfig({
      LUMIBASE_API_URL: 'http://localhost:3000///',
      API_SECRET: 'secret',
      DEMO_RECIPIENT: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    });

    expect(config.lumibaseApiUrl).toBe('http://localhost:3000');
    expect(config.demoRecipient).toBe(
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    );
  });
});

describe('BFF request validation & integer-safe USDC arithmetic (§5.3, §6.2)', () => {
  it('converts valid USDC decimals to 6-decimal base units exactly', () => {
    expect(validateAndConvertUsdcAmount('1.5').baseUnits).toBe('1500000');
    expect(validateAndConvertUsdcAmount('0.000001').baseUnits).toBe('1');
    expect(validateAndConvertUsdcAmount('1000').baseUnits).toBe('1000000000');
    expect(validateAndConvertUsdcAmount('12.345678').baseUnits).toBe(
      '12345678',
    );
  });

  it('rejects amounts with more than 6 decimal places without silent truncation', () => {
    expect(() => validateAndConvertUsdcAmount('1.5000001')).toThrow(
      RequestValidationError,
    );
    expect(() => validateAndConvertUsdcAmount('0.0000009')).toThrow(
      'Amount has more than 6 decimal places.',
    );
  });

  it('rejects zero, negative, non-string, and malformed amounts', () => {
    expect(() => validateAndConvertUsdcAmount('0')).toThrow(
      RequestValidationError,
    );
    expect(() => validateAndConvertUsdcAmount('0.000000')).toThrow(
      RequestValidationError,
    );
    expect(() => validateAndConvertUsdcAmount('-1.5')).toThrow(
      RequestValidationError,
    );
    expect(() => validateAndConvertUsdcAmount(1.5)).toThrow(
      RequestValidationError,
    );
    expect(() => validateAndConvertUsdcAmount('1e-6')).toThrow(
      RequestValidationError,
    );
  });

  it('rejects browser-supplied recipient, chainId, or token overrides', () => {
    expect(() =>
      validateCreatePaymentBody({
        amount: '1.5',
        recipient: '0x2222222222222222222222222222222222222222',
      }),
    ).toThrow(RequestValidationError);

    expect(() =>
      validateCreatePaymentBody({
        amount: '1.5',
        chainId: 8453,
      }),
    ).toThrow(RequestValidationError);
  });

  it('validates payment UUIDs and 66-char transaction hashes', () => {
    expect(validatePaymentId(SAMPLE_PAYMENT_ID)).toBe(SAMPLE_PAYMENT_ID);
    expect(() => validatePaymentId('../applications')).toThrow(
      RequestValidationError,
    );

    expect(validateTransactionHash(SAMPLE_TX_HASH)).toBe(SAMPLE_TX_HASH);
    expect(() => validateTransactionHash('0x1234')).toThrow(
      RequestValidationError,
    );
  });
});

describe('Application bootstrap & server-side API key handling (§3.3, §7.1)', () => {
  beforeEach(() => {
    resetBootstrapForTesting();
  });

  it('bootstraps using Authorization: Admin <API_SECRET> and caches key in memory', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          application: {
            id: '660e8400-e29b-41d4-a716-446655440000',
            name: 'demo-2026-11-14',
            status: 'active',
            createdAt: '2026-11-14T12:00:00.000Z',
          },
          key: 'lb_server_only_secret_key',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const [first, second] = await Promise.all([
      ensureApplicationApiKey(fetchMock as unknown as typeof fetch, VALID_ENV),
      ensureApplicationApiKey(fetchMock as unknown as typeof fetch, VALID_ENV),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://127.0.0.1:4999/api/v1/applications');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Admin ${VALID_ENV.API_SECRET}`,
    );
    expect(first.apiKey).toBe('lb_server_only_secret_key');
    expect(second.apiKey).toBe('lb_server_only_secret_key');
    expect(getBootstrapStatusForTest().hasKey).toBe(true);
  });
});

describe('Server-to-LumiBase client & verbatim error pass-through (§6.2, §7)', () => {
  beforeEach(() => {
    resetBootstrapForTesting();
  });

  it('forwards server-controlled recipient, Base Sepolia chainId, and USDC token on payment creation', async () => {
    const createdPayment = makeWirePayment();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            application: { id: 'app-1' },
            key: 'lb_live_memory_key',
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createdPayment), { status: 201 }),
      );

    const validated = validateCreatePaymentBody({
      amount: '1.5',
      reference: 'demo-order-001',
    });

    const res = await createPaymentInLumiBase(
      validated,
      fetchMock as unknown as typeof fetch,
      VALID_ENV,
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual(createdPayment);

    const [paymentUrl, paymentInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(paymentUrl).toBe('http://127.0.0.1:4999/api/v1/payments');
    expect((paymentInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer lb_live_memory_key',
    );
    expect(JSON.parse(String(paymentInit.body))).toEqual({
      amount: '1500000',
      chainId: BASE_SEPOLIA_CHAIN_ID,
      token: BASE_SEPOLIA_USDC_ADDRESS,
      recipient: VALID_ENV.DEMO_RECIPIENT,
      payer: null,
      reference: 'demo-order-001',
      expiresIn: 1800,
      metadata: null,
    });
  });

  it('passes through LumiBase non-2xx error envelopes and Retry-After verbatim', async () => {
    const errorEnvelope = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests upstream.',
        requestId: '11111111-1111-4111-8111-111111111111',
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ application: { id: 'app-1' }, key: 'lb_key' }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(errorEnvelope), {
          status: 429,
          headers: { 'Retry-After': '15' },
        }),
      );

    const res = await getPaymentFromLumiBase(
      SAMPLE_PAYMENT_ID,
      fetchMock as unknown as typeof fetch,
      VALID_ENV,
    );

    expect(res.status).toBe(429);
    expect(res.body).toEqual(errorEnvelope);
    expect(res.headers?.['Retry-After']).toBe('15');
  });

  it('preserves HTTP 200 verification outcomes verbatim on confirm', async () => {
    const confirmOutcome: ConfirmPaymentResponse = {
      payment: makeWirePayment({ status: 'pending' }),
      error: 'TRANSACTION_NOT_FOUND',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ application: { id: 'app-1' }, key: 'lb_key' }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(confirmOutcome), { status: 200 }),
      );

    const res = await confirmPaymentInLumiBase(
      SAMPLE_PAYMENT_ID,
      SAMPLE_TX_HASH,
      fetchMock as unknown as typeof fetch,
      VALID_ENV,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(confirmOutcome);
  });

  it('fetches read-only payment status snapshot', async () => {
    const snapshot = {
      id: SAMPLE_PAYMENT_ID,
      status: 'confirmed',
      updatedAt: '2026-11-14T12:35:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ application: { id: 'app-1' }, key: 'lb_key' }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      );

    const res = await getPaymentStatusFromLumiBase(
      SAMPLE_PAYMENT_ID,
      fetchMock as unknown as typeof fetch,
      VALID_ENV,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(snapshot);
  });
});

describe('Next.js /demo/* BFF route handlers integration', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetBootstrapForTesting();
    resetRateLimiterForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 503 DEMO_CONFIGURATION_ERROR when required env vars are absent', async () => {
    delete process.env.LUMIBASE_API_URL;
    delete process.env.API_SECRET;
    delete process.env.DEMO_RECIPIENT;

    const response = await getConfigRoute(
      new Request('http://localhost:3000/demo/config'),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DEMO_CONFIGURATION_ERROR');
  });

  it('serves /demo/config without leaking API_SECRET, application key, or LUMIBASE_API_URL', async () => {
    Object.assign(process.env, VALID_ENV);
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          application: { id: 'app-1' },
          key: 'lb_super_secret_app_key',
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const response = await getConfigRoute(
      new Request('http://localhost:3000/demo/config'),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(VALID_ENV.API_SECRET);
    expect(text).not.toContain('lb_super_secret_app_key');
    expect(text).not.toContain(VALID_ENV.LUMIBASE_API_URL);

    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toEqual({
      chainId: 84532,
      chainName: 'Base Sepolia',
      usdc: BASE_SEPOLIA_USDC_ADDRESS,
      decimals: 6,
      recipient: VALID_ENV.DEMO_RECIPIENT,
      explorer: 'https://sepolia.basescan.org',
    });
  });

  it('rejects >6 decimal places on POST /demo/payments with 400 VALIDATION_ERROR', async () => {
    Object.assign(process.env, VALID_ENV);
    const response = await createPaymentRoute(
      new Request('http://localhost:3000/demo/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: '1.5000001' }),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('more than 6 decimal places');
    expect(body.error.requestId).toBeTruthy();
  });

  it('handles full payment create -> confirm -> status lifecycle through /demo/* routes', async () => {
    Object.assign(process.env, VALID_ENV);
    const created = makeWirePayment({ status: 'pending' });
    const confirmed = makeWirePayment({
      status: 'confirmed',
      transactionHash: SAMPLE_TX_HASH,
      confirmedAmount: '1500000',
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/applications')) {
        return new Response(
          JSON.stringify({ application: { id: 'app-1' }, key: 'lb_key_123' }),
          { status: 201 },
        );
      }
      if (url.endsWith('/api/v1/payments')) {
        return new Response(JSON.stringify(created), { status: 201 });
      }
      if (url.endsWith(`/api/v1/payments/${SAMPLE_PAYMENT_ID}/confirm`)) {
        return new Response(
          JSON.stringify({ payment: confirmed, error: null }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/v1/payments/${SAMPLE_PAYMENT_ID}/status`)) {
        return new Response(
          JSON.stringify({
            id: SAMPLE_PAYMENT_ID,
            status: 'confirmed',
            updatedAt: '2026-11-14T12:36:00.000Z',
          }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/v1/payments/${SAMPLE_PAYMENT_ID}`)) {
        return new Response(JSON.stringify(confirmed), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {
        status: 404,
      });
    }) as unknown as typeof fetch;

    const createRes = await createPaymentRoute(
      new Request('http://localhost:3000/demo/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: '1.5', reference: 'demo-order-001' }),
      }),
    );
    expect(createRes.status).toBe(201);

    const confirmRes = await confirmPaymentRoute(
      new Request(
        `http://localhost:3000/demo/payments/${SAMPLE_PAYMENT_ID}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionHash: SAMPLE_TX_HASH }),
        },
      ),
      { params: Promise.resolve({ id: SAMPLE_PAYMENT_ID }) },
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody = (await confirmRes.json()) as ConfirmPaymentResponse;
    expect(confirmBody.payment.status).toBe('confirmed');
    expect(confirmBody.error).toBeNull();

    const statusRes = await getStatusRoute(
      new Request(
        `http://localhost:3000/demo/payments/${SAMPLE_PAYMENT_ID}/status`,
      ),
      { params: Promise.resolve({ id: SAMPLE_PAYMENT_ID }) },
    );
    expect(statusRes.status).toBe(200);

    const getRes = await getPaymentRoute(
      new Request(`http://localhost:3000/demo/payments/${SAMPLE_PAYMENT_ID}`),
      { params: Promise.resolve({ id: SAMPLE_PAYMENT_ID }) },
    );
    expect(getRes.status).toBe(200);
  });
});

describe('Lifecycle & verification outcome semantics (§8.3, §9.2)', () => {
  it('distinguishes terminal vs non-terminal statuses accurately', () => {
    expect(isTerminalPaymentStatus('pending')).toBe(false);
    expect(isTerminalPaymentStatus('processing')).toBe(false);

    expect(isTerminalPaymentStatus('confirmed')).toBe(true);
    expect(isTerminalPaymentStatus('underpaid')).toBe(true);
    expect(isTerminalPaymentStatus('overpaid')).toBe(true);
    expect(isTerminalPaymentStatus('expired')).toBe(true);
    expect(isTerminalPaymentStatus('cancelled')).toBe(true);
    expect(isTerminalPaymentStatus('failed')).toBe(true);
  });

  it('interprets every v0.1 confirmation outcome code according to §8.3', () => {
    expect(
      interpretConfirmationResponse({
        payment: makeWirePayment({ status: 'confirmed' }),
        error: null,
      }),
    ).toEqual({
      kind: 'terminal_success',
      status: 'confirmed',
      error: null,
    });

    expect(
      interpretConfirmationResponse({
        payment: makeWirePayment({ status: 'underpaid' }),
        error: null,
      }),
    ).toEqual({
      kind: 'terminal_success',
      status: 'underpaid',
      error: null,
    });

    expect(
      interpretConfirmationResponse({
        payment: makeWirePayment({ status: 'overpaid' }),
        error: null,
      }),
    ).toEqual({
      kind: 'terminal_success',
      status: 'overpaid',
      error: null,
    });

    expect(
      interpretConfirmationResponse({
        payment: makeWirePayment({ status: 'expired' }),
        error: 'PAYMENT_EXPIRED',
      }),
    ).toEqual({
      kind: 'terminal_expired',
      status: 'expired',
      error: 'PAYMENT_EXPIRED',
    });

    // Idempotent confirmation on an already-terminal payment
    expect(
      interpretConfirmationResponse({
        payment: makeWirePayment({ status: 'expired' }),
        error: null,
      }),
    ).toEqual({
      kind: 'terminal_success',
      status: 'expired',
      error: null,
    });

    // Non-terminal outcomes
    const retryableCodes = [
      'TRANSACTION_NOT_FOUND',
      'TRANSACTION_NOT_ENOUGH_CONFIRMATIONS',
      'TRANSACTION_RPC_FAILURE',
    ] as const;
    for (const code of retryableCodes) {
      const interpreted = interpretConfirmationResponse({
        payment: makeWirePayment({ status: 'pending' }),
        error: code,
      });
      expect(interpreted.kind).toBe('non_terminal_error');
      expect(getVerificationOutcomeSpec(code)?.action).toBe('retry_same_hash');
    }

    const nonRetryableCodes = [
      'TRANSACTION_REVERTED',
      'TRANSACTION_WRONG_RECIPIENT',
      'TRANSACTION_WRONG_TOKEN',
      'TRANSACTION_WRONG_SENDER',
      'TRANSACTION_ALREADY_PROCESSED',
    ] as const;
    for (const code of nonRetryableCodes) {
      const interpreted = interpretConfirmationResponse({
        payment: makeWirePayment({ status: 'pending' }),
        error: code,
      });
      expect(interpreted.kind).toBe('non_terminal_error');
      expect(getVerificationOutcomeSpec(code)?.action).toBe('do_not_retry');
    }

    const inProgress = interpretConfirmationResponse({
      payment: makeWirePayment({ status: 'processing' }),
      error: 'PAYMENT_VERIFICATION_IN_PROGRESS',
    });
    expect(inProgress.kind).toBe('non_terminal_error');
    expect(getVerificationOutcomeSpec('PAYMENT_VERIFICATION_IN_PROGRESS')?.action).toBe(
      'poll_status',
    );
  });

  it('enforces BFF sliding-window rate limits with Retry-After', () => {
    resetRateLimiterForTesting();
    const first = checkRateLimit('192.0.2.1', 2, 1000);
    const second = checkRateLimit('192.0.2.1', 2, 1000);
    const third = checkRateLimit('192.0.2.1', 2, 1000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });
});
