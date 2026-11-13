/**
 * Payment endpoints.
 *
 * Three routes, all requiring application auth (`Authorization: Bearer
 * <apiKey>`). Every handler:
 *
 *   1. Runs auth middleware (which throws UNAUTHORIZED on failure).
 *   2. Validates the request body / path with Zod.
 *   3. Converts wire format -> internal (amount string -> bigint).
 *   4. Calls the payments service.
 *   5. Converts internal -> wire format for the response.
 *
 * The conversion boundary is IMPORTANT: the wire format is defined by
 * specs/schemas/payment.json (a language-independent contract), while the
 * internal Payment type is a TypeScript implementation detail. If either
 * side changes, only this file needs to change.
 *
 * Note on GET /:id/status: per spec section 13, "Do not trigger
 * unnecessary blockchain scans on every status request." This handler
 * reads the persisted status; it never calls RPC. If the caller wants
 * verification, they must POST /:id/confirm (Batch 3).
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { deserializeAmount } from '@lumibase/core';
import type { Database } from '@lumibase/database';
import { createPayment, getPayment, toWirePayment, type ResolvedConfig } from '@lumibase/payments';
import { requireAppAuth } from './auth.ts';

const createBody = z.object({
  amount: z.string().min(1),
  chainId: z.number().int().positive(),
  token: z.string().min(1),
  recipient: z.string().min(1),
  payer: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  expiresIn: z.number().int().positive(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

interface Params {
  id: string;
}

export function registerPayments(
  app: FastifyInstance,
  payments: ResolvedConfig,
  db: Database,
): void {
  app.post('/api/v1/payments', async (request, reply) => {
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
    const body = parsed.data;

    // Wire amount string -> internal bigint. deserializeAmount rejects
    // malformed input, non-canonical values, and values above uint256.
    const amount = deserializeAmount(body.amount);

    const payment = await createPayment(payments, {
      applicationId: request.applicationId!,
      chainId: body.chainId,
      token: body.token as `0x${string}`,
      amount,
      recipient: body.recipient as `0x${string}`,
      payer: body.payer ? (body.payer as `0x${string}`) : null,
      reference: body.reference ?? null,
      expiresIn: body.expiresIn,
      metadata: body.metadata ?? null,
    });

    return reply.status(201).send(toWirePayment(payment));
  });

  app.get<{ Params: Params }>('/api/v1/payments/:id', async (request, reply) => {
    await requireAppAuth(db, request, reply);
    const payment = await getPayment(payments, {
      paymentId: request.params.id,
      applicationId: request.applicationId!,
    });
    return reply.status(200).send(toWirePayment(payment));
  });

  app.get<{ Params: Params }>('/api/v1/payments/:id/status', async (request, reply) => {
    await requireAppAuth(db, request, reply);
    const payment = await getPayment(payments, {
      paymentId: request.params.id,
      applicationId: request.applicationId!,
    });
    // Lightweight status-only payload. No RPC.
    return reply.status(200).send({
      id: payment.id,
      status: payment.status,
      updatedAt: payment.updatedAt.toISOString(),
    });
  });
}
