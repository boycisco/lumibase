import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

interface Lifecycle {
  statuses: Record<string, { terminal: boolean; transitionsTo: string[] }>;
}

interface Cases {
  statuses: string[];
  allowed: [string, string][];
}

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(here, relativePath), 'utf8')) as T;
}

const lifecycle = loadJson<Lifecycle>('../../specs/payments/lifecycle.json');
const cases = loadJson<Cases>('../fixtures/transition/cases.json');

function specAllows(from: string, to: string): boolean {
  const status = lifecycle.statuses[from];
  if (!status) throw new Error(`Unknown status in lifecycle.json: ${from}`);
  return status.transitionsTo.includes(to);
}

function fixtureAllows(from: string, to: string): boolean {
  return cases.allowed.some(([f, t]) => f === from && t === to);
}

describe('transition fixture matches lifecycle.json', () => {
  it('fixture status list matches lifecycle statuses exactly', () => {
    const lifecycleStatuses = Object.keys(lifecycle.statuses).sort();
    const caseStatuses = [...cases.statuses].sort();
    expect(caseStatuses).toEqual(lifecycleStatuses);
  });

  it('every pair (from, to) has consistent allow/deny in fixture and lifecycle.json', () => {
    const mismatches: { from: string; to: string; spec: boolean; fixture: boolean }[] = [];
    for (const from of cases.statuses) {
      for (const to of cases.statuses) {
        const spec = specAllows(from, to);
        const fixture = fixtureAllows(from, to);
        if (spec !== fixture) {
          mismatches.push({ from, to, spec, fixture });
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const [name, status] of Object.entries(lifecycle.statuses)) {
      if (status.terminal) {
        expect(status.transitionsTo, `terminal status "${name}"`).toEqual([]);
      }
    }
  });

  it('every transition target is a known status', () => {
    const known = new Set(Object.keys(lifecycle.statuses));
    for (const [name, status] of Object.entries(lifecycle.statuses)) {
      for (const target of status.transitionsTo) {
        expect(known.has(target), `${name} -> ${target}`).toBe(true);
      }
    }
  });

  it('non-terminal statuses have at least one outgoing transition', () => {
    for (const [name, status] of Object.entries(lifecycle.statuses)) {
      if (!status.terminal) {
        expect(status.transitionsTo.length, `non-terminal status "${name}"`).toBeGreaterThan(0);
      }
    }
  });
});
