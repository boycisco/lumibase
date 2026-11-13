import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const here = dirname(fileURLToPath(import.meta.url));

// Load the root .env regardless of which cwd drizzle-kit is invoked from.
config({ path: resolve(here, "../.env") });

// Drizzle-kit uses esbuild + CJS internally. The `.js` extensions in our
// barrel file (schema/index.ts) don't resolve in that CJS pipeline because
// there is no compiled application.js. Point drizzle-kit directly at the
// concrete schema files instead. The barrel remains for our own tsc build,
// where .js -> .ts mapping works.
//
// On Windows, path.resolve() produces backslashes, and backslashes are
// glob escapes — so convert to forward slashes.
const toPosix = (p: string) => p.replace(/\\/g, "/");

export default defineConfig({
  schema: [toPosix(resolve(here, "schema/application.ts"))],
  out: toPosix(resolve(here, "migrations")),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});