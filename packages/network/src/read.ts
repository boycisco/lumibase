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
 *   - waitForBlock(): poll the chain head until it reaches a target depth,
 *     because eth_blockNumber is eventually consistent even after a receipt
 *     is available.
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
  /** Total attempts including the first. Default 3 (10 for waitForBlock). */
  readonly attempts?: number;
  /** Base delay in milliseconds for exponential backoff. Default 100. */
  readonly baseDelayMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const WAIT_ATTEMPTS = 10;
const WAIT_BASE_DELAY_MS = 50;

/**
 * Classify an error as transient (retry) or not (fail immediately).
 *
 * Deliberately conservative: only errors that are genuinely network-shaped
 * or rate-limit-shaped are retried. Anything else fails fast so bugs
 * surface, not hide.
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
 * Poll the chain head until it reaches at least `minBlock`, or timeout.
 *
 * Why this exists: eth_blockNumber is EVENTUALLY consistent. Even after
 * a receipt for block N is available, eth_blockNumber may briefly report
 * N-1 (or lower) for a few milliseconds. This is true for anvil and for
 * real production RPC endpoints. Anywhere we want to compare a receipt's
 * blockNumber against the chain head, we must first ensure the head has
 * actually caught up, or we will get a nonsensical "currentBlock <
 * receipt.blockNumber" result.
 *
 * This is a bounded poll: at most `attempts` calls, each with exponential
 * backoff. If the head never reaches `minBlock`, we throw a clear error
 * rather than silently proceeding with a stale head.
 *
 * Returns the observed block number once it is >= minBlock.
 */
export async function waitForBlock(
  client: PublicClient,
  minBlock: bigint,
  options?: ReadOptions,
): Promise<bigint> {
  const attempts = options?.attempts ?? WAIT_ATTEMPTS;
  const baseDelay = options?.baseDelayMs ?? WAIT_BASE_DELAY_MS;
  let lastSeen = 0n;
  for (let i = 0; i < attempts; i += 1) {
    const head = await client.getBlockNumber();
    if (head >= minBlock) return head;
    lastSeen = head;
    if (i < attempts - 1) await sleep(baseDelay * 2 ** i);
  }
  throw new Error(
    `Chain head has not reached block ${minBlock} after ${attempts} attempts. ` +
      `Last observed head: ${lastSeen}. ` +
      `This usually indicates RPC latency or a stuck node.`,
  );
}
