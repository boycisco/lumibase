import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LumiError } from '@lumibase/core';
import { paymentError } from '../src/error.ts';
import { PAYMENT_ERROR_CODES } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

interface Errors {
  codes: Record<string, { httpStatus: number }>;
}

const errors = JSON.parse(
  readFileSync(resolve(here, '../../../specs/payments/errors.json'), 'utf8'),
) as Errors;

describe('paymentError', () => {
  it('returns a LumiError instance', () => {
    const err = paymentError('PAYMENT_NOT_FOUND', 'missing');
    expect(err).toBeInstanceOf(LumiError);
    expect(err.code).toBe('PAYMENT_NOT_FOUND');
    expect(err.message).toBe('missing');
  });

  it('attaches details when provided', () => {
    const err = paymentError('PAYMENT_NOT_FOUND', 'missing', { id: 'abc' });
    expect(err.details).toEqual({ id: 'abc' });
  });

  it('toBody() strips details from the wire format', () => {
    const err = paymentError('PAYMENT_NOT_FOUND', 'missing', { secret: 'x' });
    const body = err.toBody('req-1');
    expect(body).toEqual({
      code: 'PAYMENT_NOT_FOUND',
      message: 'missing',
      requestId: 'req-1',
    });
    expect(body).not.toHaveProperty('details');
  });

  it.each(PAYMENT_ERROR_CODES)('%s uses the HTTP status declared in the spec', (code) => {
    const err = paymentError(code, 'msg');
    const specStatus = errors.codes[code]?.httpStatus;
    expect(specStatus, `spec is missing httpStatus for ${code}`).toBeDefined();
    expect(err.statusCode).toBe(specStatus);
  });
});
