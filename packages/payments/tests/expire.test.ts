import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applications, events, payments } from '@lumibase/database';
import { BASE_SEPOLIA, BASE_SEPOLIA_USDC } from '@lumibase/network';
import type { NetworkConfig, ResolvedChain } from '@lumibase/network';
import { createPayment, expirePayment, expirePending, resolveConfig } from '../src/index.ts';
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
    expiresIn: 60,
    ...overrides,
  };
}

async function makeConfig(
  overrides: { clock?: () => Date; idGenerator?: () => string } = {},
): Promise<ResolvedConfig> {
  return resolveConfig({ db, chains, ...overrides });
}

describe('expirePayment', () => {
  it('transitions pending to expired and emits payment.expired event', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    const expired = await expirePayment(config, payment.id);
    expect(expired).not.toBeNull();
    expect(expired!.id).toBe(payment.id);
    expect(expired!.status).toBe('expired');

    const evtRows = await db.select().from(events).where(eq(events.paymentId, payment.id));
    // 1 payment.created + 1 payment.expired
    expect(evtRows).toHaveLength(2);
    const expiredEvent = evtRows.find((r) => r.type === 'payment.expired');
    expect(expiredEvent).toBeDefined();
  });

  it('returns null on second call (idempotent no-op)', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    const first = await expirePayment(config, payment.id);
    expect(first).not.toBeNull();
    const second = await expirePayment(config, payment.id);
    expect(second).toBeNull();
  });

  it('returns null for a nonexistent payment', async () => {
    const config = await makeConfig();
    const result = await expirePayment(config, '00000000-0000-4000-8000-000000000000');
    expect(result).toBeNull();
  });

  it('does not touch a confirmed payment (processing is protected)', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));

    // Simulate a payment in processing state.
    await db.update(payments).set({ status: 'processing' }).where(eq(payments.id, payment.id));

    const result = await expirePayment(config, payment.id);
    expect(result).toBeNull();

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe('processing');
  });
});

describe('expirePending', () => {
  it('returns empty array when nothing is due', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await createPayment(config, makeInput(appId, { expiresIn: 3600 }));

    const result = await expirePending(config);
    expect(result).toEqual([]);
  });

  it('expires all pending payments past their expiresAt', async () => {
    const appId = await insertApp();
    const createAt = new Date('2025-06-01T12:00:00Z');
    const createConfig = await makeConfig({ clock: () => createAt });
    await createPayment(createConfig, makeInput(appId, { expiresIn: 60 }));
    await createPayment(createConfig, makeInput(appId, { expiresIn: 120 }));

    // Worker runs at T+90s: first (60s) is expired, second (120s) is not.
    const workerTime = new Date('2025-06-01T12:01:30Z');
    const result = await expirePending(createConfig, workerTime);
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe('expired');
  });

  it('does nothing when all payments are still valid', async () => {
    const appId = await insertApp();
    const createAt = new Date('2025-06-01T12:00:00Z');
    const createConfig = await makeConfig({ clock: () => createAt });
    await createPayment(createConfig, makeInput(appId, { expiresIn: 3600 }));

    const result = await expirePending(createConfig, new Date('2025-06-01T12:30:00Z'));
    expect(result).toEqual([]);
  });

  it('creates one payment.expired event per expired payment', async () => {
    const appId = await insertApp();
    const createAt = new Date('2025-06-01T12:00:00Z');
    const createConfig = await makeConfig({ clock: () => createAt });
    await createPayment(createConfig, makeInput(appId, { expiresIn: 10 }));
    await createPayment(createConfig, makeInput(appId, { expiresIn: 20 }));

    await expirePending(createConfig, new Date('2025-06-01T12:05:00Z'));

    const evtRows = await db.select().from(events);
    const expiredCount = evtRows.filter((r) => r.type === 'payment.expired').length;
    expect(expiredCount).toBe(2);
  });

  it('does not touch confirmed payments even if expired by clock', async () => {
    const appId = await insertApp();
    const createAt = new Date('2025-06-01T12:00:00Z');
    const createConfig = await makeConfig({ clock: () => createAt });
    const p = await createPayment(createConfig, makeInput(appId, { expiresIn: 60 }));

    await db.update(payments).set({ status: 'confirmed' }).where(eq(payments.id, p.id));

    const result = await expirePending(createConfig, new Date('2025-06-01T13:00:00Z'));
    expect(result).toEqual([]);

    const [row] = await db.select().from(payments).where(eq(payments.id, p.id));
    expect(row!.status).toBe('confirmed');
  });

  it('uses config.clock() when `now` not provided', async () => {
    const appId = await insertApp();
    const createAt = new Date('2025-06-01T12:00:00Z');
    const createConfig = await makeConfig({ clock: () => createAt });
    await createPayment(createConfig, makeInput(appId, { expiresIn: 60 }));

    // Create a fresh config whose clock is 5 minutes later.
    const laterConfig = await makeConfig({
      clock: () => new Date('2025-06-01T12:05:00Z'),
    });
    const result = await expirePending(laterConfig);
    expect(result).toHaveLength(1);
  });
});
