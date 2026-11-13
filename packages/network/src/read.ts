/**
 * Resilient read primitives for blockchain queries.
 *
 * Wraps viem PublicClient calls with:
 *   - a bounded retry loop for TRANSIENT errors only (network, timeout,
 *     rate limit, 5xx). A missing transaction is NOT an error — viem throws
 *     TransactionNotFoundError / TransactionReceiptNotFoundError for that,
 *     and we translate those to `null` inside the retry callback so they
 *     never reach the transient classification.
 *   - exponential backoff (100ms, 200ms, 400ms) so a flapping RPC
 *     doesn't get hammered.
 *   - a strict upper bound so an actually-broken RPC fails fast, not
 *     after endless retries.
 *   - waitForBlock(): fixed-interval poll of the chain head until it
 *     reaches a target depth. eth_blockNumber is eventually consistent,
 *     even after a receipt is available.
 *
 * Two DIFFERENT retry strategies, by design:
 *
 *   - withRetry (exponential backoff) is for ERROR handling: "the RPC
 *     might be temporarily down; back off so we don't hammer it."
 *
 *   - waitForBlock (fixed interval) is for STATE WAITING: "the head is
 *     stale but not broken; check frequently until it catches up." Using
 *     exponential backoff here is wrong — it adds 50+100+200+400+800+
 *     ... delays when the state might just need one more check.
 *
 * Per spec section 16: "Do not retry invalid transactions indefinitely."
 * Per spec section 21: "RPC outages must not create false payment
 * confirmations." Both hold because:
 *   - we never translate a retry exhaustion into a "not found"
 *   - we never translate a transient error into a successful read
 */

import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Hash,
  type PublicClient,
  type Transaction,
  type TransactionReceipt,
} from 'viem';

export interface ReadOptions {
  /** Total attempts including the first. Default 3. */
  readonly attempts?: number;
  /** Base delay in milliseconds for exponential backoff. Default 100. */
  readonly baseDelayMs?: number;
}

export interface WaitForBlockOptions {
  /** Poll interval in milliseconds. Default 100. */
  readonly intervalMs?: number;
  /** Total time budget in milliseconds. Default 10000. */
  readonly timeoutMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_WAIT_INTERVAL_MS = 100;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

/**
 * Classify an error as transient (retry) or not (fail immediately).
 */
function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes('timeout') ||
    m.includes('etimedout') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('network error') ||
    m.includes('rate limit') ||
    m.includes('too many requests') ||
    m.includes('429') ||
    m.includes('502') ||
    m.includes('503') ||
    m.includes('504')
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, options: ReadOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
      if (i < attempts - 1) await sleep(baseDelay * 2 ** i);
    }
  }
  throw lastErr;
}

async function fetchTransaction(client: PublicClient, hash: Hash): Promise<Transaction | null> {
  try {
    return await client.getTransaction({ hash });
  } catch (err) {
    if (err instanceof TransactionNotFoundError) return null;
    throw err;
  }
}

async function fetchReceipt(client: PublicClient, hash: Hash): Promise<TransactionReceipt | null> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (err) {
    if (err instanceof TransactionReceiptNotFoundError) return null;
    throw err;
  }
}

/**
 * Fetch a transaction by hash. Returns null if the node does not know the
 * transaction. Retries only on transient errors, never on "not found".
 */
export async function getTransaction(
  client: PublicClient,
  hash: Hash,
  options?: ReadOptions,
): Promise<Transaction | null> {
  return withRetry(() => fetchTransaction(client, hash), options);
}

/**
 * Fetch a receipt by hash. Returns null if the node has not seen a receipt
 * for this hash yet (pending or unknown transaction). Retries only on
 * transient errors.
 */
export async function getReceipt(
  client: PublicClient,
  hash: Hash,
  options?: ReadOptions,
): Promise<TransactionReceipt | null> {
  return withRetry(() => fetchReceipt(client, hash), options);
}

/**
 * Current block number. Retries on transient errors.
 */
export async function getBlockNumber(client: PublicClient, options?: ReadOptions): Promise<bigint> {
  return withRetry(() => client.getBlockNumber(), options);
}

/**
 * Poll the chain head until it reaches at least `minBlock`.
 *
 * Semantics:
 *   - Fixed interval polling (default 100ms). NOT exponential backoff,
 *     because we're waiting on STATE, not retrying an ERROR.
 *   - Hard timeout (default 10s) — the caller must not hang forever.
 *   - Returns the observed head once it is >= minBlock.
 *   - Throws on timeout with a clear error message.
 *
 * Why this exists: eth_blockNumber is EVENTUALLY consistent. Even after
 * a receipt for block N is available, eth_blockNumber may briefly report
 * N-1 or lower. This is true for anvil and for real production RPCs. Any
 * caller that wants to compare a receipt's blockNumber against the chain
 * head must first ensure the head has caught up, or it will see a stale
 * value.
 */
export async function waitForBlock(
  client: PublicClient,
  minBlock: bigint,
  options: WaitForBlockOptions = {},
): Promise<bigint> {
  const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const start = Date.now();
  let lastSeen = 0n;

  while (true) {
    const head = await client.getBlockNumber();
    if (head >= minBlock) return head;
    lastSeen = head;

    const elapsed = Date.now() - start;
    if (elapsed + intervalMs >= timeoutMs) {
      throw new Error(
        `Chain head has not reached block ${minBlock} within ${timeoutMs}ms. ` +
          `Last observed head: ${lastSeen}. ` +
          `This usually indicates a slow or stuck RPC endpoint.`,
      );
    }
    await sleep(intervalMs);
  }
}
