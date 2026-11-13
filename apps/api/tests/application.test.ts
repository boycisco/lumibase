import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadNetworkConfig } from '@lumibase/network';
import { applications } from '@lumibase/database';
import { buildApp, hashApiKey, loadApiConfig } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

afterEach(async () => {
  await truncateAll();
});

async function buildTestApp() {
  const config = loadApiConfig(process.env);
  const chains = loadNetworkConfig(process.env);
  return buildApp({ config, db, chains, prettyLogs: false });
}

function adminHeader(): string {
  const config = loadApiConfig(process.env);
  return `Admin ${config.adminSecret}`;
}

describe('POST /api/v1/applications', () => {
  it('creates an application and returns plaintext key once', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { authorization: adminHeader() },
      payload: { name: 'my-app' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.application.name).toBe('my-app');
    expect(body.application.status).toBe('active');
    expect(typeof body.application.id).toBe('string');
    expect(typeof body.key).toBe('string');
    expect(body.key).toMatch(/^lb_[A-Za-z0-9_-]+$/);
    await app.close();
  });

  it('stores only the hash, not the plaintext key', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { authorization: adminHeader() },
      payload: { name: 'my-app' },
    });
    const body = res.json();
    await app.close();

    const [row] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, body.application.id));
    expect(row).toBeDefined();
    expect(row!.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.keyHash).not.toBe(body.key);
    expect(JSON.stringify(row)).not.toContain(body.key);
    expect(row!.keyHash).toBe(hashApiKey(body.key));
  });

  it('rejects without admin auth (401)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      payload: { name: 'my-app' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects wrong admin key (401)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { authorization: 'Admin wrong' },
      payload: { name: 'my-app' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects missing name (400)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { authorization: adminHeader() },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('rejects empty name (400)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { authorization: adminHeader() },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects name over 100 chars (400)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { authorization: adminHeader() },
      payload: { name: 'x'.repeat(101) },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
