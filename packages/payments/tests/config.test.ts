import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';

// The factory only uses db and chains at construction time, and clock /
// idGenerator are the injectable pieces. Use minimal fakes so no real
// database is required.
const fakeConfig = {
  db: {} as unknown as Parameters<typeof resolveConfig>[0]['db'],
  chains: { chains: new Map() },
};

describe('resolveConfig', () => {
  it('applies default clock when none provided', () => {
    const config = resolveConfig(fakeConfig);
    expect(typeof config.clock).toBe('function');
    const now = config.clock();
    expect(now).toBeInstanceOf(Date);
    // Sanity: within a generous window of "now".
    expect(Math.abs(Date.now() - now.getTime())).toBeLessThan(5_000);
  });

  it('applies default idGenerator when none provided', () => {
    const config = resolveConfig(fakeConfig);
    const id = config.idGenerator();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('uses injected clock', () => {
    const fixed = new Date('2025-01-01T00:00:00Z');
    const config = resolveConfig({ ...fakeConfig, clock: () => fixed });
    expect(config.clock()).toBe(fixed);
  });

  it('uses injected idGenerator', () => {
    const config = resolveConfig({ ...fakeConfig, idGenerator: () => 'fixed-id' });
    expect(config.idGenerator()).toBe('fixed-id');
  });

  it('default idGenerator returns unique values', () => {
    const config = resolveConfig(fakeConfig);
    const a = config.idGenerator();
    const b = config.idGenerator();
    expect(a).not.toBe(b);
  });
});
