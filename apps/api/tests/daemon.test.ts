import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { applications, deliveries, events, payments, webhooks } from '@lumibase/database';
import { BASE_SEPOLIA, BASE_SEPOLIA_USDC, type ResolvedChain } from '@lumibase/network';
import { encryptSecret, generateSecret } from '../src/crypto.ts';
import { loadApiConfig } from '../src/config.ts';
import { startDaemon } from '../src/worker.ts';
import type { TickResult } from '../src/worker.ts';
import { db, truncateAll } from './setup.ts';

const SEPOLIA: ResolvedChain = { ...BASE_SEPOLIA, rpc: 'http://localhost:1' };
const MASTER = process.env.WEBHOOK_SECRET!;
const silent = pino({ level: 'silent' });
const config = loadApiConfig(process.env);

let server: http.Server;
let port = 0;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr === 'object' && addr !== null) port = addr.port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(async () => {
  await truncateAll();
});

function url(): string {
  return `http://127.0.0.1:${port}/hook`;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function seedDelivery(): Promise<{ deliveryId: string }> {
  const [app] = await db
    .insert(applications)
    .values({ name: 'daemon-test', keyHash: 'h-' + Math.random().toString(36) })
    .returning({ id: applications.id });
  if (!app) throw new Error('app seed failed');

  const secretCiphertext = encryptSecret(generateSecret(), MASTER);

  const [hook] = await db
    .insert(webhooks)
    .values({
      applicationId: app.id,
      endpoint: url(),
      secretCiphertext,
      enabled: true,
    })
    .returning({ id: webhooks.id });
  if (!hook) throw new Error('webhook seed failed');

  const [payment] = await db
    .insert(payments)
    .values({
      applicationId: app.id,
      chainId: SEPOLIA.id,
      tokenAddress: BASE_SEPOLIA_USDC.address.toLowerCase(),
      amount: '1500000',
      recipient: '0x0000000000000000000000000000000000000001',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: payments.id });
  if (!payment) throw new Error('payment seed failed');

  const [evt] = await db
    .insert(events)
    .values({
      applicationId: app.id,
      paymentId: payment.id,
      type: 'payment.created',
      payload: { test: true },
    })
    .returning({ id: events.id });
  if (!evt) throw new Error('event seed failed');

  const [del] = await db
    .insert(deliveries)
    .values({
      webhookId: hook.id,
      eventId: evt.id,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1_000),
    })
    .returning({ id: deliveries.id });
  if (!del) throw new Error('delivery seed failed');

  return { deliveryId: del.id };
}

async function getDelivery(id: string) {
  const [row] = await db.select().from(deliveries).where(eq(deliveries.id, id));
  return row;
}
describe('startDaemon', () => {
  it('processes a delivery and then stops cleanly', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    const { deliveryId } = await seedDelivery();

    const ticks: TickResult[] = [];
    const daemon = startDaemon(
      { config, db, masterSecret: MASTER, logger: silent },
      { intervalMs: 50, onTick: (r) => ticks.push(r), onError: () => {} },
    );

    await waitFor(async () => {
      const row = await getDelivery(deliveryId);
      return row?.status === 'delivered';
    }, 5_000);

    daemon.stop();
    await daemon.done;

    expect(ticks.some((t) => t.delivered >= 1)).toBe(true);
    const row = await getDelivery(deliveryId);
    expect(row?.status).toBe('delivered');
  });

  it('resolves done promptly after stop() with no pending work', async () => {
    const daemon = startDaemon(
      { config, db, masterSecret: MASTER, logger: silent },
      { intervalMs: 50, onTick: () => {}, onError: () => {} },
    );
    await new Promise<void>((r) => setTimeout(r, 120));
    daemon.stop();
    const start = Date.now();
    await daemon.done;
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('fires onTick even with an empty queue', async () => {
    let tickCount = 0;
    const daemon = startDaemon(
      { config, db, masterSecret: MASTER, logger: silent },
      {
        intervalMs: 30,
        onTick: () => {
          tickCount += 1;
        },
        onError: () => {},
      },
    );
    await new Promise<void>((r) => setTimeout(r, 200));
    daemon.stop();
    await daemon.done;
    expect(tickCount).toBeGreaterThanOrEqual(2);
  });

  it('surfaces DB errors via onError and continues running', async () => {
    const failingDb = {
      transaction: () => {
        throw new Error('simulated db outage');
      },
    } as unknown as typeof db;

    let errorCount = 0;
    let tickCount = 0;
    const daemon = startDaemon(
      { config, db: failingDb, masterSecret: MASTER, logger: silent },
      {
        intervalMs: 30,
        onTick: () => {
          tickCount += 1;
        },
        onError: () => {
          errorCount += 1;
        },
      },
    );

    await new Promise<void>((r) => setTimeout(r, 200));
    daemon.stop();
    await daemon.done;

    // Every iteration errored out before onTick could fire, so tickCount is 0.
    expect(errorCount).toBeGreaterThanOrEqual(1);
    expect(tickCount).toBe(0);
  });

  it('multiple stop() calls are idempotent', async () => {
    const daemon = startDaemon(
      { config, db, masterSecret: MASTER, logger: silent },
      { intervalMs: 50, onTick: () => {}, onError: () => {} },
    );
    await new Promise<void>((r) => setTimeout(r, 100));
    daemon.stop();
    daemon.stop();
    daemon.stop();
    await daemon.done;
    expect(true).toBe(true);
  });
});
