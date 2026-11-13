import { describe, expect, it } from 'vitest';
import { BASE_MAINNET, BASE_SEPOLIA } from '../src/chain.ts';
import { loadNetworkConfig, requireChain } from '../src/config.ts';

describe('loadNetworkConfig', () => {
  it('includes Base Sepolia when BASE_SEPOLIA_RPC is set', () => {
    const config = loadNetworkConfig({
      BASE_SEPOLIA_RPC: 'https://sepolia.example.org',
    });
    const chain = config.chains.get(BASE_SEPOLIA.id);
    expect(chain).toBeDefined();
    expect(chain!.rpc).toBe('https://sepolia.example.org');
  });

  it('omits Base Sepolia when BASE_SEPOLIA_RPC is absent', () => {
    const config = loadNetworkConfig({});
    expect(config.chains.get(BASE_SEPOLIA.id)).toBeUndefined();
  });

  it('omits Base Sepolia when BASE_SEPOLIA_RPC is empty string', () => {
    const config = loadNetworkConfig({ BASE_SEPOLIA_RPC: '' });
    expect(config.chains.get(BASE_SEPOLIA.id)).toBeUndefined();
  });

  it('includes Base Mainnet when BASE_MAINNET_RPC is set, preserving disabled flag', () => {
    const config = loadNetworkConfig({
      BASE_MAINNET_RPC: 'https://mainnet.example.org',
    });
    const chain = config.chains.get(BASE_MAINNET.id);
    expect(chain).toBeDefined();
    expect(chain!.rpc).toBe('https://mainnet.example.org');
    // Even when RPC is set, the safety flag stays false. Client creation
    // is what enforces this; config loading preserves the flag faithfully.
    expect(chain!.enabled).toBe(false);
  });

  it('includes both chains when both RPCs are set', () => {
    const config = loadNetworkConfig({
      BASE_SEPOLIA_RPC: 'https://sepolia.example.org',
      BASE_MAINNET_RPC: 'https://mainnet.example.org',
    });
    expect(config.chains.size).toBe(2);
  });
});

describe('requireChain', () => {
  it('returns the chain when present', () => {
    const config = loadNetworkConfig({
      BASE_SEPOLIA_RPC: 'https://sepolia.example.org',
    });
    const chain = requireChain(config, BASE_SEPOLIA.id);
    expect(chain.id).toBe(BASE_SEPOLIA.id);
  });

  it('throws when the chain is not configured', () => {
    const config = loadNetworkConfig({});
    expect(() => requireChain(config, BASE_SEPOLIA.id)).toThrow(/not configured/);
  });
});
