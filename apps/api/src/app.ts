/**
 * Fastify app factory.
 *
 * Every dependency is injected — config, db, chains. Tests build apps with
 * test-only versions of each; production (`server.ts`) builds one with real
 * ones. This makes every route testable without touching global state.
 *
 * Logger: configured via `logger: {...}` (pino options), NOT a custom
 * instance. Fastify creates the pino instance internally and the app's
 * `FastifyInstance` type is the default one — meaning our route-registration
 * helpers can accept `FastifyInstance` with no generic gymnastics. In tests
 * `config.logLevel = 'fatal'` suppresses all output; in dev
 * `pino-pretty` renders colored, timestamped lines.
 *
 * Deliberate choices:
 *   - genReqId generates a UUID (default Fastify is a counter, which
 *     collides across restarts and is guessable)
 *   - onRequest hook echoes the request ID as a response header
 *     (X-Request-Id) so clients can correlate errors to logs
 *   - helmet adds security headers (CSP, X-Frame-Options, etc.)
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import type { Database } from '@lumibase/database';
import type { NetworkConfig } from '@lumibase/network';
import type { ApiConfig } from './config.ts';
import { setErrorHandler } from './error.ts';
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

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  setErrorHandler(app);
  registerRoutes(app, deps.db, deps.config, deps.chains);

  return app;
}
