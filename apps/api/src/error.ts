/**
 * Fastify error and not-found handlers.
 *
 * Two responsibilities:
 *
 *   1. Convert every LumiError into the wire format defined in
 *      specs/payments/errors.json:
 *        { error: { code, message, requestId } }
 *      The status code comes from the LumiError itself, which came from
 *      the spec-mapped paymentError() factory (or a core factory for
 *      cross-cutting codes).
 *
 *   2. Convert everything else into a generic 500 with no details. The
 *      full error (including stack) is logged with the request ID, so
 *      operators can correlate a client-visible requestId to a log line.
 *      Stack traces NEVER go to clients — spec section 15: "Do not
 *      expose stack traces in production responses."
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isLumiError } from '@lumibase/core';

export function setErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, request: FastifyRequest, reply: FastifyReply) => {
    if (isLumiError(err)) {
      return reply.status(err.statusCode).send({ error: err.toBody(request.id) });
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
