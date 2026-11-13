import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // read.test.ts and log.test.ts both send transactions to the same
    // anvil instance. Running them in parallel means their transactions
    // interleave, and any assertion about block numbers or tx ordering
    // can see the other file's writes. Serial execution removes that
    // class of flake at the cost of ~1 second of test time.
    fileParallelism: false,
  },
});
