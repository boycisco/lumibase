import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Tests truncate tables in afterEach, so running files in parallel would
    // cause races. Serial execution is correct here.
    fileParallelism: false,
  },
});
