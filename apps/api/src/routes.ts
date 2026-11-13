/**
 * Route registry.
 *
 * All routes are registered here so `app.ts` stays focused on app-level
 * concerns (logger, error handler, middleware, plugins). Payment routes
 * are added in Phase 8 Batch 2.
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from '@lumibase/database';
import type { NetworkConfig } from '@lumibase/network';
import { registerApplication } from './application.ts';
import type { ApiConfig } from './config.ts';
import { registerHealth } from './health.ts';

export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  _chains: NetworkConfig,
): void {
  registerHealth(app, db);
  registerApplication(app, db, config);
  // Payment routes added in Phase 8 Batch 2+
}
