import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LumiError } from '@lumibase/core';
import { applications } from '@lumibase/database';
import { hashApiKey, loadApiConfig, requireAdminAuth, requireAppAuth } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

afterEach(async () => {
  await truncateAll();
});

function fakeRequest(headers: Record<string, string>): FastifyRequest {
  return { headers, id: 'test-req' } as unknown as FastifyRequest;
}
const fakeReply = {} as FastifyReply;

async function seedApp(
  status: 'active' | 'revoked' = 'active',
): Promise<{ id: string; key: string }> {
  const key = `lb_${randomBytes(32).toString('base64url')}`;
  const keyHash = hashApiKey(key);
  const [row] = await db
    .insert(applications)
    .values({ name: 'test-app', keyHash, status })
    .returning({ id: applications.id });
  if (!row) throw new Error('Failed to insert application');
  return { id: row.id, key };
}

describe('hashApiKey', () => {
  it('returns a deterministic 64-char hex digest', () => {
    const h1 = hashApiKey('hello');
    const h2 = hashApiKey('hello');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different digests for different inputs', () => {
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });
});

describe('requireAppAuth', () => {
  it('throws UNAUTHORIZED when header is missing', async () => {
    const req = fakeRequest({});
    await expect(requireAppAuth(db, req, fakeReply)).rejects.toBeInstanceOf(LumiError);
  });

  it('throws UNAUTHORIZED when header is not Bearer', async () => {
    const req = fakeRequest({ authorization: 'Basic abc' });
    await expect(requireAppAuth(db, req, fakeReply)).rejects.toBeInstanceOf(LumiError);
  });

  it('throws UNAUTHORIZED when key does not exist', async () => {
    const req = fakeRequest({ authorization: 'Bearer nonexistent-key' });
    await expect(requireAppAuth(db, req, fakeReply)).rejects.toBeInstanceOf(LumiError);
  });

  it('throws UNAUTHORIZED when application is revoked', async () => {
    const { key } = await seedApp('revoked');
    const req = fakeRequest({ authorization: `Bearer ${key}` });
    await expect(requireAppAuth(db, req, fakeReply)).rejects.toBeInstanceOf(LumiError);
  });

  it('sets request.applicationId on success', async () => {
    const { id, key } = await seedApp('active');
    const req = fakeRequest({ authorization: `Bearer ${key}` });
    await requireAppAuth(db, req, fakeReply);
    expect(req.applicationId).toBe(id);
  });
});

describe('requireAdminAuth', () => {
  it('throws UNAUTHORIZED when header is missing', async () => {
    const config = loadApiConfig(process.env);
    const req = fakeRequest({});
    await expect(requireAdminAuth(config, req, fakeReply)).rejects.toBeInstanceOf(LumiError);
  });

  it('throws UNAUTHORIZED when prefix is not Admin', async () => {
    const config = loadApiConfig(process.env);
    const req = fakeRequest({ authorization: 'Bearer whatever' });
    await expect(requireAdminAuth(config, req, fakeReply)).rejects.toBeInstanceOf(LumiError);
  });

  it('throws UNAUTHORIZED when key does not match', async () => {
    const config = loadApiConfig(process.env);
    const req = fakeRequest({ authorization: 'Admin wrong-key' });
    await expect(requireAdminAuth(config, req, fakeReply)).rejects.toBeInstanceOf(LumiError);
  });

  it('passes when key matches', async () => {
    const config = loadApiConfig(process.env);
    const req = fakeRequest({ authorization: `Admin ${config.adminSecret}` });
    await expect(requireAdminAuth(config, req, fakeReply)).resolves.toBeUndefined();
  });
});
