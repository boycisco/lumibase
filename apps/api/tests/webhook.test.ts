import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { LumiError } from '@lumibase/core';
import { applications, webhooks } from '@lumibase/database';
import { BASE_SEPOLIA, type NetworkConfig, type ResolvedChain } from '@lumibase/network';
import { buildApp, hashApiKey, loadApiConfig } from '../src/index.ts';
import { decryptSecret } from '../src/crypto.ts';
import * as ssrf from '../src/ssrf.ts';
import { db, truncateAll } from './setup.ts';

let app: Awaited<ReturnType<typeof buildApp>>;
let apiKey: string;

function chainsWithSepolia(): NetworkConfig {
  const sepolia: ResolvedChain = { ...BASE_SEPOLIA, rpc: 'http://localhost:1' };
  return { chains: new Map([[BASE_SEPOLIA.id, sepolia]]) };
}

beforeEach(async () => {
  await truncateAll();
  apiKey = `lb_${randomBytes(32).toString('base64url')}`;
  await db
    .insert(applications)
    .values({ name: 'webhook-test', keyHash: hashApiKey(apiKey), status: 'active' });

  // Stub SSRF so registration tests don't depend on real DNS.
  vi.spyOn(ssrf, 'validateWebhookEndpoint').mockImplementation(async (url: string) => new URL(url));

  const config = loadApiConfig(process.env);
  app = await buildApp({ config, db, chains: chainsWithSepolia(), prettyLogs: false });
});

function authHeader(): string {
  return `Bearer ${apiKey}`;
}

describe('POST /api/v1/webhooks', () => {
  it('creates a webhook, returns plaintext secret once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.webhook.id).toBe('string');
    expect(body.webhook.endpoint).toBe('https://example.com/hook');
    expect(body.webhook.enabled).toBe(true);
    expect(body.secret).toMatch(/^whsec_[A-Za-z0-9_-]+$/);
  });

  it('stores the secret encrypted, not plaintext', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'https://example.com/hook' },
    });
    const body = res.json();

    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, body.webhook.id));
    expect(row).toBeDefined();
    expect(row!.secretCiphertext).not.toBe(body.secret);
    expect(row!.secretCiphertext).not.toContain('whsec_');

    const master = process.env.WEBHOOK_SECRET!;
    expect(decryptSecret(row!.secretCiphertext, master)).toBe(body.secret);
  });

  it('rejects without auth (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      payload: { endpoint: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects missing endpoint (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('propagates SSRF rejection (422)', async () => {
    vi.spyOn(ssrf, 'validateWebhookEndpoint').mockRejectedValueOnce(
      new LumiError('WEBHOOK_INVALID_ENDPOINT', 'Webhook endpoint URL is not a valid URL.', {
        statusCode: 422,
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'not a url' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('WEBHOOK_INVALID_ENDPOINT');
  });
});

describe('GET /api/v1/webhooks', () => {
  it("returns only this application's webhooks", async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'https://example.com/a' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'https://example.com/b' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().webhooks).toHaveLength(2);
  });

  it('never returns the secret', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'https://example.com/hook' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
    });
    const body = res.body;
    expect(body).not.toContain('whsec_');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('ciphertext');
  });

  it('rejects without auth (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/webhooks' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api/v1/webhooks/:id', () => {
  it('deletes the webhook and returns 204', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'https://example.com/hook' },
    });
    const id = created.json().webhook.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/webhooks/${id}`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(204);

    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id));
    expect(row).toBeUndefined();
  });

  it("rejects another app's webhook with 404", async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: authHeader() },
      payload: { endpoint: 'https://example.com/hook' },
    });
    const id = created.json().webhook.id;

    const otherKey = `lb_${randomBytes(32).toString('base64url')}`;
    await db.insert(applications).values({
      name: 'other',
      keyHash: hashApiKey(otherKey),
      status: 'active',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/webhooks/${id}`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unknown id with 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/webhooks/00000000-0000-4000-8000-000000000000',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(404);
  });
});
