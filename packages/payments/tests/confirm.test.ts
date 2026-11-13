import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LumiError } from '@lumibase/core';
import { applications, events, payments, transactions } from '@lumibase/database';
import { BASE_SEPOLIA } from '@lumibase/network';
import type { NetworkConfig, ResolvedChain } from '@lumibase/network';
import { cancelPayment, confirmPayment, createPayment, resolveConfig } from '../src/index.ts';
import type { CreatePaymentInput, ResolvedConfig } from '../src/index.ts';
import { ANVIL_URL, ensureAnvil } from './anvil.ts';
import { deployMockUSDC, sendRevertingTransfer, sendTransfer, type DeployedToken } from './mock.ts';
import { db, truncateAll } from './setup.ts';

let mock: DeployedToken;
let config: ResolvedConfig;

beforeAll(async () => {
  await ensureAnvil();
  mock = await deployMockUSDC(1_000_000n * 10n ** 6n);
  const MOCK_SEPOLIA: ResolvedChain = {
    ...BASE_SEPOLIA,
    rpc: ANVIL_URL,
    tokens: [
      {
        address: mock.address,
        symbol: 'mUSDC',
        name: 'Mock USDC',
        decimals: 6,
        enabled: true,
      },
    ],
    confirmation: { blocks: 1, finality: 'soft' },
  };
  const chains: NetworkConfig = {
    chains: new Map([[BASE_SEPOLIA.id, MOCK_SEPOLIA]]),
  };
  config = await resolveConfig({ db, chains });
});

afterEach(async () => {
  await truncateAll();
});

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
    chainId: BASE_SEPOLIA.id,
    token: mock.address,
    amount: 1_500_000n,
    recipient: '0x0000000000000000000000000000000000000001',
    expiresIn: 1800,
    ...overrides,
  };
}
describe('confirmPayment - happy path', () => {
  it('confirms with exact transfer', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId));
    const hash = await sendTransfer(mock, payment.recipient, payment.amount);

    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBeNull();
    expect(result.payment.status).toBe('confirmed');

    const evtRows = await db.select().from(events).where(eq(events.paymentId, payment.id));
    const types = evtRows.map((r) => r.type).sort();
    expect(types).toEqual(['payment.confirmed', 'payment.created', 'payment.processing']);

    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, payment.id));
    expect(txRows).toHaveLength(1);
    expect(txRows[0]!.status).toBe('verified');
    expect(txRows[0]!.hash).toBe(hash);
    expect(txRows[0]!.amount).toBe('1500000');
  });

  it('transitions to underpaid when transfer is short', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId, { amount: 2_000_000n }));
    const hash = await sendTransfer(mock, payment.recipient, 1_500_000n);

    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBeNull();
    expect(result.payment.status).toBe('underpaid');

    const evtRows = await db.select().from(events).where(eq(events.paymentId, payment.id));
    expect(evtRows.some((r) => r.type === 'payment.underpaid')).toBe(true);
  });

  it('transitions to overpaid when transfer is high', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId, { amount: 1_000_000n }));
    const hash = await sendTransfer(mock, payment.recipient, 2_000_000n);

    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBeNull();
    expect(result.payment.status).toBe('overpaid');
  });
});

describe('confirmPayment - rejected attempts', () => {
  it('rejects a transfer to the wrong recipient', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId));
    const hash = await sendTransfer(
      mock,
      '0x0000000000000000000000000000000000000099',
      payment.amount,
    );

    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBe('TRANSACTION_WRONG_RECIPIENT');
    expect(result.payment.status).toBe('pending');

    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, payment.id));
    expect(txRows).toHaveLength(1);
    expect(txRows[0]!.status).toBe('rejected');

    const evtRows = await db.select().from(events).where(eq(events.paymentId, payment.id));
    const types = evtRows.map((r) => r.type);
    expect(types).not.toContain('payment.confirmed');
  });

  it('rejects a reverted transaction', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId));
    const hash = await sendRevertingTransfer(mock, payment.recipient, 999_999_999_999_999n);

    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBe('TRANSACTION_REVERTED');
    expect(result.payment.status).toBe('pending');
  });

  it('rejects a nonexistent hash', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId));
    const fakeHash =
      '0x0000000000000000000000000000000000000000000000000000000000000099' as `0x${string}`;

    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: fakeHash,
    });

    expect(result.error).toBe('TRANSACTION_NOT_FOUND');
    expect(result.payment.status).toBe('pending');
  });
});

describe('confirmPayment - idempotency and isolation', () => {
  it('returns terminal state on second confirm', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId));
    const hash = await sendTransfer(mock, payment.recipient, payment.amount);

    await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    const eventsBefore = await db.select().from(events).where(eq(events.paymentId, payment.id));
    const attemptsBefore = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, payment.id));

    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBeNull();
    expect(result.payment.status).toBe('confirmed');

    const eventsAfter = await db.select().from(events).where(eq(events.paymentId, payment.id));
    const attemptsAfter = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, payment.id));
    expect(eventsAfter.length).toBe(eventsBefore.length);
    expect(attemptsAfter.length).toBe(attemptsBefore.length);
  });

  it('throws PAYMENT_NOT_FOUND for another app payment', async () => {
    const appA = await insertApp('app-a');
    const appB = await insertApp('app-b');
    const payment = await createPayment(config, makeInput(appA));
    const hash = await sendTransfer(mock, payment.recipient, payment.amount);

    try {
      await confirmPayment(config, {
        paymentId: payment.id,
        applicationId: appB,
        transactionHash: hash,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('PAYMENT_NOT_FOUND');
    }

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row!.status).toBe('pending');
    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, payment.id));
    expect(txRows).toHaveLength(0);
  });

  it('returns PAYMENT_EXPIRED when confirming past expiry', async () => {
    const appId = await insertApp();
    const createAt = new Date('2025-06-01T12:00:00Z');
    const createConfig = await resolveConfig({
      db,
      chains: config.chains,
      clock: () => createAt,
    });
    const payment = await createPayment(createConfig, makeInput(appId, { expiresIn: 60 }));

    const laterConfig = await resolveConfig({
      db,
      chains: config.chains,
      clock: () => new Date('2025-06-01T12:05:00Z'),
    });
    const hash = await sendTransfer(mock, payment.recipient, payment.amount);

    const result = await confirmPayment(laterConfig, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBe('PAYMENT_EXPIRED');
    expect(result.payment.status).toBe('expired');

    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, payment.id));
    expect(txRows).toHaveLength(0);
  });

  it('cancelled payment returns terminal state without error', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId));
    await cancelPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
    });

    const hash = await sendTransfer(mock, payment.recipient, payment.amount);
    const result = await confirmPayment(config, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(result.error).toBeNull();
    expect(result.payment.status).toBe('cancelled');
  });

  it('rejects a hash already processed by another payment', async () => {
    const appId = await insertApp();
    const paymentA = await createPayment(config, makeInput(appId, { reference: 'A' }));
    const paymentB = await createPayment(config, makeInput(appId, { reference: 'B' }));
    const hash = await sendTransfer(mock, paymentA.recipient, paymentA.amount);

    const resultA = await confirmPayment(config, {
      paymentId: paymentA.id,
      applicationId: appId,
      transactionHash: hash,
    });
    expect(resultA.payment.status).toBe('confirmed');

    const resultB = await confirmPayment(config, {
      paymentId: paymentB.id,
      applicationId: appId,
      transactionHash: hash,
    });

    expect(resultB.error).toBe('TRANSACTION_ALREADY_PROCESSED');
    expect(resultB.payment.status).toBe('pending');

    const allTx = await db.select().from(transactions);
    expect(allTx).toHaveLength(1);
    expect(allTx[0]!.paymentId).toBe(paymentA.id);
  });
});

describe('confirmPayment - RPC failure handling', () => {
  it('payment returns to pending when RPC is unreachable', async () => {
    const appId = await insertApp();
    const payment = await createPayment(config, makeInput(appId));

    const deadConfig = await resolveConfig({
      db,
      chains: {
        chains: new Map([
          [
            BASE_SEPOLIA.id,
            {
              ...config.chains.chains.get(BASE_SEPOLIA.id)!,
              rpc: 'http://localhost:1',
            },
          ],
        ]),
      },
    });

    const result = await confirmPayment(deadConfig, {
      paymentId: payment.id,
      applicationId: appId,
      transactionHash: ('0x' + 'a'.repeat(64)) as `0x${string}`,
    });

    expect(result.error).toBe('TRANSACTION_RPC_FAILURE');
    expect(result.payment.status).toBe('pending');

    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paymentId, payment.id));
    expect(txRows).toHaveLength(0);
  });
});
