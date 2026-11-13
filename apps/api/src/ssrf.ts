/**
 * SSRF (server-side request forgery) protection for webhook endpoints.
 *
 * We validate, at registration time:
 *   - scheme is http: or https:
 *   - hostname is not an IP literal in a private / loopback / link-local /
 *     multicast / metadata range
 *   - hostname resolves to at least one IP
 *   - every resolved IP is public
 *
 * DNS rebinding is NOT fully prevented here — an attacker could register a
 * domain that resolves to a public IP now and a private IP later. Batch 3
 * (delivery) re-validates at send time, closing that window.
 *
 * The resolver is injectable for tests. Real callers use node:dns.
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { LumiError } from '@lumibase/core';

const MAX_URL_LENGTH = 2048;

type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true });
  return results.map((r) => r.address);
};

export async function validateWebhookEndpoint(
  rawUrl: string,
  resolver: Resolver = defaultResolver,
): Promise<URL> {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw invalid('Webhook endpoint URL must be a non-empty string.');
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw invalid(`Webhook endpoint URL is too long (max ${MAX_URL_LENGTH}).`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalid('Webhook endpoint URL is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('Webhook endpoint must use http:// or https://.');
  }

  const hostname = stripBrackets(url.hostname);
  if (!hostname) {
    throw invalid('Webhook endpoint URL is missing a hostname.');
  }

  if (isIP(hostname) !== 0) {
    if (isNonPublicIp(hostname)) {
      throw invalid(
        'Webhook endpoint address is not permitted (private, loopback, link-local, or reserved).',
      );
    }
    return url;
  }

  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw invalid('Webhook endpoint hostname could not be resolved.');
  }
  if (addresses.length === 0) {
    throw invalid('Webhook endpoint hostname resolved to no addresses.');
  }
  for (const addr of addresses) {
    if (isNonPublicIp(addr)) {
      throw invalid(`Webhook endpoint hostname resolves to a non-public address (${addr}).`);
    }
  }
  return url;
}

function invalid(message: string): LumiError {
  return new LumiError('WEBHOOK_INVALID_ENDPOINT', message, {
    statusCode: 422,
  });
}

function stripBrackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }
  return host;
}

export function isNonPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isNonPublicV4(ip);
  if (version === 6) return isNonPublicV6(ip);
  return true;
}

function isNonPublicV4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (a >= 224 && a <= 239) return true;
  if (a >= 240) return true;
  return false;
}

function isNonPublicV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower === '::') return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    if (isIP(v4) === 4) return isNonPublicV4(v4);
    return true;
  }
  if (/^f[cd]/.test(lower)) return true;
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true;
  }
  if (lower.startsWith('ff')) return true;
  if (lower.startsWith('2001:db8:')) return true;
  return false;
}
