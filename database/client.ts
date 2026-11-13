/**
 * Database client factory.
 *
 * One client per process is the normal pattern; callers are responsible for
 * lifecycle. The factory pattern (rather than a module-level singleton) keeps
 * tests able to spin up isolated clients against a test database.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export function createClient(url: string) {
  if (!url) {
    throw new Error("Database URL is required.");
  }
  const pool = new Pool({ connectionString: url });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createClient>;