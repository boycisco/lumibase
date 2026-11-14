/**
 * Webhook delivery worker.
 *
 * Claim -> commit -> HTTP -> record. No DB lock is held during network I/O,
 * so slow endpoints never block other work.
 *
 * Crash safety:
 *   - Claim: atomic UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED).
 *     Sets status='processing' and lease_expires_at = now + 60s. Transaction
 *     commits BEFORE fetch runs.
 *   - Deliver: fetch with a hard 10s timeout. No DB connection held.
 *   - Record: single UPDATE per delivery sets terminal status or schedules
 *     the next attempt.
 *   - Recovery: the claim query picks up any row where
 *     status='processing' AND lease_expires_at < now(). A crashed worker's
 *     claims are reaped on the next tick.
 *
 * Retry schedule (specs/payments/events.json section 14):
 *   attempt 1: immediate
 *   attempt 2: +30s
 *   attempt 3: +2min
 *   attempt 4: +10min
 *   attempt 5: +30min
 *   attempt 6+: status='failed' (terminal)
 *
 * Outcome classification:
 *   2xx                        -> delivered (terminal)
 *   4xx (except 429)           -> failed (permanent; endpoint rejected it)
 *   3xx                        -> failed (redirects never followed; SSRF)
 *   429, 5xx, network, timeout -> pending (retry per schedule)
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { deliveries, events, webhooks } from '@lumibase/database';
import type { Database } from '@lumibase/database';
import { decryptSecret, formatSignatureHeader, signBody } from './crypto.ts';

export const MAX_ATTEMPTS = 5;
export const RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 600_000, 1_800_000];
export const HTTP_TIMEOUT_MS = 10_000;
export const LEASE_SECONDS = 60;
export const BODY_LIMIT_BYTES = 8 * 1024;
export const DEFAULT_BATCH = 10;
export const DEFAULT_INTERVAL_MS = 1_000;

export interface WorkerConfig {
  readonly db: Database;
  readonly masterSecret: string;
  readonly clock: () => Date;
}

export interface RunOnceOptions {
  readonly batchSize?: number;
  readonly httpTimeoutMs?: number;
}

export interface TickResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly failed: number;
}

interface ClaimedDelivery {
  readonly id: string;
  readonly attempts: number;
  readonly endpoint: string;
  readonly secretCiphertext: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly eventPayload: Record<string, unknown>;
  readonly eventCreatedAt: Date;
}

interface DeliveryOutcome {
  readonly status: 'delivered' | 'pending' | 'failed';
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly statusCode: number | null;
  readonly error: string | null;
}

/**
 * Claim up to `limit` deliveries and fetch their webhook + event rows.
 * The UPDATE holds row locks only for the duration of this transaction;
 * HTTP runs after it commits.
 */
async function claimAndFetch(config: WorkerConfig, limit: number): Promise<ClaimedDelivery[]> {
  return await config.db.transaction(async (tx) => {
    const claimed = await tx
      .update(deliveries)
      .set({
        status: 'processing',
        leaseExpiresAt: sql`now() + interval '60 seconds'`,
        updatedAt: sql`now()`,
      })
      .where(
        sql`id IN (
          SELECT id FROM deliveries
          WHERE (
            (status = 'pending' AND next_attempt_at <= now())
            OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
          )
          ORDER BY next_attempt_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )`,
      )
      .returning({ id: deliveries.id });

    if (claimed.length === 0) return [];

    const ids = claimed.map((c) => c.id);

    const enriched = await tx
      .select({
        id: deliveries.id,
        attempts: deliveries.attempts,
        endpoint: webhooks.endpoint,
        secretCiphertext: webhooks.secretCiphertext,
        eventId: events.id,
        eventType: events.type,
        eventPayload: events.payload,
        eventCreatedAt: events.createdAt,
      })
      .from(deliveries)
      .innerJoin(webhooks, eq(webhooks.id, deliveries.webhookId))
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .where(inArray(deliveries.id, ids));

    return enriched.map((r) => ({
      id: r.id,
      attempts: r.attempts,
      endpoint: r.endpoint,
      secretCiphertext: r.secretCiphertext,
      eventId: r.eventId,
      eventType: r.eventType,
      eventPayload: r.eventPayload as Record<string, unknown>,
      eventCreatedAt: r.eventCreatedAt,
    }));
  });
}

/**
 * Read at most `limit` bytes from a Response body, then cancel the reader.
 * This is an ACTUAL byte limit — a slow or unbounded response cannot cause
 * us to buffer more than `limit` bytes, and the cancel stops the transfer.
 */
async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - total;
      if (value.length <= remaining) {
        chunks.push(Buffer.from(value));
        total += value.length;
      } else {
        chunks.push(Buffer.from(value.subarray(0, remaining)));
        total += remaining;
        break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream already ended or errored — safe to ignore
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function computeOutcome(
  previousAttempts: number,
  response: Response | null,
  error: string | null,
  now: Date,
): DeliveryOutcome {
  const attempts = previousAttempts + 1;

  if (response && response.status >= 200 && response.status < 300) {
    return {
      status: 'delivered',
      attempts,
      nextAttemptAt: now,
      statusCode: response.status,
      error: null,
    };
  }

  const statusCode = response?.status ?? null;

  const is3xx = statusCode !== null && statusCode >= 300 && statusCode < 400;
  const is4xx = statusCode !== null && statusCode >= 400 && statusCode < 500;
  const is429 = statusCode === 429;

  if (is3xx || (is4xx && !is429)) {
    return { status: 'failed', attempts, nextAttemptAt: now, statusCode, error };
  }

  if (attempts >= MAX_ATTEMPTS) {
    return { status: 'failed', attempts, nextAttemptAt: now, statusCode, error };
  }

  const delayMs = RETRY_DELAYS_MS[attempts - 1]!;
  return {
    status: 'pending',
    attempts,
    nextAttemptAt: new Date(now.getTime() + delayMs),
    statusCode,
    error,
  };
}

async function deliverOne(
  config: WorkerConfig,
  delivery: ClaimedDelivery,
  httpTimeoutMs: number,
): Promise<DeliveryOutcome> {
  const now = config.clock();
  const secret = decryptSecret(delivery.secretCiphertext, config.masterSecret);

  const body = JSON.stringify({
    id: delivery.eventId,
    type: delivery.eventType,
    createdAt: delivery.eventCreatedAt.toISOString(),
    data: delivery.eventPayload,
  });

  const timestamp = Math.floor(now.getTime() / 1000);
  const signature = signBody(secret, timestamp, body);
  const signatureHeader = formatSignatureHeader(timestamp, signature);

  let response: Response | null = null;
  let error: string | null = null;

  try {
    response = await fetch(delivery.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LumiBase-Signature': signatureHeader,
        'X-LumiBase-Event': delivery.eventType,
        'User-Agent': 'LumiBase-Webhook/0.1.0',
      },
      body,
      signal: AbortSignal.timeout(httpTimeoutMs),
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      await readLimited(response, BODY_LIMIT_BYTES);
      error = `Redirect not followed (status ${response.status})`;
    } else if (response.status < 200 || response.status >= 300) {
      const respBody = await readLimited(response, BODY_LIMIT_BYTES);
      const trimmed = respBody.slice(0, 200).replace(/\s+/g, ' ');
      error = trimmed ? `HTTP ${response.status}: ${trimmed}` : `HTTP ${response.status}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error = `Network error: ${msg.slice(0, 200)}`;
    response = null;
  }

  return computeOutcome(delivery.attempts, response, error, now);
}

async function recordOutcomes(
  config: WorkerConfig,
  outcomes: ReadonlyArray<{ id: string; outcome: DeliveryOutcome }>,
): Promise<void> {
  if (outcomes.length === 0) return;
  const now = config.clock();
  await config.db.transaction(async (tx) => {
    for (const { id, outcome } of outcomes) {
      await tx
        .update(deliveries)
        .set({
          status: outcome.status,
          attempts: outcome.attempts,
          nextAttemptAt: outcome.nextAttemptAt,
          lastStatusCode: outcome.statusCode,
          lastError: outcome.error,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(deliveries.id, id));
    }
  });
}

export async function runWorkerOnce(
  config: WorkerConfig,
  opts: RunOnceOptions = {},
): Promise<TickResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const httpTimeoutMs = opts.httpTimeoutMs ?? HTTP_TIMEOUT_MS;

  const claimed = await claimAndFetch(config, batchSize);
  if (claimed.length === 0) {
    return { claimed: 0, delivered: 0, retried: 0, failed: 0 };
  }

  const outcomes: Array<{ id: string; outcome: DeliveryOutcome }> = [];
  for (const delivery of claimed) {
    const outcome = await deliverOne(config, delivery, httpTimeoutMs);
    outcomes.push({ id: delivery.id, outcome });
  }

  await recordOutcomes(config, outcomes);

  let delivered = 0;
  let retried = 0;
  let failed = 0;
  for (const { outcome } of outcomes) {
    if (outcome.status === 'delivered') delivered += 1;
    else if (outcome.status === 'pending') retried += 1;
    else failed += 1;
  }
  return {
    claimed: claimed.length,
    delivered,
    retried,
    failed,
  };
}

export interface RunLoopOptions extends RunOnceOptions {
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
  readonly onTick?: (result: TickResult) => void;
  readonly onError?: (err: unknown) => void;
}

export async function runWorker(config: WorkerConfig, opts: RunLoopOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const signal = opts.signal;

  while (!signal?.aborted) {
    try {
      const result = await runWorkerOnce(config, opts);
      opts.onTick?.(result);
    } catch (err) {
      opts.onError?.(err);
    }
    if (signal?.aborted) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, intervalMs);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Daemon: the process-level wrapper around runWorker.
//
// `startDaemon` is the testable primitive � takes deps + AbortSignal, returns
// { stop, done }. Tests call it directly.
//
// `main` is the process entry point. It loads real config from env, opens the
// DB pool, wires SIGINT/SIGTERM to graceful shutdown, and blocks on `done`.
//
// The `import.meta.url === pathToFileURL(process.argv[1]).href` guard ensures
// main() runs only when worker.ts (or dist/worker.js) is the actual entry
// module, never when tests import { runWorkerOnce } from this file.
// ---------------------------------------------------------------------------

import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { createClient } from '@lumibase/database';
import { loadApiConfig } from './config.ts';
import type { ApiConfig } from './config.ts';

export interface DaemonDeps {
  readonly config: ApiConfig;
  readonly db: Database;
  readonly masterSecret: string;
  readonly logger: pino.Logger;
}

export interface StartDaemonOptions extends RunOnceOptions {
  readonly intervalMs?: number;
  readonly onTick?: (result: TickResult) => void;
  readonly onError?: (err: unknown) => void;
}

export interface RunningDaemon {
  readonly stop: () => void;
  readonly done: Promise<void>;
}

export function startDaemon(deps: DaemonDeps, opts: StartDaemonOptions = {}): RunningDaemon {
  const controller = new AbortController();
  const intervalMs = opts.intervalMs ?? deps.config.workerIntervalMs;

  const done = runWorker(
    {
      db: deps.db,
      masterSecret: deps.masterSecret,
      clock: () => new Date(),
    },
    {
      intervalMs,
      batchSize: opts.batchSize,
      httpTimeoutMs: opts.httpTimeoutMs,
      signal: controller.signal,
      onTick:
        opts.onTick ??
        ((result) => {
          if (result.claimed > 0) {
            deps.logger.info(
              {
                claimed: result.claimed,
                delivered: result.delivered,
                retried: result.retried,
                failed: result.failed,
              },
              'worker_tick',
            );
          }
        }),
      onError:
        opts.onError ??
        ((err) => {
          deps.logger.error({ err }, 'worker_error');
        }),
    },
  );

  return {
    stop: () => controller.abort(),
    done,
  };
}

async function main(): Promise<void> {
  const config = loadApiConfig();

  if (!config.webhookSecret) {
    console.error('WEBHOOK_SECRET is not set; worker cannot sign webhook deliveries.');
    process.exit(1);
  }

  const logger = pino(
    config.nodeEnv === 'development'
      ? {
          level: config.logLevel,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        }
      : { level: config.logLevel },
  );

  const client = createClient(config.databaseUrl);
  const daemon = startDaemon({
    config,
    db: client.db,
    masterSecret: config.webhookSecret,
    logger,
  });

  logger.info({ intervalMs: config.workerIntervalMs }, 'worker_starting');

  // Signal handlers only signal the daemon. `main()` owns the exit path so
  // we call client.close() exactly once, regardless of whether the loop
  // stopped via signal, error, or natural completion.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "worker_stopping");
    daemon.stop();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await daemon.done;
    await client.close();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "worker_crashed");
    await client.close().catch(() => {});
    process.exit(1);
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err) => {
    console.error('Fatal worker startup error:', err);
    process.exit(1);
  });
}
