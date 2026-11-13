/**
 * Payment endpoints.
 *
 * Routes:
 *   POST   /api/v1/payments
 *   GET    /api/v1/payments
 *   GET    /api/v1/payments/:id
 *   GET    /api/v1/payments/:id/status
 *   POST   /api/v1/payments/:id/confirm
 *   POST   /api/v1/payments/:id/cancel
 *
 * Every handler requires application auth. The wire <-> internal conversion
 * is centralized in this file — a single boundary for the whole API.
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { deserializeAmount } from '@lumibase/core';
import type { Database } from '@lumibase/database';
import {
  cancelPayment,
  confirmPayment,
  createPayment,
  getPayment,
  listPayments,
  toWirePayment,
  type PaymentStatus,
  type ResolvedConfig,
} from '@lumibase/payments';
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

const confirmBody = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, {
    message: 'transactionHash must be 0x followed by 64 hex characters.',
  }),
});

const listQuery = z.object({
  status: z
    .enum([
      'pending',
      'processing',
      'confirmed',
      'expired',
      'failed',
      'cancelled',
      'underpaid',
      'overpaid',
    ])
    .optional(),
  reference: z.string().optional(),
  chainId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
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

  app.get('/api/v1/payments', async (request, reply) => {
    await requireAppAuth(db, request, reply);

    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters.',
          requestId: request.id,
        },
      });
    }
    const query = parsed.data;

    const payments_ = await listPayments(payments, {
      applicationId: request.applicationId!,
      ...(query.status !== undefined ? { status: query.status as PaymentStatus } : {}),
      ...(query.reference !== undefined ? { reference: query.reference } : {}),
      ...(query.chainId !== undefined ? { chainId: query.chainId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });

    return reply.status(200).send({
      payments: payments_.map(toWirePayment),
    });
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
    return reply.status(200).send({
      id: payment.id,
      status: payment.status,
      updatedAt: payment.updatedAt.toISOString(),
    });
  });

  app.post<{ Params: Params }>('/api/v1/payments/:id/confirm', async (request, reply) => {
    await requireAppAuth(db, request, reply);

    const parsed = confirmBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'transactionHash must be 0x followed by 64 hex characters.',
          requestId: request.id,
        },
      });
    }

    const result = await confirmPayment(payments, {
      paymentId: request.params.id,
      applicationId: request.applicationId!,
      transactionHash: parsed.data.transactionHash as `0x${string}`,
    });

    return reply.status(200).send({
      payment: toWirePayment(result.payment),
      error: result.error,
    });
  });

  app.post<{ Params: Params }>('/api/v1/payments/:id/cancel', async (request, reply) => {
    await requireAppAuth(db, request, reply);

    const payment = await cancelPayment(payments, {
      paymentId: request.params.id,
      applicationId: request.applicationId!,
    });

    return reply.status(200).send(toWirePayment(payment));
  });
}
