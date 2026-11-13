/**
 * Vitest setup: migrations, DB client, and deterministic test env.
 *
 * Environment overrides are required because the API validates its config
 * strictly (this is a feature). Tests inject known values so the config
 * loader never fails on an empty .env.
 *
 * PORT=9999 (not 0): the core `port()` validator rejects 0, and we never
 * call app.listen() in tests — we use app.inject() — so any valid port
 * works as a placeholder.
 */

import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll } from 'vitest';
import { createClient, type Client, type Database } from '@lumibase/database';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../../../.env') });

// Deterministic test env. Secrets padded to satisfy secret(32) validator.
process.env.NODE_ENV = 'test';
process.env.PORT = '9999';
process.env.LOG_LEVEL = 'fatal';
process.env.API_SECRET =
  process.env.API_SECRET && process.env.API_SECRET.length >= 32
    ? process.env.API_SECRET
    : 'test_admin_secret_'.padEnd(64, 'x');
process.env.WEBHOOK_SECRET = 'test_webhook_master_secret_'.padEnd(64, 'y');

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Add it to .env at the repo root, or export it.');
}

let client: Client;
export let db: Database;

beforeAll(async () => {
  client = createClient(url);
  db = client.db;
  await migrate(db, {
    migrationsFolder: resolve(here, '../../../database/migrations'),
  });
});

afterAll(async () => {
  await client.close();
});

export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE deliveries, events, transactions, payments, webhooks, applications RESTART IDENTITY CASCADE`,
  );
}
