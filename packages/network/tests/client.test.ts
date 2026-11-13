import { describe, expect, it } from 'vitest';
import { LumiError } from '@lumibase/core';
import { BASE_MAINNET, BASE_SEPOLIA, type ResolvedChain } from '../src/chain.ts';
import { createClient } from '../src/client.ts';

const sepolia: ResolvedChain = {
  ...BASE_SEPOLIA,
  rpc: 'https://sepolia.example.org',
};

const mainnet: ResolvedChain = {
  ...BASE_MAINNET,
  rpc: 'https://mainnet.example.org',
};

describe('createClient', () => {
  it('creates a client for an enabled chain', () => {
    const client = createClient(sepolia);
    expect(client).toBeDefined();
    expect(client.chain?.id).toBe(BASE_SEPOLIA.id);
  });

  it('throws for a disabled chain (the mainnet safety gate)', () => {
    expect(() => createClient(mainnet)).toThrow(LumiError);
  });

  it('throws for a chain with empty rpc', () => {
    const broken: ResolvedChain = { ...sepolia, rpc: '' };
    expect(() => createClient(broken)).toThrow(LumiError);
  });

  it('throws for a chain with non-http rpc', () => {
    const broken: ResolvedChain = { ...sepolia, rpc: 'ws://example.com' };
    expect(() => createClient(broken)).toThrow(LumiError);
  });

  it('returned client uses the correct chain id', () => {
    const client = createClient(sepolia);
    expect(client.chain?.id).toBe(84532);
    expect(client.chain?.name).toBe('Base Sepolia');
  });
});
