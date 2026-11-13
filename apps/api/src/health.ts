/**
 * Health and readiness endpoints.
 *
 * /health     — liveness: process is alive. No auth. Returns immediately.
 * /ready      — readiness: critical dependency (Postgres) is reachable.
 *                Returns 503 if the DB is down, so a load balancer or
 *                k8s readiness probe will stop routing traffic.
 *
 * Neither endpoint exposes configuration, secrets, versions of
 * dependencies, or infrastructure details. Spec section 13: "Do not
 * expose secrets, internal configuration, or sensitive infrastructure
 * details."
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@lumibase/database';

const VERSION = '0.1.0';

export function registerHealth(app: FastifyInstance, db: Database): void {
  app.get('/health', async () => ({
    status: 'ok',
    version: VERSION,
    uptime: Math.floor(process.uptime()),
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });
}
