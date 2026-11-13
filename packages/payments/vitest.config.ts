import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Payment tests share the Postgres instance. Running multiple test files
    // in parallel would interleave their transactions and TRUNCATE calls.
    fileParallelism: false,
  },
});
