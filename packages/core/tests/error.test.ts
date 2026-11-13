import { describe, expect, it } from 'vitest';
import {
  HTTP_STATUS,
  LumiError,
  conflictError,
  internalError,
  isLumiError,
  notFoundError,
  unauthorizedError,
  validationError,
} from '../src/error.js';

describe('LumiError', () => {
  it('is an Error subclass with code and statusCode', () => {
    const err = new LumiError('VALIDATION_ERROR', 'bad input');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LumiError');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('bad input');
    expect(err.statusCode).toBe(HTTP_STATUS.INTERNAL);
  });

  it('accepts explicit statusCode and details', () => {
    const err = new LumiError('NOT_FOUND', 'missing', {
      statusCode: 404,
      details: { id: 'abc' },
    });
    expect(err.statusCode).toBe(404);
    expect(err.details).toEqual({ id: 'abc' });
  });

  it('serializes to the wire format without leaking details', () => {
    const err = new LumiError('VALIDATION_ERROR', 'bad', {
      statusCode: 400,
      details: { secret: 'should not leak' },
    });
    expect(err.toBody('req-1')).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'bad',
      requestId: 'req-1',
    });
    expect(err.toBody('req-1')).not.toHaveProperty('details');
  });

  it('omits requestId when not provided', () => {
    const err = new LumiError('INTERNAL_ERROR', 'boom');
    const body = err.toBody();
    expect(body).toEqual({ code: 'INTERNAL_ERROR', message: 'boom' });
    expect(body).not.toHaveProperty('requestId');
  });

  it('preserves cause for debugging', () => {
    const cause = new Error('original');
    const err = new LumiError('INTERNAL_ERROR', 'wrapped', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('isLumiError', () => {
  it('returns true for LumiError', () => {
    expect(isLumiError(new LumiError('INTERNAL_ERROR', 'x'))).toBe(true);
  });

  it('returns false for plain Error and non-errors', () => {
    expect(isLumiError(new Error('plain'))).toBe(false);
    expect(isLumiError('not an error')).toBe(false);
    expect(isLumiError(null)).toBe(false);
    expect(isLumiError(undefined)).toBe(false);
  });
});

describe('error factories', () => {
  it('validationError produces 400', () => {
    const err = validationError('bad');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
  });

  it('notFoundError produces 404', () => {
    const err = notFoundError('missing');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('unauthorizedError produces 401', () => {
    const err = unauthorizedError('nope');
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
  });

  it('conflictError produces 409', () => {
    const err = conflictError('dup');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
  });

  it('internalError produces 500', () => {
    const err = internalError('oops');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.statusCode).toBe(500);
  });
});
