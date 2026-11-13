import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  formatSignatureHeader,
  generateSecret,
  signBody,
  verifySignature,
} from '../src/crypto.ts';

const MASTER = 'test_master_secret_'.padEnd(64, 'm');

describe('generateSecret', () => {
  it('returns a whsec_-prefixed string', () => {
    expect(generateSecret()).toMatch(/^whsec_[A-Za-z0-9_-]+$/);
  });

  it('returns a fresh value each call', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext secret', () => {
    const secret = generateSecret();
    const ciphertext = encryptSecret(secret, MASTER);
    expect(ciphertext).not.toBe(secret);
    expect(ciphertext).not.toContain('whsec_');
    expect(decryptSecret(ciphertext, MASTER)).toBe(secret);
  });

  it('produces a different ciphertext each time (fresh IV)', () => {
    const secret = 'same-secret';
    const c1 = encryptSecret(secret, MASTER);
    const c2 = encryptSecret(secret, MASTER);
    expect(c1).not.toBe(c2);
    expect(decryptSecret(c1, MASTER)).toBe(secret);
    expect(decryptSecret(c2, MASTER)).toBe(secret);
  });

  it('fails to decrypt with a wrong master secret', () => {
    const ciphertext = encryptSecret('a-secret', MASTER);
    expect(() => decryptSecret(ciphertext, 'wrong_master_secret_'.padEnd(64, 'w'))).toThrow();
  });

  it('fails to decrypt a truncated ciphertext', () => {
    expect(() => decryptSecret('AAAA', MASTER)).toThrow(/too short/);
  });

  it('fails on tampered ciphertext (GCM auth)', () => {
    const ciphertext = encryptSecret('a-secret', MASTER);
    const buf = Buffer.from(ciphertext, 'base64');
    const last = buf.length - 1;
    const lastByte = buf[last];
    if (lastByte === undefined) throw new Error('test setup error');
    buf[last] = lastByte ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptSecret(tampered, MASTER)).toThrow();
  });
});

describe('signBody / verifySignature', () => {
  const secret = 'whsec_test_secret';
  const body = '{"hello":"world"}';
  const now = Math.floor(Date.now() / 1000);

  it('produces a 64-char hex HMAC', () => {
    expect(signBody(secret, now, body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies a fresh signature', () => {
    const sig = signBody(secret, now, body);
    const header = formatSignatureHeader(now, sig);
    expect(verifySignature(secret, header, body)).toBe(true);
  });

  it('fails with the wrong secret', () => {
    const sig = signBody(secret, now, body);
    const header = formatSignatureHeader(now, sig);
    expect(verifySignature('other', header, body)).toBe(false);
  });

  it('fails with a different body', () => {
    const sig = signBody(secret, now, body);
    const header = formatSignatureHeader(now, sig);
    expect(verifySignature(secret, header, body + 'x')).toBe(false);
  });

  it('fails when the timestamp is too old (replay protection)', () => {
    const oldTs = now - 400;
    const sig = signBody(secret, oldTs, body);
    const header = formatSignatureHeader(oldTs, sig);
    expect(verifySignature(secret, header, body)).toBe(false);
  });

  it('accepts timestamps within tolerance', () => {
    const nearTs = now - 60;
    const sig = signBody(secret, nearTs, body);
    const header = formatSignatureHeader(nearTs, sig);
    expect(verifySignature(secret, header, body)).toBe(true);
  });

  it('rejects a malformed header', () => {
    expect(verifySignature(secret, 'garbage', body)).toBe(false);
    expect(verifySignature(secret, 't=abc,v1=def', body)).toBe(false);
    expect(verifySignature(secret, 't=123', body)).toBe(false);
  });
});
