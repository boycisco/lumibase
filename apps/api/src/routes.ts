/**
 * Route registry.
 *
 * All routes are registered here so `app.ts` stays focused on app-level
 * concerns (logger, error handler, middleware, plugins).
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from '@lumibase/database';
import type { NetworkConfig } from '@lumibase/network';
import type { ResolvedConfig as PaymentsConfig } from '@lumibase/payments';
import { registerApplication } from './application.ts';
import type { ApiConfig } from './config.ts';
import { registerHealth } from './health.ts';
import { registerPayments } from './payments.ts';

export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  _chains: NetworkConfig,
  payments: PaymentsConfig,
): void {
  registerHealth(app, db);
  registerApplication(app, db, config);
  registerPayments(app, payments, db);
}
