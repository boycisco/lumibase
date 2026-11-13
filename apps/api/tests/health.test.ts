import { describe, expect, it } from 'vitest';
import { loadNetworkConfig } from '@lumibase/network';
import { buildApp, loadApiConfig } from '../src/index.ts';
import { db } from './setup.ts';

async function buildTestApp() {
  const config = loadApiConfig(process.env);
  const chains = loadNetworkConfig(process.env);
  return buildApp({ config, db, chains, prettyLogs: false });
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
    await app.close();
  });

  it('does not leak secrets or infrastructure details', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.body;
    expect(body).not.toContain('test_admin_secret');
    expect(body).not.toContain('postgres');
    expect(body).not.toContain('DATABASE_URL');
    await app.close();
  });
});

describe('GET /ready', () => {
  it('returns 200 ready when DB reachable', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
    await app.close();
  });
});
