/**
 * Webhook registration endpoints.
 *
 * Three routes, all requiring application auth:
 *   POST   /api/v1/webhooks      — create; returns plaintext secret ONCE
 *   GET    /api/v1/webhooks      — list this application's webhooks
 *   DELETE /api/v1/webhooks/:id  — delete
 *
 * The plaintext signing secret is never stored — the DB holds only an
 * AES-256-GCM ciphertext under `webhooks.secret_ciphertext`. GET and
 * DELETE never include any secret-shaped field in responses.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { LumiError, notFoundError } from '@lumibase/core';
import { type Database, webhooks } from '@lumibase/database';
import { requireAppAuth } from './auth.ts';
import type { ApiConfig } from './config.ts';
import { encryptSecret, generateSecret } from './crypto.ts';
import { validateWebhookEndpoint } from './ssrf.ts';

const createBody = z.object({
  endpoint: z.string().min(1).max(2048),
});

interface Params {
  id: string;
}

interface WireWebhook {
  readonly id: string;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toWireWebhook(row: typeof webhooks.$inferSelect): WireWebhook {
  return {
    id: row.id,
    endpoint: row.endpoint,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireMasterSecret(config: ApiConfig): string {
  if (!config.webhookSecret) {
    throw new LumiError('INTERNAL_ERROR', 'Webhook signing is not configured on this deployment.', {
      statusCode: 503,
    });
  }
  return config.webhookSecret;
}

export function registerWebhooks(app: FastifyInstance, db: Database, config: ApiConfig): void {
  app.post('/api/v1/webhooks', async (request, reply) => {
    await requireAppAuth(db, request, reply);

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

    const masterSecret = requireMasterSecret(config);
    const endpoint = await validateWebhookEndpoint(parsed.data.endpoint);

    const plaintext = generateSecret();
    const secretCiphertext = encryptSecret(plaintext, masterSecret);
    const now = new Date();
    const id = randomUUID();

    const [row] = await db
      .insert(webhooks)
      .values({
        id,
        applicationId: request.applicationId!,
        endpoint: endpoint.toString(),
        secretCiphertext,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) {
      throw new LumiError('INTERNAL_ERROR', 'Failed to create webhook.', {
        statusCode: 500,
      });
    }

    return reply.status(201).send({
      webhook: toWireWebhook(row),
      // Plaintext secret returned EXACTLY ONCE. Store it now.
      secret: plaintext,
    });
  });

  app.get('/api/v1/webhooks', async (request, reply) => {
    await requireAppAuth(db, request, reply);
    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.applicationId, request.applicationId!))
      .orderBy(desc(webhooks.createdAt));
    return reply.status(200).send({
      webhooks: rows.map(toWireWebhook),
    });
  });

  app.delete<{ Params: Params }>('/api/v1/webhooks/:id', async (request, reply) => {
    await requireAppAuth(db, request, reply);

    const [row] = await db
      .delete(webhooks)
      .where(
        and(eq(webhooks.id, request.params.id), eq(webhooks.applicationId, request.applicationId!)),
      )
      .returning({ id: webhooks.id });

    if (!row) {
      throw notFoundError(`Webhook ${request.params.id} not found.`, {
        webhookId: request.params.id,
      });
    }
    return reply.status(204).send();
  });
}
