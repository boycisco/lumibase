import { describe, expect, it } from 'vitest';
import { LumiError } from '@lumibase/core';
import { isNonPublicIp, validateWebhookEndpoint } from '../src/ssrf.ts';

const publicResolver = async (): Promise<string[]> => ['93.184.216.34'];

async function expectRejected(url: string, resolver = publicResolver) {
  await expect(validateWebhookEndpoint(url, resolver)).rejects.toBeInstanceOf(LumiError);
}

describe('validateWebhookEndpoint - scheme', () => {
  it('accepts http and https', async () => {
    const u1 = await validateWebhookEndpoint('https://example.com/hook', publicResolver);
    expect(u1.protocol).toBe('https:');
    const u2 = await validateWebhookEndpoint('http://example.com/hook', publicResolver);
    expect(u2.protocol).toBe('http:');
  });

  it('rejects other schemes', async () => {
    await expectRejected('ftp://example.com/hook');
    await expectRejected('ws://example.com/hook');
    await expectRejected('file:///etc/passwd');
    await expectRejected('javascript:alert(1)');
    await expectRejected('data:text/html,<script>alert(1)</script>');
  });

  it('rejects malformed URLs', async () => {
    await expectRejected('not a url');
    await expectRejected('');
    await expectRejected('http://');
  });

  it('rejects URLs over 2048 chars', async () => {
    const huge = 'https://example.com/' + 'a'.repeat(2100);
    await expectRejected(huge);
  });
});

describe('validateWebhookEndpoint - IP literals', () => {
  it('rejects loopback IPv4', async () => {
    await expectRejected('http://127.0.0.1/hook');
    await expectRejected('http://127.1.2.3/hook');
  });

  it('rejects private IPv4', async () => {
    await expectRejected('http://10.0.0.1/hook');
    await expectRejected('http://172.16.0.1/hook');
    await expectRejected('http://172.31.0.1/hook');
    await expectRejected('http://192.168.1.1/hook');
  });

  it('rejects link-local and metadata IPs', async () => {
    await expectRejected('http://169.254.0.1/hook');
    await expectRejected('http://169.254.169.254/latest/meta-data/');
  });

  it('rejects CGNAT', async () => {
    await expectRejected('http://100.64.0.1/hook');
  });

  it('rejects IPv6 loopback', async () => {
    await expectRejected('http://[::1]/hook');
  });

  it('rejects IPv6 unique local and link-local', async () => {
    await expectRejected('http://[fc00::1]/hook');
    await expectRejected('http://[fd00::1]/hook');
    await expectRejected('http://[fe80::1]/hook');
  });

  it('accepts a public IPv4 literal', async () => {
    const u = await validateWebhookEndpoint('http://93.184.216.34/hook');
    expect(u.hostname).toBe('93.184.216.34');
  });
});

describe('validateWebhookEndpoint - hostname resolution', () => {
  it('rejects hostname that resolves to a private IP', async () => {
    const resolver = async (): Promise<string[]> => ['10.0.0.5'];
    await expectRejected('https://internal.example.com/hook', resolver);
  });

  it('rejects hostname that resolves to a mix of public and private', async () => {
    const resolver = async (): Promise<string[]> => ['93.184.216.34', '127.0.0.1'];
    await expectRejected('https://mixed.example.com/hook', resolver);
  });

  it('accepts hostname that resolves only to public IPs', async () => {
    const resolver = async (): Promise<string[]> => ['93.184.216.34'];
    const u = await validateWebhookEndpoint('https://example.com/hook', resolver);
    expect(u.hostname).toBe('example.com');
  });

  it('rejects hostname that does not resolve', async () => {
    const resolver = async (): Promise<string[]> => {
      throw new Error('ENOTFOUND');
    };
    await expectRejected('https://does-not-exist.example/hook', resolver);
  });

  it('rejects hostname resolving to zero addresses', async () => {
    const resolver = async (): Promise<string[]> => [];
    await expectRejected('https://empty.example.com/hook', resolver);
  });
});

describe('isNonPublicIp', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['192.168.0.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
    ['2001:4860:4860::8888', false],
  ])('%s -> non_public=%s', (ip, expected) => {
    expect(isNonPublicIp(ip)).toBe(expected);
  });
});
