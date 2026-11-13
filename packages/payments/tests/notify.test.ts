import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applications, deliveries, events, payments, webhooks } from '@lumibase/database';
import {
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC,
  type NetworkConfig,
  type ResolvedChain,
} from '@lumibase/network';
import { createPayment, resolveConfig } from '../src/index.ts';
import type { ResolvedConfig } from '../src/index.ts';
import { recordEvent } from '../src/notify.ts';
import { db, truncateAll } from './setup.ts';

const SEPOLIA: ResolvedChain = {
  ...BASE_SEPOLIA,
  rpc: 'http://localhost:1',
};
const chains: NetworkConfig = { chains: new Map([[SEPOLIA.id, SEPOLIA]]) };

afterEach(async () => {
  await truncateAll();
});

async function makeConfig(): Promise<ResolvedConfig> {
  return resolveConfig({ db, chains });
}

async function insertApp(name = 'app'): Promise<string> {
  const [row] = await db
    .insert(applications)
    .values({ name, keyHash: 'h-' + Math.random().toString(36) })
    .returning({ id: applications.id });
  if (!row) throw new Error('Failed to insert application');
  return row.id;
}

async function insertPayment(applicationId: string): Promise<string> {
  const [row] = await db
    .insert(payments)
    .values({
      applicationId,
      chainId: SEPOLIA.id,
      tokenAddress: BASE_SEPOLIA_USDC.address.toLowerCase(),
      amount: '1500000',
      recipient: '0x0000000000000000000000000000000000000001',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: payments.id });
  if (!row) throw new Error('Failed to insert payment');
  return row.id;
}

async function insertWebhook(
  applicationId: string,
  endpoint: string,
  enabled = true,
): Promise<string> {
  const [row] = await db
    .insert(webhooks)
    .values({
      applicationId,
      endpoint,
      secretCiphertext: 'placeholder_ciphertext',
      enabled,
    })
    .returning({ id: webhooks.id });
  if (!row) throw new Error('Failed to insert webhook');
  return row.id;
}

async function emitTestEvent(
  config: ResolvedConfig,
  applicationId: string,
  paymentId: string,
  eventId: string,
  payload: Record<string, unknown> = { test: true },
): Promise<number> {
  return await config.db.transaction(async (tx) => {
    return await recordEvent(config, tx, {
      id: eventId,
      applicationId,
      paymentId,
      type: 'payment.created',
      payload,
      createdAt: config.clock(),
    });
  });
}

describe('recordEvent', () => {
  it('creates an event row but no deliveries when no webhooks exist', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);
    const config = await makeConfig();
    const eventId = '11111111-1111-4111-8111-111111111111';

    const count = await emitTestEvent(config, appId, paymentId, eventId);
    expect(count).toBe(0);

    const evtRows = await db.select().from(events).where(eq(events.id, eventId));
    expect(evtRows).toHaveLength(1);
    expect(evtRows[0]!.type).toBe('payment.created');

    const delRows = await db.select().from(deliveries).where(eq(deliveries.eventId, eventId));
    expect(delRows).toHaveLength(0);
  });

  it('creates one delivery per enabled webhook', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);
    await insertWebhook(appId, 'https://a.example.com/hook');
    await insertWebhook(appId, 'https://b.example.com/hook');
    await insertWebhook(appId, 'https://c.example.com/hook');
    const config = await makeConfig();
    const eventId = '33333333-3333-4333-8333-333333333333';

    const count = await emitTestEvent(config, appId, paymentId, eventId);
    expect(count).toBe(3);

    const delRows = await db.select().from(deliveries).where(eq(deliveries.eventId, eventId));
    expect(delRows).toHaveLength(3);
    for (const d of delRows) {
      expect(d.status).toBe('pending');
      expect(d.attempts).toBe(0);
      expect(d.lastStatusCode).toBeNull();
      expect(d.lastError).toBeNull();
    }
  });

  it('skips disabled webhooks', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);
    await insertWebhook(appId, 'https://enabled.example.com/hook', true);
    await insertWebhook(appId, 'https://disabled.example.com/hook', false);
    const config = await makeConfig();
    const eventId = '55555555-5555-4555-8555-555555555555';

    const count = await emitTestEvent(config, appId, paymentId, eventId);
    expect(count).toBe(1);
  });

  it('ignores webhooks owned by another application', async () => {
    const appA = await insertApp('app-a');
    const appB = await insertApp('app-b');
    const paymentId = await insertPayment(appA);
    await insertWebhook(appA, 'https://a.example.com/hook');
    await insertWebhook(appB, 'https://b.example.com/hook');
    const config = await makeConfig();
    const eventId = '77777777-7777-4777-8777-777777777777';

    const count = await emitTestEvent(config, appA, paymentId, eventId);
    expect(count).toBe(1);

    const [appAWebhook] = await db.select().from(webhooks).where(eq(webhooks.applicationId, appA));
    const delRows = await db.select().from(deliveries).where(eq(deliveries.eventId, eventId));
    expect(delRows).toHaveLength(1);
    expect(delRows[0]!.webhookId).toBe(appAWebhook!.id);
  });

  it('preserves the event payload verbatim', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);
    const config = await makeConfig();
    const eventId = '99999999-9999-4999-8999-999999999999';
    const payload = {
      payment: { id: 'abc', status: 'confirmed', amount: '1500000' },
      transaction: { hash: '0xabc', blockNumber: '12345' },
    };

    await emitTestEvent(config, appId, paymentId, eventId, payload);

    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row!.payload).toEqual(payload);
  });

  it('returns the number of deliveries created', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);
    await insertWebhook(appId, 'https://a.example.com/hook');
    await insertWebhook(appId, 'https://b.example.com/hook');
    const config = await makeConfig();

    const count = await emitTestEvent(
      config,
      appId,
      paymentId,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(count).toBe(2);
  });
});

describe('recordEvent - integration with createPayment', () => {
  it('schedules deliveries when a payment is created with webhooks present', async () => {
    const appId = await insertApp();
    await insertWebhook(appId, 'https://a.example.com/hook');
    await insertWebhook(appId, 'https://b.example.com/hook');
    await insertWebhook(appId, 'https://disabled.example.com/hook', false);

    const config = await makeConfig();

    const payment = await createPayment(config, {
      applicationId: appId,
      chainId: SEPOLIA.id,
      token: BASE_SEPOLIA_USDC.address,
      amount: 1_500_000n,
      recipient: '0x0000000000000000000000000000000000000001',
      expiresIn: 1800,
    });

    const evtRows = await db.select().from(events).where(eq(events.paymentId, payment.id));
    expect(evtRows).toHaveLength(1);
    expect(evtRows[0]!.type).toBe('payment.created');

    const delRows = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.eventId, evtRows[0]!.id));
    expect(delRows).toHaveLength(2);
    for (const d of delRows) {
      expect(d.status).toBe('pending');
    }
  });
});
