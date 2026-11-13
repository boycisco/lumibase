/**
 * Authentication middleware.
 *
 * Two separate schemes, two separate trust levels:
 *
 *   requireAppAuth  reads `Authorization: Bearer <key>`, hashes the key
 *                   with SHA-256, and looks it up in the applications
 *                   table (WHERE status = 'active'). On success, sets
 *                   request.applicationId. Used by every /api/v1/payments
 *                   endpoint.
 *
 *   requireAdminAuth reads `Authorization: Admin <API_SECRET>` and
 *                   compares in constant time against the config's
 *                   adminSecret. Used only by POST /api/v1/applications.
 *
 * Why SHA-256 and not bcrypt/argon2: API keys are 256 bits of cryptographic
 * randomness, not user-chosen passwords. Brute force is already infeasible;
 * a slow hash only makes every request slower. This is the same reasoning
 * GitHub, Stripe, and most API key systems use.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { unauthorizedError } from '@lumibase/core';
import { applications, type Database } from '@lumibase/database';
import type { ApiConfig } from './config.ts';

declare module 'fastify' {
  interface FastifyRequest {
    applicationId?: string;
  }
}

/** Deterministic SHA-256 hex digest of an API key. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Require `Authorization: Bearer <apiKey>`. Sets request.applicationId.
 * Throws UNAUTHORIZED if missing, malformed, invalid, or revoked.
 */
export async function requireAppAuth(
  db: Database,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw unauthorizedError('Missing or invalid Authorization header.');
  }
  const key = header.slice('Bearer '.length).trim();
  if (key.length === 0) {
    throw unauthorizedError('Missing API key.');
  }

  const hash = hashApiKey(key);
  const [row] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.keyHash, hash), eq(applications.status, 'active')))
    .limit(1);

  if (!row) {
    throw unauthorizedError('Invalid API key.');
  }
  request.applicationId = row.id;
}

/**
 * Require `Authorization: Admin <adminSecret>`. Constant-time comparison.
 */
export async function requireAdminAuth(
  config: ApiConfig,
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Admin ')) {
    throw unauthorizedError('Missing or invalid admin Authorization header.');
  }
  const provided = Buffer.from(header.slice('Admin '.length).trim(), 'utf8');
  const expected = Buffer.from(config.adminSecret, 'utf8');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw unauthorizedError('Invalid admin key.');
  }
}
