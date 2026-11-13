import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createClient, type Client, type Database } from '../client.ts';
import {
  applications,
  deliveries,
  events,
  payments,
  transactions,
  webhooks,
} from '../schema/index.ts';

let client: Client;
let db: Database;

beforeAll(() => {
  client = createClient(process.env.DATABASE_URL as string);
  db = client.db;
});

afterAll(async () => {
  await client.close();
});

afterEach(async () => {
  // TRUNCATE with CASCADE in one statement. Order is irrelevant because
  // CASCADE follows FK dependencies automatically.
  await db.execute(
    sql`TRUNCATE deliveries, events, transactions, payments, webhooks, applications RESTART IDENTITY CASCADE`,
  );
});

async function insertApp(name = 'test-app'): Promise<string> {
  const [row] = await db
    .insert(applications)
    .values({ name, keyHash: 'hashed-' + Math.random().toString(36) })
    .returning({ id: applications.id });
  if (!row) throw new Error('Failed to insert application');
  return row.id;
}

async function insertPayment(
  applicationId: string,
  overrides: Partial<typeof payments.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(payments)
    .values({
      applicationId,
      chainId: 84532,
      tokenAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      amount: '1500000',
      recipient: '0x0000000000000000000000000000000000000001',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    })
    .returning({ id: payments.id });
  if (!row) throw new Error('Failed to insert payment');
  return row.id;
}

async function insertTx(paymentId: string, chainId: number, hash: string): Promise<string> {
  const [row] = await db
    .insert(transactions)
    .values({
      paymentId,
      chainId,
      hash,
      recipient: '0x0000000000000000000000000000000000000001',
      tokenAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      amount: '1500000',
      status: 'verified',
    })
    .returning({ id: transactions.id });
  if (!row) throw new Error('Failed to insert transaction');
  return row.id;
}

describe('payments FK: application_id must exist', () => {
  it('rejects a payment with a nonexistent application_id', async () => {
    const fakeAppId = '00000000-0000-4000-8000-000000000000';
    await expect(insertPayment(fakeAppId)).rejects.toThrow(
      /foreign key constraint|violates foreign key/i,
    );
  });

  it('accepts a payment with a real application_id', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);
    expect(paymentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe('transactions UNIQUE(chain_id, hash) - the money-safety constraint', () => {
  it('rejects a second transaction with the same (chain_id, hash)', async () => {
    const appId = await insertApp();
    const p1 = await insertPayment(appId);
    const p2 = await insertPayment(appId);
    const sharedHash = '0x' + 'a'.repeat(64);

    await insertTx(p1, 84532, sharedHash);

    await expect(insertTx(p2, 84532, sharedHash)).rejects.toThrow(
      /duplicate key value violates unique constraint|transactions_chain_hash_unique/i,
    );
  });

  it('allows the same hash on a different chain_id', async () => {
    const appId = await insertApp();
    const p1 = await insertPayment(appId);
    const p2 = await insertPayment(appId, { chainId: 8453 });
    const sharedHash = '0x' + 'b'.repeat(64);

    await insertTx(p1, 84532, sharedHash);
    const tx2 = await insertTx(p2, 8453, sharedHash);
    expect(tx2).toMatch(/^[0-9a-f]{8}-/);
  });
});

describe('deliveries UNIQUE(webhook_id, event_id) - idempotency guard', () => {
  it('rejects a second delivery for the same (webhook, event)', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);

    const [hook] = await db
      .insert(webhooks)
      .values({
        applicationId: appId,
        endpoint: 'https://example.com/hook',
        secretHash: 'hash-of-secret',
      })
      .returning({ id: webhooks.id });
    if (!hook) throw new Error('Failed to insert webhook');

    const [evt] = await db
      .insert(events)
      .values({
        applicationId: appId,
        paymentId,
        type: 'payment.created',
        payload: { payment: { id: paymentId } },
      })
      .returning({ id: events.id });
    if (!evt) throw new Error('Failed to insert event');

    await db.insert(deliveries).values({ webhookId: hook.id, eventId: evt.id });

    await expect(
      db.insert(deliveries).values({ webhookId: hook.id, eventId: evt.id }),
    ).rejects.toThrow(
      /duplicate key value violates unique constraint|deliveries_webhook_event_unique/i,
    );
  });
});

describe('ON DELETE behaviors', () => {
  it('cannot delete an application that owns a payment (RESTRICT)', async () => {
    const appId = await insertApp();
    await insertPayment(appId);

    await expect(db.delete(applications).where(eq(applications.id, appId))).rejects.toThrow(
      /foreign key|violates/i,
    );
  });

  it('cannot delete a payment that owns a transaction (RESTRICT)', async () => {
    const appId = await insertApp();
    const paymentId = await insertPayment(appId);
    await insertTx(paymentId, 84532, '0x' + 'c'.repeat(64));

    await expect(db.delete(payments).where(eq(payments.id, paymentId))).rejects.toThrow(
      /foreign key|violates/i,
    );
  });

  it('deleting an application CASCADEs to webhooks', async () => {
    const appId = await insertApp();
    const [hook] = await db
      .insert(webhooks)
      .values({
        applicationId: appId,
        endpoint: 'https://example.com/hook',
        secretHash: 'hash',
      })
      .returning({ id: webhooks.id });
    if (!hook) throw new Error('Failed to insert webhook');

    await db.delete(applications).where(eq(applications.id, appId));

    const remaining = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(remaining).toHaveLength(0);
  });
});
