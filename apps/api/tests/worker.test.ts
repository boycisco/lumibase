import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { applications, deliveries, events, payments, webhooks } from '@lumibase/database';
import { BASE_SEPOLIA, BASE_SEPOLIA_USDC, type ResolvedChain } from '@lumibase/network';
import { encryptSecret, generateSecret, verifySignature } from '../src/crypto.ts';
import { runWorkerOnce, MAX_ATTEMPTS } from '../src/worker.ts';
import type { WorkerConfig, RunOnceOptions } from '../src/worker.ts';
import { db, truncateAll } from './setup.ts';

const SEPOLIA: ResolvedChain = { ...BASE_SEPOLIA, rpc: 'http://localhost:1' };
const MASTER = process.env.WEBHOOK_SECRET!;

let server: http.Server;
let port = 0;
let handler: (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => Promise<void> | void;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks).toString('utf8');
    await handler(req, res, body);
  });
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

interface SeedOpts {
  attempts?: number;
  nextAttemptAt?: Date;
  status?: 'pending' | 'processing';
  leaseExpiresAt?: Date | null;
}

interface SeedResult {
  deliveryId: string;
  eventId: string;
  webhookId: string;
  applicationId: string;
  plaintextSecret: string;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const [app] = await db
    .insert(applications)
    .values({ name: 'worker-test', keyHash: 'h-' + Math.random().toString(36) })
    .returning({ id: applications.id });
  if (!app) throw new Error('app seed failed');

  const plaintextSecret = generateSecret();
  const secretCiphertext = encryptSecret(plaintextSecret, MASTER);

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
      payload: { payment: { id: payment.id, status: 'pending' } },
    })
    .returning({ id: events.id });
  if (!evt) throw new Error('event seed failed');

  const [del] = await db
    .insert(deliveries)
    .values({
      webhookId: hook.id,
      eventId: evt.id,
      status: opts.status ?? 'pending',
      attempts: opts.attempts ?? 0,
      nextAttemptAt: opts.nextAttemptAt ?? new Date(Date.now() - 1000),
      leaseExpiresAt: opts.leaseExpiresAt ?? null,
    })
    .returning({ id: deliveries.id });
  if (!del) throw new Error('delivery seed failed');

  return {
    deliveryId: del.id,
    eventId: evt.id,
    webhookId: hook.id,
    applicationId: app.id,
    plaintextSecret,
  };
}

function makeConfig(): WorkerConfig {
  return { db, masterSecret: MASTER, clock: () => new Date() };
}

async function getDelivery(id: string) {
  const [row] = await db.select().from(deliveries).where(eq(deliveries.id, id));
  return row;
}

describe('runWorkerOnce - success', () => {
  it('delivers a pending delivery with a 2xx response', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    const { deliveryId } = await seed();
    const result = await runWorkerOnce(makeConfig());
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);

    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('delivered');
    expect(row!.attempts).toBe(1);
    expect(row!.lastStatusCode).toBe(200);
    expect(row!.lastError).toBeNull();
    expect(row!.leaseExpiresAt).toBeNull();
  });

  it('does not pick up deliveries scheduled in the future', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    const future = new Date(Date.now() + 3_600_000);
    const { deliveryId } = await seed({ nextAttemptAt: future });
    const result = await runWorkerOnce(makeConfig());
    expect(result.claimed).toBe(0);

    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(0);
  });

  it('signs the request with a valid HMAC header', async () => {
    let capturedBody = '';
    let capturedHeader = '';
    handler = (req, res, body) => {
      capturedBody = body;
      capturedHeader = String(req.headers['x-lumibase-signature'] ?? '');
      res.statusCode = 200;
      res.end('ok');
    };
    const { plaintextSecret } = await seed();
    await runWorkerOnce(makeConfig());

    expect(capturedHeader).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature(plaintextSecret, capturedHeader, capturedBody)).toBe(true);

    const parsed = JSON.parse(capturedBody);
    expect(parsed).toMatchObject({ type: 'payment.created' });
    expect(parsed.id).toMatch(/^[0-9a-f]{8}-/);
    expect(parsed.createdAt).toMatch(/Z$/);
    expect(parsed.data).toBeDefined();
  });

  it('uses the event type as the X-LumiBase-Event header', async () => {
    let captured = '';
    handler = (req, res) => {
      captured = String(req.headers['x-lumibase-event'] ?? '');
      res.statusCode = 200;
      res.end('ok');
    };
    await seed();
    await runWorkerOnce(makeConfig());
    expect(captured).toBe('payment.created');
  });
});

describe('runWorkerOnce - retryable failures', () => {
  it('retries on 500 with next attempt scheduled in the future', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('oops');
    };
    const { deliveryId } = await seed();
    const result = await runWorkerOnce(makeConfig());
    expect(result.retried).toBe(1);

    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(1);
    expect(row!.lastStatusCode).toBe(500);
    expect(row!.lastError).toContain('500');
    const delta = row!.nextAttemptAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(25_000);
    expect(delta).toBeLessThan(35_000);
  });

  it('retries on 429', async () => {
    handler = (_req, res) => {
      res.statusCode = 429;
      res.end('slow down');
    };
    const { deliveryId } = await seed();
    await runWorkerOnce(makeConfig());
    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(1);
    expect(row!.lastStatusCode).toBe(429);
  });

  it('times out on a hanging server and retries', async () => {
    handler = () => {
      // Never respond — AbortSignal.timeout will fire
    };
    const { deliveryId } = await seed();
    const opts: RunOnceOptions = { httpTimeoutMs: 200 };
    const result = await runWorkerOnce(makeConfig(), opts);
    expect(result.retried).toBe(1);

    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(1);
    expect(row!.lastStatusCode).toBeNull();
    expect(row!.lastError).toContain('Network error');
  });
});

describe('runWorkerOnce - permanent failures', () => {
  it('fails immediately on 400', async () => {
    handler = (_req, res) => {
      res.statusCode = 400;
      res.end('bad');
    };
    const { deliveryId } = await seed();
    const result = await runWorkerOnce(makeConfig());
    expect(result.failed).toBe(1);

    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('failed');
    expect(row!.attempts).toBe(1);
    expect(row!.lastStatusCode).toBe(400);
  });

  it('fails on 404', async () => {
    handler = (_req, res) => {
      res.statusCode = 404;
      res.end('gone');
    };
    const { deliveryId } = await seed();
    await runWorkerOnce(makeConfig());
    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('failed');
  });

  it('does not follow redirects (SSRF protection)', async () => {
    handler = (req, res) => {
      if (req.url === '/hook') {
        res.statusCode = 302;
        res.setHeader('location', 'http://169.254.169.254/metadata');
        res.end();
      } else {
        res.statusCode = 200;
        res.end('redirect was followed!');
      }
    };
    const { deliveryId } = await seed();
    await runWorkerOnce(makeConfig());
    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('failed');
    expect(row!.lastError).toContain('Redirect');
  });

  it('fails permanently after MAX_ATTEMPTS with 5xx', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('err');
    };
    const { deliveryId } = await seed({ attempts: MAX_ATTEMPTS - 1 });
    const result = await runWorkerOnce(makeConfig());
    expect(result.failed).toBe(1);
    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('failed');
    expect(row!.attempts).toBe(MAX_ATTEMPTS);
  });
});

describe('runWorkerOnce - crash recovery', () => {
  it('reclaims a processing delivery whose lease has expired', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    const { deliveryId } = await seed({
      status: 'processing',
      attempts: 1,
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    const result = await runWorkerOnce(makeConfig());
    expect(result.claimed).toBe(1);
    expect(result.delivered).toBe(1);

    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('delivered');
    expect(row!.attempts).toBe(2);
  });

  it('does not steal a processing delivery whose lease is active', async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
    const { deliveryId } = await seed({
      status: 'processing',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const result = await runWorkerOnce(makeConfig());
    expect(result.claimed).toBe(0);

    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('processing');
    expect(row!.attempts).toBe(0);
  });
});

describe('runWorkerOnce - concurrency', () => {
  it('does not double-deliver when run twice concurrently', async () => {
    let hitCount = 0;
    handler = (_req, res) => {
      hitCount += 1;
      res.statusCode = 200;
      res.end('ok');
    };
    const { deliveryId } = await seed();

    await Promise.all([runWorkerOnce(makeConfig()), runWorkerOnce(makeConfig())]);

    expect(hitCount).toBe(1);
    const row = await getDelivery(deliveryId);
    expect(row!.status).toBe('delivered');
    expect(row!.attempts).toBe(1);
  });
});
