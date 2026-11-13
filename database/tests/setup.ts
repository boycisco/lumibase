/**
 * Vitest setup file. Runs once before any test file.
 *
 * 1. Loads .env from the repo root (no-op in CI where DATABASE_URL is in env).
 * 2. Fails fast with a helpful message if Postgres is unreachable, rather
 *    than letting every test file emit the same opaque connection error.
 * 3. Applies any pending migrations so tests are self-contained — they work
 *    against a fresh database without requiring a manual `drizzle:migrate`
 *    step first. `migrate()` is idempotent: it applies only pending
 *    migrations and is a no-op when already up to date.
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';

const here = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(here, '../../.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Add it to .env at the repo root, or export it.');
}

const probe = new Pool({ connectionString: url });
try {
  await probe.query('SELECT 1');
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  throw new Error(
    `Cannot connect to Postgres at DATABASE_URL.\n` +
      `  Is the container running? Try: docker compose up -d\n` +
      `  Original error: ${detail}`,
  );
}

// Apply pending migrations against a fresh connection. Idempotent.
const migrationDb = drizzle(probe);
try {
  await migrate(migrationDb, {
    migrationsFolder: resolve(here, '../migrations'),
  });
} finally {
  await probe.end();
}
