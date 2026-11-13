/**
 * POST /api/v1/applications — admin-only application bootstrap.
 *
 * Generates a fresh 256-bit API key, hashes it, persists the hash, and
 * returns the plaintext key EXACTLY ONCE. This is the only time the
 * plaintext is ever visible — even the operator loses access after the
 * response is sent.
 *
 * Auth: `Authorization: Admin <API_SECRET>` (see auth.ts).
 *
 * Why a plaintext-once response: this is exactly how Stripe, GitHub,
 * OpenAI, and every well-designed API key system works. The hash in the
 * DB is one-way; the plaintext is only usable if the caller saves it
 * immediately. If it's lost, the operator must issue a new key (v0.2
 * feature) — that's a feature, not a bug.
 */

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@lumibase/database';
import { applications } from '@lumibase/database';
import { hashApiKey, requireAdminAuth } from './auth.ts';
import type { ApiConfig } from './config.ts';

const createBody = z.object({
  name: z.string().min(1).max(100),
});

export function registerApplication(app: FastifyInstance, db: Database, config: ApiConfig): void {
  app.post('/api/v1/applications', async (request, reply) => {
    await requireAdminAuth(config, request, reply);

    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body.',
          requestId: request.id,
        },
      });
    }

    // 32 bytes = 256 bits of cryptographic entropy, base64url encoded.
    const plaintextKey = `lb_${randomBytes(32).toString('base64url')}`;
    const keyHash = hashApiKey(plaintextKey);

    const [row] = await db
      .insert(applications)
      .values({
        name: parsed.data.name,
        keyHash,
        status: 'active',
      })
      .returning({
        id: applications.id,
        name: applications.name,
        status: applications.status,
        createdAt: applications.createdAt,
      });

    if (!row) {
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create application.',
          requestId: request.id,
        },
      });
    }

    return reply.status(201).send({
      application: {
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      },
      // Plaintext key returned once. Store it now; cannot be recovered.
      key: plaintextKey,
    });
  });
}
