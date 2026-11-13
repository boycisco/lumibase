import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { applications } from '@lumibase/database';
import {
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC,
  type NetworkConfig,
  type ResolvedChain,
} from '@lumibase/network';
import { buildApp, hashApiKey, loadApiConfig } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

function chainsWithSepolia(): NetworkConfig {
  const sepolia: ResolvedChain = {
    ...BASE_SEPOLIA,
    rpc: 'http://localhost:1',
  };
  return { chains: new Map([[BASE_SEPOLIA.id, sepolia]]) };
}

async function buildTestApp(overrides: Record<string, string> = {}) {
  const config = loadApiConfig({ ...process.env, ...overrides });
  const chains = chainsWithSepolia();
  return buildApp({ config, db, chains, prettyLogs: false });
}

let apiKey: string;

beforeEach(async () => {
  await truncateAll();
  apiKey = `lb_${randomBytes(32).toString('base64url')}`;
  await db.insert(applications).values({
    name: 'test-app',
    keyHash: hashApiKey(apiKey),
    status: 'active',
  });
});

describe('OpenAPI', () => {
  it('serves /openapi.json as an OpenAPI 3.0 document', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('LumiBase API');
    expect(spec.info.version).toBe('0.1.0');
    expect(spec.paths['/payments']).toBeDefined();
    expect(spec.paths['/payments/{id}']).toBeDefined();
    expect(spec.paths['/payments/{id}/confirm']).toBeDefined();
    expect(spec.paths['/payments/{id}/cancel']).toBeDefined();
    await app.close();
  });

  it('documents the Payment schema', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const spec = res.json();
    expect(spec.components.schemas.Payment).toBeDefined();
    expect(spec.components.schemas.Payment.properties.amount.type).toBe('string');
    expect(spec.components.schemas.Payment.properties.status.enum).toContain('confirmed');
    await app.close();
  });

  it('does not require auth', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('serves Swagger UI at /docs', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(res.statusCode);
    await app.close();
  });
});

describe('Rate limiting', () => {
  it('throttles after RATE_LIMIT_MAX requests within the window', async () => {
    const app = await buildTestApp({
      RATE_LIMIT_MAX: '2',
      RATE_LIMIT_WINDOW_MS: '60000',
    });
    const headers = { authorization: `Bearer ${apiKey}` };
    const payload = {
      amount: '1500000',
      chainId: BASE_SEPOLIA.id,
      token: BASE_SEPOLIA_USDC.address,
      recipient: '0x0000000000000000000000000000000000000001',
      expiresIn: 1800,
    };

    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers,
        payload,
      });
      expect(res.statusCode).toBe(201);
    }

    const third = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers,
      payload,
    });
    // @fastify/rate-limit's default response shape varies by version; the
    // essential contract is the status code.
    expect(third.statusCode).toBe(429);

    await app.close();
  });
});
