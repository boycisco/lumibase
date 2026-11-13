import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  name: string;
  payment: unknown;
}

function loadJson<T>(relativePath: string): T {
  const absolute = resolve(here, relativePath);
  return JSON.parse(readFileSync(absolute, 'utf8')) as T;
}

const schema = loadJson<object>('../../specs/schemas/payment.json');
const validFixtures = loadJson<Fixture[]>('../fixtures/payment/valid.json');
const invalidFixtures = loadJson<Fixture[]>('../fixtures/payment/invalid.json');

function makeValidator(): ReturnType<typeof Ajv2020.prototype.compile> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

describe('payment schema / valid fixtures', () => {
  const validate = makeValidator();
  it.each(validFixtures)('$name passes validation', ({ payment }) => {
    const ok = validate(payment);
    if (!ok) {
      throw new Error(`Expected valid, got errors: ${JSON.stringify(validate.errors, null, 2)}`);
    }
    expect(ok).toBe(true);
  });
});

describe('payment schema / invalid fixtures', () => {
  const validate = makeValidator();
  it.each(invalidFixtures)('$name fails validation', ({ payment }) => {
    const ok = validate(payment);
    expect(ok).toBe(false);
    expect(validate.errors).not.toBeNull();
  });
});

describe('payment fixture integrity', () => {
  it('every fixture has a unique name', () => {
    const all = [...validFixtures, ...invalidFixtures].map((f) => f.name);
    expect(new Set(all).size).toBe(all.length);
  });
});
