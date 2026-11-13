/**
 * Cryptographic primitives for webhook secrets and signing.
 *
 * Two independent operations:
 *
 *   1. Encrypt/decrypt the webhook signing secret at rest.
 *      - Algorithm: AES-256-GCM (authenticated)
 *      - Key: SHA-256(WEBHOOK_SECRET) -> 32 bytes
 *      - Ciphertext layout: base64(iv[12] || tag[16] || ciphertext)
 *
 *   2. Sign outbound webhook payloads with HMAC-SHA256.
 *      - Signing key: the plaintext webhook secret
 *      - Canonical message: `${timestamp}.${body}`
 *      - Output: lowercase hex
 *      - Header: `X-LumiBase-Signature: t=<ts>,v1=<hex>`
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function generateSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function deriveKey(masterSecret: string): Buffer {
  return createHash('sha256').update(masterSecret).digest();
}

export function encryptSecret(plaintext: string, masterSecret: string): string {
  const key = deriveKey(masterSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(ciphertextB64: string, masterSecret: string): string {
  const blob = Buffer.from(ciphertextB64, 'base64');
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext is too short to be valid.');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(masterSecret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function signBody(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function formatSignatureHeader(timestamp: number, signature: string): string {
  return `t=${timestamp},v1=${signature}`;
}

interface ParsedSignature {
  readonly timestamp: number;
  readonly signature: string;
}

function parseSignatureHeader(header: string): ParsedSignature | null {
  const fields: Record<string, string> = {};
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) fields[key] = value;
  }
  if (!fields.t || !fields.v1) return null;
  const timestamp = Number(fields.t);
  if (!Number.isInteger(timestamp) || timestamp <= 0) return null;
  return { timestamp, signature: fields.v1 };
}

export function verifySignature(
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) return false;
  const expected = signBody(secret, parsed.timestamp, body);
  return timingSafeEqualHex(expected, parsed.signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
