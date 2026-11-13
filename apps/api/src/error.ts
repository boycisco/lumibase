/**
 * Fastify error and not-found handlers.
 *
 * Three cases, in priority order:
 *
 *   1. LumiError — our own structured error. Serialized via toBody(),
 *      status from the error itself.
 *
 *   2. Plugin-thrown 4xx errors — Fastify plugins (rate-limit in
 *      particular) throw errors with a numeric `statusCode` in the 4xx
 *      range. We honor that status. Without this, a rate-limited request
 *      would surface as 500 instead of 429, telling the client to keep
 *      retrying. This is a real bug in any error handler that only
 *      recognizes its own error types.
 *
 *   3. Everything else — generic 500 with no details. Full error is
 *      logged with the request ID for correlation. Stack traces NEVER
 *      go to clients.
 *
 * `err` is typed `unknown` by Fastify (so plugins can throw anything),
 * so every access is guarded: `instanceof Error` for `.message`,
 * `typeof` for `.code`/`.statusCode`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isLumiError } from '@lumibase/core';

export function setErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, request: FastifyRequest, reply: FastifyReply) => {
    if (isLumiError(err)) {
      return reply.status(err.statusCode).send({ error: err.toBody(request.id) });
    }

    const errRecord = err as {
      statusCode?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const maybeStatus = errRecord.statusCode;
    if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 500) {
      const maybeCode = errRecord.code;
      const maybeMessage = errRecord.message;
      return reply.status(maybeStatus).send({
        error: {
          code: typeof maybeCode === 'string' ? maybeCode : 'ERROR',
          message: typeof maybeMessage === 'string' ? maybeMessage : 'Request rejected.',
          requestId: request.id,
        },
      });
    }

    request.log.error({ err, requestId: request.id }, 'unhandled_error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred.',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found.`,
        requestId: request.id,
      },
    });
  });
}
