import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const here = dirname(fileURLToPath(import.meta.url));

// Load the root .env regardless of which cwd drizzle-kit is invoked from.
config({ path: resolve(here, '../.env') });

// Schema files use absolute paths (backslash-to-forward-slash converted)
// because drizzle-kit treats them as globs, and Windows backslashes escape.
// The `out` path MUST be relative: drizzle-kit internally does
// path.join(process.cwd(), out) which produces garbage when `out` is
// absolute on Windows. Our scripts run via `pnpm --filter @lumibase/database`
// so process.cwd() is always `database/`; "./migrations" resolves correctly.
const toPosix = (p: string) => p.replace(/\\/g, '/');
const schema = (file: string) => toPosix(resolve(here, `schema/${file}`));

export default defineConfig({
  schema: [
    schema('application.ts'),
    schema('payment.ts'),
    schema('transaction.ts'),
    schema('event.ts'),
    schema('webhook.ts'),
    schema('delivery.ts'),
  ],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
