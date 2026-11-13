import { afterEach, describe, expect, it } from 'vitest';
import { loadNetworkConfig } from '@lumibase/network';
import { buildApp, loadApiConfig } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

afterEach(async () => {
  await truncateAll();
});

async function buildTestApp() {
  const config = loadApiConfig(process.env);
  const chains = loadNetworkConfig(process.env);
  return buildApp({ config, db, chains, prettyLogs: false });
}

describe('app scaffold', () => {
  it('builds and serves health', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    await app.close();
  });

  it('returns an X-Request-Id header on every response', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const requestId = res.headers['x-request-id'];
    expect(typeof requestId).toBe('string');
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await app.close();
  });

  it('returns structured 404 for unknown routes', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.requestId).toBe('string');
    await app.close();
  });

  it('LumiError thrown from a route returns the spec-shaped body', async () => {
    const app = await buildTestApp();
    // POST /api/v1/applications with wrong admin key triggers
    // unauthorizedError which is a LumiError.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { authorization: 'Admin wrong' },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.requestId).toBe('string');
    await app.close();
  });
});
