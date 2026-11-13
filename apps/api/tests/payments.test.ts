import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { applications } from '@lumibase/database';
import {
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC,
  type NetworkConfig,
  type ResolvedChain,
} from '@lumibase/network';
import { hashApiKey, buildApp, loadApiConfig } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

let app: Awaited<ReturnType<typeof buildApp>>;
let apiKey: string;

/**
 * Always-present Sepolia chain for these tests. Create/get/status endpoints
 * do not touch RPC; they only need a chain in the config so findToken()
 * can validate the token address. Batch 3 (confirm) will override this with
 * a real anvil-backed chain.
 */
function chainsWithSepolia(): NetworkConfig {
  const sepolia: ResolvedChain = {
    ...BASE_SEPOLIA,
    rpc: 'http://localhost:1',
  };
  return { chains: new Map([[BASE_SEPOLIA.id, sepolia]]) };
}

beforeEach(async () => {
  await truncateAll();
  apiKey = `lb_${randomBytes(32).toString('base64url')}`;
  await db.insert(applications).values({
    name: 'test-app',
    keyHash: hashApiKey(apiKey),
    status: 'active',
  });
  const config = loadApiConfig(process.env);
  const chains = chainsWithSepolia();
  app = await buildApp({ config, db, chains, prettyLogs: false });
});

afterEach(async () => {
  await app.close();
  await truncateAll();
});

function authHeader(): string {
  return `Bearer ${apiKey}`;
}

const RECIPIENT = '0x0000000000000000000000000000000000000001';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: '1500000',
    chainId: BASE_SEPOLIA.id,
    token: BASE_SEPOLIA_USDC.address,
    recipient: RECIPIENT,
    expiresIn: 1800,
    ...overrides,
  };
}

describe('POST /api/v1/payments', () => {
  it('creates a payment and returns the wire format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ reference: 'ORDER_123' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    expect(body.amount).toBe('1500000');
    expect(body.status).toBe('pending');
    expect(body.chainId).toBe(BASE_SEPOLIA.id);
    expect(body.token).toBe(BASE_SEPOLIA_USDC.address.toLowerCase());
    expect(body.recipient).toBe(RECIPIENT);
    expect(body.reference).toBe('ORDER_123');
    expect(body.payer).toBeNull();
    expect(typeof body.expiresAt).toBe('string');
    expect(typeof body.createdAt).toBe('string');
  });

  it('rejects without auth (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      payload: validBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid amount (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ amount: 'not-a-number' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects amount 0 (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ amount: '0' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unsupported chain (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ chainId: 999999 }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('UNSUPPORTED_CHAIN');
  });

  it('rejects unsupported token (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({
        token: '0x0000000000000000000000000000000000000099',
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('UNSUPPORTED_TOKEN');
  });

  it('rejects invalid recipient (400 via VALIDATION_ERROR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ recipient: 'not-an-address' }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/payments/:id', () => {
  it('returns the payment in wire format', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${id}`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
    expect(res.json().amount).toBe('1500000');
  });

  it('returns 404 for a nonexistent ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/payments/00000000-0000-4000-8000-000000000000',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it("returns 404 for another app's payment (isolation)", async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const otherKey = `lb_${randomBytes(32).toString('base64url')}`;
    await db.insert(applications).values({
      name: 'other-app',
      keyHash: hashApiKey(otherKey),
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${id}`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/payments/:id/status', () => {
  it('returns lightweight status payload', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${id}/status`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.status).toBe('pending');
    expect(typeof body.updatedAt).toBe('string');
    expect(body.amount).toBeUndefined();
  });

  it("returns 404 for another app's payment", async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const otherKey = `lb_${randomBytes(32).toString('base64url')}`;
    await db.insert(applications).values({
      name: 'other-app',
      keyHash: hashApiKey(otherKey),
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${id}/status`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('cross-endpoint: createResponse passes internal round-trip', () => {
  it('create response matches get response exactly', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ reference: 'R1' }),
    });
    const createdBody = created.json();

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${createdBody.id}`,
      headers: { authorization: authHeader() },
    });
    const fetchedBody = fetched.json();

    expect(fetchedBody).toEqual(createdBody);
  });
});

describe('POST /api/v1/payments/:id/confirm', () => {
  it('rejects without auth (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/00000000-0000-4000-8000-000000000000/confirm',
      payload: { transactionHash: '0x' + 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed transactionHash (400)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/confirm`,
      headers: { authorization: authHeader() },
      payload: { transactionHash: 'not-a-hash' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns PAYMENT_NOT_FOUND for a nonexistent payment (404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/00000000-0000-4000-8000-000000000000/confirm',
      headers: { authorization: authHeader() },
      payload: { transactionHash: '0x' + 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('terminal payment returns current state without hitting RPC', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    // Cancel first so the payment is terminal
    await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/cancel`,
      headers: { authorization: authHeader() },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/confirm`,
      headers: { authorization: authHeader() },
      payload: { transactionHash: '0x' + 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.payment.status).toBe('cancelled');
    expect(body.error).toBeNull();
  });

  it('pending payment with unreachable RPC returns TRANSACTION_RPC_FAILURE (200)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/confirm`,
      headers: { authorization: authHeader() },
      payload: { transactionHash: '0x' + 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.payment.status).toBe('pending');
    expect(body.error).toBe('TRANSACTION_RPC_FAILURE');
  });
});

describe('POST /api/v1/payments/:id/cancel', () => {
  it('cancels a pending payment (200)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/cancel`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect(res.json().id).toBe(id);
  });

  it('is idempotent: second cancel returns cancelled (200)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/cancel`,
      headers: { authorization: authHeader() },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/cancel`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
  });

  it("returns 404 for another app's payment", async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;

    const otherKey = `lb_${randomBytes(32).toString('base64url')}`;
    await db.insert(applications).values({
      name: 'other-app',
      keyHash: hashApiKey(otherKey),
      status: 'active',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/cancel`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects without auth (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/00000000-0000-4000-8000-000000000000/cancel',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/payments', () => {
  it('returns an empty list when no payments exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ payments: [] });
  });

  it('returns all payments for the calling application', async () => {
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: authHeader() },
        payload: validBody(),
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().payments).toHaveLength(3);
  });

  it('filters by status', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });
    const id = created.json().id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/cancel`,
      headers: { authorization: authHeader() },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });

    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/payments?status=pending',
      headers: { authorization: authHeader() },
    });
    const cancelled = await app.inject({
      method: 'GET',
      url: '/api/v1/payments?status=cancelled',
      headers: { authorization: authHeader() },
    });
    expect(pending.json().payments).toHaveLength(1);
    expect(cancelled.json().payments).toHaveLength(1);
  });

  it('filters by reference', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ reference: 'ORDER_A' }),
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody({ reference: 'ORDER_B' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/payments?reference=ORDER_A',
      headers: { authorization: authHeader() },
    });
    expect(res.json().payments).toHaveLength(1);
    expect(res.json().payments[0].reference).toBe('ORDER_A');
  });

  it('honors limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: authHeader() },
        payload: validBody(),
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/payments?limit=2',
      headers: { authorization: authHeader() },
    });
    expect(res.json().payments).toHaveLength(2);
  });

  it("returns only the calling application's payments (isolation)", async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { authorization: authHeader() },
      payload: validBody(),
    });

    const otherKey = `lb_${randomBytes(32).toString('base64url')}`;
    await db.insert(applications).values({
      name: 'other-app',
      keyHash: hashApiKey(otherKey),
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/payments',
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(res.json().payments).toEqual([]);
  });

  it('rejects invalid status value (400)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/payments?status=bogus',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects without auth (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/payments' });
    expect(res.statusCode).toBe(401);
  });
});
