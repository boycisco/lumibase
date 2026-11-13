import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_ERROR_CODES,
  PAYMENT_FAILED_REASONS,
  PAYMENT_STATUSES,
  TERMINAL_STATUSES,
} from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

function loadSpec<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(here, relativePath), 'utf8')) as T;
}

interface Lifecycle {
  statuses: Record<string, { terminal: boolean; transitionsTo: string[] }>;
}

interface Errors {
  codes: Record<string, { httpStatus: number }>;
  reasons: { values: string[] };
}

const lifecycle = loadSpec<Lifecycle>('../../../specs/payments/lifecycle.json');
const errors = loadSpec<Errors>('../../../specs/payments/errors.json');

describe('PAYMENT_STATUSES matches specs/payments/lifecycle.json', () => {
  it('status set is exactly equal (no missing, no extra)', () => {
    const specStatuses = Object.keys(lifecycle.statuses).sort();
    const ourStatuses = [...PAYMENT_STATUSES].sort();
    expect(ourStatuses).toEqual(specStatuses);
  });

  it('TERMINAL_STATUSES matches spec terminal:true statuses', () => {
    const specTerminal = Object.entries(lifecycle.statuses)
      .filter(([, s]) => s.terminal)
      .map(([name]) => name)
      .sort();
    const ourTerminal = [...TERMINAL_STATUSES].sort();
    expect(ourTerminal).toEqual(specTerminal);
  });
});

describe('PAYMENT_ERROR_CODES matches specs/payments/errors.json', () => {
  it('error code set is exactly equal (no missing, no extra)', () => {
    const specCodes = Object.keys(errors.codes).sort();
    const ourCodes = [...PAYMENT_ERROR_CODES].sort();
    expect(ourCodes).toEqual(specCodes);
  });
});

describe('PAYMENT_FAILED_REASONS matches specs/payments/errors.json', () => {
  it('reason set is exactly equal (no missing, no extra)', () => {
    const specReasons = [...errors.reasons.values].sort();
    const ourReasons = [...PAYMENT_FAILED_REASONS].sort();
    expect(ourReasons).toEqual(specReasons);
  });
});
