import { describe, expect, it } from 'vitest';
import type { TransactionReceipt } from 'viem';
import { checkConfirmations, countConfirmations } from '../src/final.ts';
import type { ConfirmationPolicy } from '@lumibase/core';

/**
 * Minimal fake receipt. We only use blockNumber and status; everything else
 * is placeholders so TypeScript is satisfied without importing viem test
 * fixtures. This is why the function is pure — no anvil needed.
 */
function fakeReceipt(
  blockNumber: bigint,
  status: 'success' | 'reverted' = 'success',
): TransactionReceipt {
  return {
    blockNumber,
    status,
    transactionHash: '0x' + '0'.repeat(64),
    transactionIndex: 0,
    blockHash: '0x' + '0'.repeat(64),
    from: '0x' + '0'.repeat(40),
    to: '0x' + '0'.repeat(40),
    cumulativeGasUsed: 0n,
    gasUsed: 0n,
    contractAddress: null,
    logs: [],
    logsBloom: '0x' + '0'.repeat(512),
    effectiveGasPrice: 0n,
    type: 'eip1559',
  } as unknown as TransactionReceipt;
}

const POLICY_12: ConfirmationPolicy = { blocks: 12, finality: 'soft' };
const POLICY_1: ConfirmationPolicy = { blocks: 1, finality: 'soft' };

describe('countConfirmations', () => {
  it("counts the tx's own block as 1 confirmation", () => {
    const r = fakeReceipt(100n);
    expect(countConfirmations(r, 100n)).toBe(1);
  });

  it('counts N blocks deep as N confirmations', () => {
    const r = fakeReceipt(100n);
    expect(countConfirmations(r, 101n)).toBe(2);
    expect(countConfirmations(r, 112n)).toBe(13);
    expect(countConfirmations(r, 1000n)).toBe(901);
  });

  it('throws when currentBlock < receipt.blockNumber', () => {
    const r = fakeReceipt(100n);
    expect(() => countConfirmations(r, 99n)).toThrow(/less than/);
  });
});

describe('checkConfirmations - reverted receipts', () => {
  it('returns reverted regardless of depth', () => {
    const shallow = fakeReceipt(100n, 'reverted');
    const deep = fakeReceipt(100n, 'reverted');

    expect(checkConfirmations(shallow, 100n, POLICY_1).status).toBe('reverted');
    expect(checkConfirmations(deep, 1000n, POLICY_12).status).toBe('reverted');
  });

  it('includes the depth in the result even when reverted', () => {
    const r = fakeReceipt(100n, 'reverted');
    const result = checkConfirmations(r, 105n, POLICY_12);
    expect(result.status).toBe('reverted');
    expect(result.confirmations).toBe(6);
    expect(result.required).toBe(12);
  });
});

describe('checkConfirmations - success receipts', () => {
  it('returns confirmed when depth meets policy (12 required)', () => {
    const r = fakeReceipt(100n);
    const result = checkConfirmations(r, 111n, POLICY_12);
    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBe(12);
    expect(result.required).toBe(12);
  });

  it('returns pending when depth is one short of policy', () => {
    const r = fakeReceipt(100n);
    const result = checkConfirmations(r, 110n, POLICY_12);
    expect(result.status).toBe('pending');
    expect(result.confirmations).toBe(11);
    expect(result.required).toBe(12);
  });

  it('returns pending at zero blocks deep (receipt in current block, blocks=12)', () => {
    const r = fakeReceipt(100n);
    const result = checkConfirmations(r, 100n, POLICY_12);
    expect(result.status).toBe('pending');
    expect(result.confirmations).toBe(1);
  });

  it('returns confirmed at one block deep with blocks=1 policy', () => {
    const r = fakeReceipt(100n);
    const result = checkConfirmations(r, 100n, POLICY_1);
    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBe(1);
  });

  it('returns confirmed at much greater depth', () => {
    const r = fakeReceipt(100n);
    const result = checkConfirmations(r, 10_000n, POLICY_12);
    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBe(9901);
  });

  it('throws when currentBlock < receipt.blockNumber, even for success', () => {
    const r = fakeReceipt(100n);
    expect(() => checkConfirmations(r, 50n, POLICY_12)).toThrow(/less than/);
  });
});
