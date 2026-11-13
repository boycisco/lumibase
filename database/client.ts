/**
 * Database client factory.
 *
 * Returns both the Drizzle instance (for queries) and a close function (to
 * release the underlying connection pool). Callers MUST call close() when
 * done; for long-running processes that happens at shutdown. Tests call it
 * in afterAll so each test file starts with a fresh pool.
 *
 * The factory pattern (rather than a module-level singleton) keeps tests
 * able to spin up isolated clients against a test database without leaking
 * connections between test files.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.ts';

export function createClient(url: string) {
  if (!url) {
    throw new Error('Database URL is required.');
  }
  const pool = new Pool({ connectionString: url });
  return {
    db: drizzle(pool, { schema }),
    close: (): Promise<void> => pool.end(),
  };
}

export type Client = ReturnType<typeof createClient>;
export type Database = Client['db'];
