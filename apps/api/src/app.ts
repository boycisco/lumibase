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
 * helpers can accept `FastifyInstance` with no generic gymnastics.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import type { Database } from '@lumibase/database';
import type { NetworkConfig } from '@lumibase/network';
import { resolveConfig as resolvePaymentsConfig } from '@lumibase/payments';
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

  // Build the payments service config once. Every request reuses this.
  const payments = resolvePaymentsConfig({ db: deps.db, chains: deps.chains });

  registerRoutes(app, deps.db, deps.config, deps.chains, payments);

  return app;
}
