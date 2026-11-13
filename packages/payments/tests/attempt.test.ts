import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applications, transactions } from '@lumibase/database';
import { BASE_SEPOLIA, BASE_SEPOLIA_USDC } from '@lumibase/network';
import type { NetworkConfig, ResolvedChain } from '@lumibase/network';
import { createPayment, recordAttempt, resolveConfig } from '../src/index.ts';
import type { CreatePaymentInput, ResolvedConfig } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

afterEach(async () => {
  await truncateAll();
});

const SEPOLIA: ResolvedChain = { ...BASE_SEPOLIA, rpc: 'http://localhost:8545' };
const chains: NetworkConfig = { chains: new Map([[SEPOLIA.id, SEPOLIA]]) };

async function insertApp(): Promise<string> {
  const [row] = await db
    .insert(applications)
    .values({ name: 'app', keyHash: 'h-' + Math.random().toString(36) })
    .returning({ id: applications.id });
  if (!row) throw new Error('Failed to insert application');
  return row.id;
}

async function makePayment(): Promise<{ config: ResolvedConfig; paymentId: string }> {
  const appId = await insertApp();
  const config = await resolveConfig({ db, chains });
  const input: CreatePaymentInput = {
    applicationId: appId,
    chainId: SEPOLIA.id,
    token: BASE_SEPOLIA_USDC.address,
    amount: 1_500_000n,
    recipient: '0x0000000000000000000000000000000000000001',
    expiresIn: 1800,
  };
  const payment = await createPayment(config, input);
  return { config, paymentId: payment.id };
}

const HASH_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const HASH_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;

function makeAttemptInput(paymentId: string, hash: `0x${string}` = HASH_A) {
  return {
    paymentId,
    chainId: SEPOLIA.id,
    hash,
    sender: '0x0000000000000000000000000000000000000002' as `0x${string}`,
    recipient: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    tokenAddress: BASE_SEPOLIA_USDC.address,
    amount: 1_500_000n,
    blockNumber: 100n,
    status: 'verified' as const,
  };
}

describe('recordAttempt — success', () => {
  it('records a new attempt', async () => {
    const { config, paymentId } = await makePayment();
    const result = await recordAttempt(config, makeAttemptInput(paymentId));
    expect(result.kind).toBe('recorded');
    if (result.kind !== 'recorded') throw new Error('unreachable');
    expect(result.id).toMatch(/^[0-9a-f]{8}-/);

    const rows = await db.select().from(transactions).where(eq(transactions.id, result.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('1500000');
    expect(rows[0]!.status).toBe('verified');
    expect(rows[0]!.verifiedAt).not.toBeNull();
  });

  it('leaves verifiedAt null for rejected attempts', async () => {
    const { config, paymentId } = await makePayment();
    const input = { ...makeAttemptInput(paymentId), status: 'rejected' as const };
    const result = await recordAttempt(config, input);
    if (result.kind !== 'recorded') throw new Error('expected recorded');
    const [row] = await db.select().from(transactions).where(eq(transactions.id, result.id));
    expect(row!.status).toBe('rejected');
    expect(row!.verifiedAt).toBeNull();
  });
});

describe('recordAttempt — duplicate (chain_id, hash)', () => {
  it('returns duplicate when the same (chain_id, hash) is recorded twice', async () => {
    const { config, paymentId } = await makePayment();
    const first = await recordAttempt(config, makeAttemptInput(paymentId, HASH_A));
    expect(first.kind).toBe('recorded');

    const second = await recordAttempt(config, makeAttemptInput(paymentId, HASH_A));
    expect(second.kind).toBe('duplicate');
    if (second.kind !== 'duplicate') throw new Error('unreachable');
    expect(second.existingPaymentId).toBe(paymentId);
  });

  it('allows the same hash on a different chain (uniqueness is the pair)', async () => {
    const { config, paymentId } = await makePayment();
    await recordAttempt(config, makeAttemptInput(paymentId, HASH_A));

    // Same hash, different chainId. This should NOT be a duplicate.
    const other = await recordAttempt(config, {
      ...makeAttemptInput(paymentId, HASH_A),
      chainId: 8453,
    });
    expect(other.kind).toBe('recorded');
  });

  it('does not create a second transaction row on duplicate', async () => {
    const { config, paymentId } = await makePayment();
    await recordAttempt(config, makeAttemptInput(paymentId, HASH_A));
    await recordAttempt(config, makeAttemptInput(paymentId, HASH_A));

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
  });
});

describe('recordAttempt — distinct hashes', () => {
  it('records two distinct hashes on the same payment', async () => {
    const { config, paymentId } = await makePayment();
    const a = await recordAttempt(config, makeAttemptInput(paymentId, HASH_A));
    const b = await recordAttempt(config, makeAttemptInput(paymentId, HASH_B));
    expect(a.kind).toBe('recorded');
    expect(b.kind).toBe('recorded');

    const rows = await db.select().from(transactions).where(eq(transactions.paymentId, paymentId));
    expect(rows).toHaveLength(2);
  });
});
