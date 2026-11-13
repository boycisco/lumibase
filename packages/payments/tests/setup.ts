/**
 * Shared test setup for payment service tests.
 *
 * Loads the root .env, provides a Database connection, applies pending
 * migrations (idempotent), and exposes a truncateAll() helper that tests
 * should call in afterEach.
 *
 * Migrations are applied here rather than as a separate step so the
 * payments tests are self-contained: they work against a fresh database
 * without requiring a manual `pnpm --filter @lumibase/database
 * drizzle:migrate` first.
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll } from 'vitest';
import { createClient, type Client, type Database } from '@lumibase/database';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Add it to .env at the repo root, or export it.');
}

let client: Client;
export let db: Database;

beforeAll(async () => {
  client = createClient(url);
  db = client.db;
  // Ensure schema exists. migrate() applies only pending migrations and is
  // a no-op when already up to date. Requires DATABASE_URL and a reachable
  // Postgres instance (docker compose up -d).
  await migrate(db, {
    migrationsFolder: resolve(here, '../../../database/migrations'),
  });
});

afterAll(async () => {
  await client.close();
});

/**
 * Remove all rows from every application table. Order is irrelevant because
 * we TRUNCATE ... CASCADE.
 */
export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE deliveries, events, transactions, payments, webhooks, applications RESTART IDENTITY CASCADE`,
  );
}
