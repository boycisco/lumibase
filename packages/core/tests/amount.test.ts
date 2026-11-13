import { describe, expect, it } from 'vitest';
import {
  MAX_UINT256,
  deserializeAmount,
  formatUnits,
  parseUnits,
  serializeAmount,
} from '../src/amount.js';
import { LumiError } from '../src/error.js';

describe('deserializeAmount', () => {
  it('parses a canonical integer string', () => {
    expect(deserializeAmount('1500000')).toBe(1_500_000n);
    expect(deserializeAmount('0')).toBe(0n);
    expect(deserializeAmount('1')).toBe(1n);
  });

  it('accepts MAX_UINT256 exactly (no precision loss)', () => {
    expect(deserializeAmount(MAX_UINT256.toString())).toBe(MAX_UINT256);
  });

  it('rejects values larger than uint256', () => {
    expect(() => deserializeAmount((MAX_UINT256 + 1n).toString())).toThrow(LumiError);
  });

  it.each(['-1', '1.5', '1e6', '0x10', '', ' ', ' 1', '1 ', '+1', '01', '001'])(
    'rejects malformed input %p',
    (input) => {
      expect(() => deserializeAmount(input)).toThrow(LumiError);
    },
  );
});

describe('serializeAmount', () => {
  it('returns the canonical decimal form', () => {
    expect(serializeAmount(1_500_000n)).toBe('1500000');
    expect(serializeAmount(0n)).toBe('0');
  });

  it('rejects negatives', () => {
    expect(() => serializeAmount(-1n)).toThrow(LumiError);
  });

  it('rejects values larger than uint256', () => {
    expect(() => serializeAmount(MAX_UINT256 + 1n)).toThrow(LumiError);
  });

  it('round-trips with deserializeAmount', () => {
    for (const s of ['0', '1', '1000', '1500000', MAX_UINT256.toString()]) {
      expect(serializeAmount(deserializeAmount(s))).toBe(s);
    }
  });
});

describe('parseUnits', () => {
  it('converts human USDC amounts to base units', () => {
    expect(parseUnits('1.50', 6)).toBe(1_500_000n);
    expect(parseUnits('1', 6)).toBe(1_000_000n);
    expect(parseUnits('0.000001', 6)).toBe(1n);
    expect(parseUnits('0', 6)).toBe(0n);
  });

  it('handles 18-decimal tokens', () => {
    expect(parseUnits('1.5', 18)).toBe(1_500_000_000_000_000_000n);
  });

  it('handles 0-decimal tokens', () => {
    expect(parseUnits('42', 0)).toBe(42n);
  });

  it('rejects more precision than the token allows (no rounding)', () => {
    expect(() => parseUnits('0.0000005', 6)).toThrow(LumiError);
    expect(() => parseUnits('1.5000001', 6)).toThrow(LumiError);
  });

  it.each(['', ' ', ' 1.5', '1.5 ', '-1', '1e6', '01', '.5', '1.', '1.5.5', '1,5'])(
    'rejects malformed human amount %p',
    (input) => {
      expect(() => parseUnits(input, 6)).toThrow(LumiError);
    },
  );

  it('rejects invalid decimals', () => {
    expect(() => parseUnits('1', -1)).toThrow(LumiError);
    expect(() => parseUnits('1', 1.5)).toThrow(LumiError);
    expect(() => parseUnits('1', 37)).toThrow(LumiError);
  });
});

describe('formatUnits', () => {
  it('returns whole numbers without a decimal point', () => {
    expect(formatUnits(1_000_000n, 6)).toBe('1');
    expect(formatUnits(0n, 6)).toBe('0');
  });

  it('trims trailing fractional zeros', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5');
    expect(formatUnits(1_000_001n, 6)).toBe('1.000001');
  });

  it('pads small fractional amounts with leading zeros', () => {
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(10n, 6)).toBe('0.00001');
    expect(formatUnits(100_000n, 6)).toBe('0.1');
  });

  it('handles 18-decimal tokens', () => {
    expect(formatUnits(1_500_000_000_000_000_000n, 18)).toBe('1.5');
  });

  it('handles 0-decimal tokens', () => {
    expect(formatUnits(42n, 0)).toBe('42');
  });

  it('rejects negatives', () => {
    expect(() => formatUnits(-1n, 6)).toThrow(LumiError);
  });

  it('rejects invalid decimals', () => {
    expect(() => formatUnits(1n, -1)).toThrow(LumiError);
    expect(() => formatUnits(1n, 1.5)).toThrow(LumiError);
  });

  it('round-trips with parseUnits', () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['0', 6],
      ['0.000001', 6],
      ['1', 6],
      ['1.5', 6],
      ['123.456789', 6],
      ['1.5', 18],
      ['42', 0],
    ];
    for (const [human, decimals] of cases) {
      expect(formatUnits(parseUnits(human, decimals), decimals)).toBe(human);
    }
  });
});
