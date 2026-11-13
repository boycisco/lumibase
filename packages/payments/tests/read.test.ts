import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LumiError } from '@lumibase/core';
import { applications, payments } from '@lumibase/database';
import { BASE_SEPOLIA, BASE_SEPOLIA_USDC } from '@lumibase/network';
import type { NetworkConfig, ResolvedChain } from '@lumibase/network';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  createPayment,
  getPayment,
  listPayments,
  resolveConfig,
} from '../src/index.ts';
import type { CreatePaymentInput, ResolvedConfig } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

afterEach(async () => {
  await truncateAll();
});

const SEPOLIA: ResolvedChain = { ...BASE_SEPOLIA, rpc: 'http://localhost:8545' };
const chains: NetworkConfig = { chains: new Map([[SEPOLIA.id, SEPOLIA]]) };

async function insertApp(name = 'app'): Promise<string> {
  const [row] = await db
    .insert(applications)
    .values({ name, keyHash: 'h-' + Math.random().toString(36) })
    .returning({ id: applications.id });
  if (!row) throw new Error('Failed to insert application');
  return row.id;
}

async function makeConfig(
  overrides: { clock?: () => Date; idGenerator?: () => string } = {},
): Promise<ResolvedConfig> {
  return resolveConfig({ db, chains, ...overrides });
}

function makeInput(
  applicationId: string,
  overrides: Partial<CreatePaymentInput> = {},
): CreatePaymentInput {
  return {
    applicationId,
    chainId: SEPOLIA.id,
    token: BASE_SEPOLIA_USDC.address,
    amount: 1_500_000n,
    recipient: '0x0000000000000000000000000000000000000001',
    expiresIn: 1800,
    ...overrides,
  };
}

describe('getPayment', () => {
  it('returns the payment when IDs match', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const created = await createPayment(config, makeInput(appId));
    const fetched = await getPayment(config, {
      paymentId: created.id,
      applicationId: appId,
    });
    expect(fetched.id).toBe(created.id);
    expect(fetched.amount).toBe(1_500_000n);
    expect(fetched.status).toBe('pending');
  });

  it('throws PAYMENT_NOT_FOUND for a nonexistent ID', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    try {
      await getPayment(config, {
        paymentId: '00000000-0000-4000-8000-000000000000',
        applicationId: appId,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_NOT_FOUND');
      expect((err as LumiError).statusCode).toBe(404);
    }
  });

  it("throws PAYMENT_NOT_FOUND for another app's payment (isolation)", async () => {
    const appA = await insertApp('app-a');
    const appB = await insertApp('app-b');
    const config = await makeConfig();
    const paymentOfA = await createPayment(config, makeInput(appA));
    try {
      await getPayment(config, {
        paymentId: paymentOfA.id,
        applicationId: appB,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_NOT_FOUND');
      expect((err as LumiError).statusCode).toBe(404);
    }
  });

  it('returns bigint amount and Date timestamps', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const created = await createPayment(config, makeInput(appId));
    const fetched = await getPayment(config, {
      paymentId: created.id,
      applicationId: appId,
    });
    expect(typeof fetched.amount).toBe('bigint');
    expect(fetched.createdAt).toBeInstanceOf(Date);
    expect(fetched.expiresAt).toBeInstanceOf(Date);
    expect(fetched.updatedAt).toBeInstanceOf(Date);
  });
});

describe('listPayments — isolation', () => {
  it('returns empty list for an application with no payments', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const result = await listPayments(config, { applicationId: appId });
    expect(result).toEqual([]);
  });

  it("returns only the calling application's payments", async () => {
    const appA = await insertApp('app-a');
    const appB = await insertApp('app-b');
    const config = await makeConfig();
    await createPayment(config, makeInput(appA));
    await createPayment(config, makeInput(appA));
    await createPayment(config, makeInput(appB));
    const resultA = await listPayments(config, { applicationId: appA });
    const resultB = await listPayments(config, { applicationId: appB });
    expect(resultA).toHaveLength(2);
    expect(resultB).toHaveLength(1);
    for (const p of resultA) expect(p.applicationId).toBe(appA);
    for (const p of resultB) expect(p.applicationId).toBe(appB);
  });
});

describe('listPayments — filters', () => {
  it('filters by status', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const p1 = await createPayment(config, makeInput(appId));
    await createPayment(config, makeInput(appId));

    // Flip p1 to confirmed directly.
    await db.update(payments).set({ status: 'confirmed' }).where(eq(payments.id, p1.id));

    const pending = await listPayments(config, {
      applicationId: appId,
      status: 'pending',
    });
    const confirmed = await listPayments(config, {
      applicationId: appId,
      status: 'confirmed',
    });
    expect(pending).toHaveLength(1);
    expect(confirmed).toHaveLength(1);
    expect(pending[0]!.status).toBe('pending');
    expect(confirmed[0]!.status).toBe('confirmed');
  });

  it('filters by reference', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await createPayment(config, makeInput(appId, { reference: 'ORDER_A' }));
    await createPayment(config, makeInput(appId, { reference: 'ORDER_B' }));
    const result = await listPayments(config, {
      applicationId: appId,
      reference: 'ORDER_A',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.reference).toBe('ORDER_A');
  });

  it('filters by chainId', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await createPayment(config, makeInput(appId));
    const sepolia = await listPayments(config, {
      applicationId: appId,
      chainId: SEPOLIA.id,
    });
    const other = await listPayments(config, {
      applicationId: appId,
      chainId: 1,
    });
    expect(sepolia).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('combines filters (all must match)', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await createPayment(config, makeInput(appId, { reference: 'R1' }));
    await createPayment(config, makeInput(appId, { reference: 'R1' }));
    const result = await listPayments(config, {
      applicationId: appId,
      reference: 'R1',
      chainId: 1,
    });
    expect(result).toEqual([]);
  });
});

describe('listPayments — limits', () => {
  it('uses default limit when not specified', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    for (let i = 0; i < 3; i += 1) await createPayment(config, makeInput(appId));
    const result = await listPayments(config, { applicationId: appId });
    expect(result).toHaveLength(3);
    expect(DEFAULT_LIST_LIMIT).toBe(20);
  });

  it('respects an explicit limit', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    for (let i = 0; i < 5; i += 1) await createPayment(config, makeInput(appId));
    const result = await listPayments(config, { applicationId: appId, limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('clamps limit above MAX_LIST_LIMIT', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await createPayment(config, makeInput(appId));
    const result = await listPayments(config, {
      applicationId: appId,
      limit: MAX_LIST_LIMIT + 500,
    });
    expect(result.length).toBeLessThanOrEqual(MAX_LIST_LIMIT);
  });

  it('treats limit<1 as default', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await createPayment(config, makeInput(appId));
    const result = await listPayments(config, { applicationId: appId, limit: 0 });
    expect(Array.isArray(result)).toBe(true);
  });

  it('throws for non-integer limit', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    try {
      await listPayments(config, { applicationId: appId, limit: 1.5 });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_INVALID_STATE');
    }
  });
});

describe('listPayments — ordering', () => {
  it('returns payments in createdAt DESC order (newest first)', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const times = [
      new Date('2025-06-01T10:00:00Z'),
      new Date('2025-06-01T11:00:00Z'),
      new Date('2025-06-01T12:00:00Z'),
    ];
    for (const t of times) {
      const c = await makeConfig({ clock: () => t });
      await createPayment(c, makeInput(appId));
    }
    const result = await listPayments(config, { applicationId: appId });
    expect(result).toHaveLength(3);
    expect(result[0]!.createdAt.getTime()).toBe(times[2]!.getTime());
    expect(result[1]!.createdAt.getTime()).toBe(times[1]!.getTime());
    expect(result[2]!.createdAt.getTime()).toBe(times[0]!.getTime());
  });
});
