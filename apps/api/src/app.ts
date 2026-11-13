/**
 * Fastify app factory.
 *
 * Every dependency is injected — config, db, chains. Tests build apps with
 * test-only versions of each; production (`server.ts`) builds one with real
 * ones.
 *
 * Plugins registered here:
 *   - helmet: security headers
 *   - rate-limit: per-app request throttling (configurable via env)
 *   - OpenAPI: GET /openapi.json + GET /docs (Swagger UI)
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Database } from '@lumibase/database';
import type { NetworkConfig } from '@lumibase/network';
import { resolveConfig as resolvePaymentsConfig } from '@lumibase/payments';
import type { ApiConfig } from './config.ts';
import { setErrorHandler } from './error.ts';
import { registerOpenApi } from './openapi.ts';
import { registerRoutes } from './routes.ts';

export interface AppDeps {
  readonly config: ApiConfig;
  readonly db: Database;
  readonly chains: NetworkConfig;
  readonly prettyLogs?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const pretty = deps.prettyLogs ?? deps.config.nodeEnv === 'development';

  const app = Fastify({
    logger: pretty
      ? {
          level: deps.config.logLevel,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        }
      : { level: deps.config.logLevel },
    genReqId: () => randomUUID(),
  });

  await app.register(helmet);
  await app.register(rateLimit, {
    max: deps.config.rateLimitMax,
    timeWindow: deps.config.rateLimitWindowMs,
    // Per-app rate limit: the caller's Authorization header is the bucket
    // identifier, so each application has its own counter. Falls back to
    // IP when no auth header is present.
    keyGenerator: (req) => req.headers.authorization ?? req.ip,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  setErrorHandler(app);

  await registerOpenApi(app);

  const payments = resolvePaymentsConfig({ db: deps.db, chains: deps.chains });
  registerRoutes(app, deps.db, deps.config, deps.chains, payments);

  return app;
}
