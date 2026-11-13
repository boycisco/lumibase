import { describe, expect, it } from 'vitest';
import type { TransactionReceipt } from 'viem';
import type { Erc20Transfer } from '@lumibase/network';
import { matchTransfers, verifyTransfers } from '../src/index.ts';
import type { Payment } from '../src/index.ts';

/**
 * Minimal Payment factory. Only the fields matchTransfers reads are
 * meaningful; the rest are placeholders.
 */
function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    applicationId: '660e8400-e29b-41d4-a716-446655440000',
    reference: null,
    chainId: 84532,
    tokenAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    amount: 1_500_000n,
    recipient: '0x0000000000000000000000000000000000000001',
    payer: null,
    status: 'pending',
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    metadata: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeTransfer(overrides: Partial<Erc20Transfer> = {}): Erc20Transfer {
  return {
    token: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    from: '0x0000000000000000000000000000000000000002',
    to: '0x0000000000000000000000000000000000000001',
    value: 1_500_000n,
    logIndex: 0,
    ...overrides,
  };
}

function makeReceipt(
  status: 'success' | 'reverted' = 'success',
  blockNumber: bigint = 100n,
): TransactionReceipt {
  return {
    blockNumber,
    status,
    logs: [],
    transactionHash: '0x' + '0'.repeat(64),
    transactionIndex: 0,
    blockHash: '0x' + '0'.repeat(64),
    from: '0x' + '0'.repeat(40),
    to: '0x' + '0'.repeat(40),
    cumulativeGasUsed: 0n,
    gasUsed: 0n,
    contractAddress: null,
    logsBloom: '0x' + '0'.repeat(512),
    effectiveGasPrice: 0n,
    type: 'eip1559',
  } as unknown as TransactionReceipt;
}

describe('matchTransfers — amount matching', () => {
  it('matched when exact amount', () => {
    const payment = makePayment();
    const v = matchTransfers(payment, [makeTransfer()]);
    expect(v.kind).toBe('matched');
  });

  it('underpaid when transfer is less than required', () => {
    const payment = makePayment();
    const v = matchTransfers(payment, [makeTransfer({ value: 1_000_000n })]);
    expect(v.kind).toBe('underpaid');
    if (v.kind !== 'underpaid') throw new Error('unreachable');
    expect(v.expected).toBe(1_500_000n);
    expect(v.actual).toBe(1_000_000n);
  });

  it('overpaid when transfer exceeds required', () => {
    const payment = makePayment();
    const v = matchTransfers(payment, [makeTransfer({ value: 2_000_000n })]);
    expect(v.kind).toBe('overpaid');
    if (v.kind !== 'overpaid') throw new Error('unreachable');
    expect(v.expected).toBe(1_500_000n);
    expect(v.actual).toBe(2_000_000n);
  });

  it('accepts MAX_UINT256 amount (bigint does not overflow)', () => {
    const max = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    const payment = makePayment({ amount: max });
    const v = matchTransfers(payment, [makeTransfer({ value: max })]);
    expect(v.kind).toBe('matched');
  });
});

describe('matchTransfers — wrong token / recipient / sender', () => {
  it('wrong_token when no transfer uses the expected token', () => {
    const payment = makePayment();
    const v = matchTransfers(payment, [
      makeTransfer({ token: '0x0000000000000000000000000000000000000099' }),
    ]);
    expect(v.kind).toBe('wrong_token');
    if (v.kind !== 'wrong_token') throw new Error('unreachable');
    expect(v.expected).toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  });

  it('wrong_recipient when transfer goes to different address', () => {
    const payment = makePayment();
    const v = matchTransfers(payment, [
      makeTransfer({ to: '0x0000000000000000000000000000000000000099' }),
    ]);
    expect(v.kind).toBe('wrong_recipient');
    if (v.kind !== 'wrong_recipient') throw new Error('unreachable');
    expect(v.expected).toBe('0x0000000000000000000000000000000000000001');
  });

  it('wrong_sender when payer specified and from mismatches', () => {
    const payment = makePayment({
      payer: '0x0000000000000000000000000000000000000005',
    });
    const v = matchTransfers(payment, [
      makeTransfer({ from: '0x0000000000000000000000000000000000000002' }),
    ]);
    expect(v.kind).toBe('wrong_sender');
    if (v.kind !== 'wrong_sender') throw new Error('unreachable');
    expect(v.expected).toBe('0x0000000000000000000000000000000000000005');
  });

  it('no_transfer when receipt has zero transfers', () => {
    const v = matchTransfers(makePayment(), []);
    expect(v.kind).toBe('no_transfer');
  });
});

describe('matchTransfers — payer flexibility', () => {
  it('accepts any sender when payer is null', () => {
    const payment = makePayment({ payer: null });
    const v = matchTransfers(payment, [
      makeTransfer({ from: '0x0000000000000000000000000000000000000099' }),
    ]);
    expect(v.kind).toBe('matched');
  });

  it('requires exact sender when payer is set', () => {
    const payment = makePayment({
      payer: '0x0000000000000000000000000000000000000002',
    });
    const v = matchTransfers(payment, [makeTransfer()]);
    expect(v.kind).toBe('matched');
  });
});

describe('matchTransfers — ambiguity', () => {
  it('ambiguous when two matching transfers exist', () => {
    const payment = makePayment();
    const v = matchTransfers(payment, [
      makeTransfer({ logIndex: 0 }),
      makeTransfer({ logIndex: 1 }),
    ]);
    expect(v.kind).toBe('ambiguous');
    if (v.kind !== 'ambiguous') throw new Error('unreachable');
    expect(v.count).toBe(2);
  });

  it('one matching + one non-matching transfer is not ambiguous', () => {
    const payment = makePayment();
    const v = matchTransfers(payment, [
      makeTransfer({ logIndex: 0 }),
      makeTransfer({
        to: '0x0000000000000000000000000000000000000099',
        logIndex: 1,
      }),
    ]);
    expect(v.kind).toBe('matched');
  });
});

describe('matchTransfers — case-insensitivity', () => {
  it('matches regardless of address casing', () => {
    const payment = makePayment({
      tokenAddress: '0x036CBD53842C5426634E7929541EC2318F3DCF7E'.toLowerCase() as `0x${string}`,
      recipient: '0x0000000000000000000000000000000000000001',
    });
    const v = matchTransfers(payment, [
      makeTransfer({
        token: '0x036CBD53842C5426634E7929541EC2318F3DCF7E' as `0x${string}`,
      }),
    ]);
    expect(v.kind).toBe('matched');
  });
});

describe('verifyTransfers — reverted receipt', () => {
  it('returns reverted regardless of transfer content', () => {
    const receipt = makeReceipt('reverted');
    const v = verifyTransfers(receipt, makePayment(), 200n, { blocks: 12, finality: 'soft' });
    expect(v.kind).toBe('reverted');
  });
});

describe('verifyTransfers — insufficient confirmations', () => {
  it('returns not_enough_confirmations when head barely past receipt block', () => {
    const receipt = makeReceipt('success', 100n);
    const v = verifyTransfers(receipt, makePayment(), 100n, { blocks: 12, finality: 'soft' });
    expect(v.kind).toBe('not_enough_confirmations');
    if (v.kind !== 'not_enough_confirmations') throw new Error('unreachable');
    expect(v.confirmations).toBe(1);
    expect(v.required).toBe(12);
  });

  it('proceeds past confirmation check when depth satisfies policy', () => {
    const receipt = makeReceipt('success', 100n);
    // blocks=1 policy: 1 confirmation is enough. No transfers -> no_transfer.
    const v = verifyTransfers(receipt, makePayment(), 100n, { blocks: 1, finality: 'soft' });
    expect(v.kind).toBe('no_transfer');
  });
});
