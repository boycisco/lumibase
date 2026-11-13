import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LumiError } from '@lumibase/core';
import { applications, events, payments } from '@lumibase/database';
import { BASE_SEPOLIA, BASE_SEPOLIA_USDC } from '@lumibase/network';
import type { NetworkConfig, ResolvedChain } from '@lumibase/network';
import { cancelPayment, createPayment, resolveConfig } from '../src/index.ts';
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

async function makeConfig(): Promise<ResolvedConfig> {
  return resolveConfig({ db, chains });
}

describe('cancelPayment — success', () => {
  it('transitions pending to cancelled', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    const cancelled = await cancelPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
    });
    expect(cancelled.status).toBe('cancelled');

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe('cancelled');
  });

  it('does not emit any event (v0.1 rule)', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    const beforeCount = (await db.select().from(events)).length;

    await cancelPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
    });

    const afterCount = (await db.select().from(events)).length;
    // Only the payment.created event was already there; nothing new.
    expect(afterCount).toBe(beforeCount);
  });
});

describe('cancelPayment — isolation', () => {
  it("throws PAYMENT_NOT_FOUND for another app's payment", async () => {
    const appA = await insertApp('app-a');
    const appB = await insertApp('app-b');
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appA));

    try {
      await cancelPayment(config, {
        paymentId: payment.id,
        applicationId: appB,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_NOT_FOUND');
      expect((err as LumiError).statusCode).toBe(404);
    }

    // Confirm the payment is still pending in the DB (not cancelled by app B).
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe('pending');
  });

  it('throws PAYMENT_NOT_FOUND for a nonexistent payment', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    try {
      await cancelPayment(config, {
        paymentId: '00000000-0000-4000-8000-000000000000',
        applicationId: appId,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_NOT_FOUND');
    }
  });
});

describe('cancelPayment — idempotency', () => {
  it('returns current state when already cancelled (200-style no-op)', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    const first = await cancelPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
    });
    const second = await cancelPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
    });
    expect(first.status).toBe('cancelled');
    expect(second.status).toBe('cancelled');
    expect(second.id).toBe(first.id);
  });
});

describe('cancelPayment — invalid state', () => {
  it('throws PAYMENT_INVALID_STATE for a confirmed payment', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    await db.update(payments).set({ status: 'confirmed' }).where(eq(payments.id, payment.id));

    try {
      await cancelPayment(config, {
        paymentId: payment.id,
        applicationId: appId,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_INVALID_STATE');
      expect((err as LumiError).statusCode).toBe(409);
    }
  });

  it('throws PAYMENT_INVALID_STATE for an expired payment', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    await db.update(payments).set({ status: 'expired' }).where(eq(payments.id, payment.id));

    try {
      await cancelPayment(config, {
        paymentId: payment.id,
        applicationId: appId,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_INVALID_STATE');
    }
  });

  it('throws PAYMENT_INVALID_STATE for a processing payment', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    await db.update(payments).set({ status: 'processing' }).where(eq(payments.id, payment.id));

    try {
      await cancelPayment(config, {
        paymentId: payment.id,
        applicationId: appId,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_INVALID_STATE');
    }
  });
});
