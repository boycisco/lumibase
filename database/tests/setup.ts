/**
 * Vitest setup file. Runs once before any test file.
 *
 * 1. Loads .env from the repo root (no-op in CI where DATABASE_URL is in env).
 * 2. Fails fast with a helpful message if Postgres is unreachable, rather
 *    than letting every test file emit the same opaque connection error.
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

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
} finally {
  await probe.end();
}
