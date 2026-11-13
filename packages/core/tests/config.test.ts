import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { httpUrl, loadEnv, nodeEnv, port, secret, url } from '../src/config.js';
import { LumiError } from '../src/error.js';

describe('port', () => {
  const schema = port();

  it('accepts a numeric string', () => {
    expect(schema.parse('3000')).toBe(3000);
    expect(schema.parse('1')).toBe(1);
    expect(schema.parse('65535')).toBe(65535);
  });

  it('rejects 0, values above 65535, and non-integers', () => {
    expect(() => schema.parse('0')).toThrow();
    expect(() => schema.parse('65536')).toThrow();
    expect(() => schema.parse('3000.5')).toThrow();
  });

  it('rejects non-numeric strings and empty string', () => {
    expect(() => schema.parse('abc')).toThrow();
    expect(() => schema.parse('')).toThrow();
  });
});

describe('httpUrl', () => {
  const schema = httpUrl();

  it('accepts https and http', () => {
    expect(schema.parse('https://sepolia.base.org')).toBe('https://sepolia.base.org');
    expect(schema.parse('http://localhost:8545')).toBe('http://localhost:8545');
  });

  it('rejects non-http schemes', () => {
    expect(() => schema.parse('ws://example.com')).toThrow();
    expect(() => schema.parse('ftp://example.com')).toThrow();
    expect(() => schema.parse('postgresql://db')).toThrow();
  });

  it('rejects non-URL strings', () => {
    expect(() => schema.parse('not a url')).toThrow();
    expect(() => schema.parse('')).toThrow();
  });
});

describe('url', () => {
  const schema = url();

  it('accepts http, https, postgresql', () => {
    expect(schema.parse('https://example.com')).toBe('https://example.com');
    expect(schema.parse('postgresql://user:pass@host:5432/db')).toBe(
      'postgresql://user:pass@host:5432/db',
    );
  });

  it('rejects non-URL strings', () => {
    expect(() => schema.parse('not a url')).toThrow();
    expect(() => schema.parse('')).toThrow();
  });
});

describe('secret', () => {
  it('accepts strings meeting the minimum length', () => {
    const schema = secret(32);
    expect(schema.parse('a'.repeat(32))).toBe('a'.repeat(32));
    expect(schema.parse('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('rejects short strings', () => {
    const schema = secret(32);
    expect(() => schema.parse('a'.repeat(31))).toThrow();
    expect(() => schema.parse('')).toThrow();
  });

  it('defaults minimum length to 32 when not specified', () => {
    const schema = secret();
    expect(() => schema.parse('a'.repeat(31))).toThrow();
    expect(schema.parse('a'.repeat(32))).toBe('a'.repeat(32));
  });
});

describe('nodeEnv', () => {
  it('defaults to development when absent', () => {
    const schema = z.object({ NODE_ENV: nodeEnv() });
    const out = schema.parse({});
    expect(out.NODE_ENV).toBe('development');
  });

  it('accepts allowed values', () => {
    const schema = z.object({ NODE_ENV: nodeEnv() });
    expect(schema.parse({ NODE_ENV: 'production' }).NODE_ENV).toBe('production');
    expect(schema.parse({ NODE_ENV: 'test' }).NODE_ENV).toBe('test');
  });

  it('rejects arbitrary values (typos are dangerous)', () => {
    const schema = z.object({ NODE_ENV: nodeEnv() });
    expect(() => schema.parse({ NODE_ENV: 'staging' })).toThrow();
    expect(() => schema.parse({ NODE_ENV: 'prod' })).toThrow();
  });
});

describe('loadEnv', () => {
  const schema = z.object({
    PORT: port(),
    RPC_URL: httpUrl(),
    DATABASE_URL: url(),
    API_SECRET: secret(32),
    NODE_ENV: nodeEnv(),
  });

  it('returns parsed data for a valid environment', () => {
    const parsed = loadEnv(schema, {
      PORT: '3000',
      RPC_URL: 'https://sepolia.base.org',
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      API_SECRET: 'a'.repeat(64),
      NODE_ENV: 'production',
    });
    expect(parsed.PORT).toBe(3000);
    expect(parsed.NODE_ENV).toBe('production');
  });

  it('throws LumiError with CONFIG_ERROR on invalid input', () => {
    try {
      loadEnv(schema, { PORT: '0' });
      throw new Error('expected loadEnv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LumiError);
      expect((err as LumiError).code).toBe('CONFIG_ERROR');
    }
  });

  it('does not leak invalid values in error details', () => {
    try {
      loadEnv(schema, {
        PORT: '3000',
        RPC_URL: 'not-a-url',
        DATABASE_URL: 'postgresql://user:pass@host:5432/db',
        API_SECRET: 'short', // too short — must not appear in details
        NODE_ENV: 'development',
      });
      throw new Error('expected loadEnv to throw');
    } catch (err) {
      const message = JSON.stringify((err as LumiError).details);
      expect(message).not.toContain('short');
      expect(message).not.toContain('not-a-url');
      // But it must say WHICH fields failed.
      expect(message).toContain('API_SECRET');
      expect(message).toContain('RPC_URL');
    }
  });

  it('toBody() further strips details from the wire error', () => {
    try {
      loadEnv(schema, { PORT: '0' });
      throw new Error('expected loadEnv to throw');
    } catch (err) {
      const body = (err as LumiError).toBody();
      expect(body).toEqual({
        code: 'CONFIG_ERROR',
        message: 'Configuration is invalid.',
      });
      expect(body).not.toHaveProperty('details');
    }
  });
});
