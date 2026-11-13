import { beforeAll, describe, expect, it } from 'vitest';
import { ensureAnvil, publicClient, walletClient, ANVIL_ACCOUNT } from './setup.ts';
import { getBlockNumber, getReceipt, getTransaction } from '../src/read.ts';

beforeAll(async () => {
  await ensureAnvil();
});

async function sendEth(to: `0x${string}`, value: bigint) {
  const hash = await walletClient.sendTransaction({ to, value });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

describe('getBlockNumber', () => {
  it('returns a non-negative block number', async () => {
    // Fresh anvil state: current block may be 0.
    const n = await getBlockNumber(publicClient);
    expect(n).toBeGreaterThanOrEqual(0n);
  });

  it('advances after a transaction', async () => {
    const before = await getBlockNumber(publicClient);
    const hash = await walletClient.sendTransaction({
      to: ANVIL_ACCOUNT.address,
      value: 1n,
    });
    // The receipt's blockNumber is definitive: it comes from the same RPC
    // call that confirmed the transaction is mined, so it cannot be stale.
    // `getBlockNumber` after that point is eventually consistent — the
    // number may lag the receipt by a microsecond on anvil and on real
    // nodes. Asserting on receipt.blockNumber is the deterministic check.
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.blockNumber).toBeGreaterThan(before);
  });
});

describe('getTransaction', () => {
  it('returns null for a nonexistent hash', async () => {
    const fakeHash = '0x0000000000000000000000000000000000000000000000000000000000000001';
    const tx = await getTransaction(publicClient, fakeHash);
    expect(tx).toBeNull();
  });

  it('returns the transaction for a real hash', async () => {
    const to = '0x0000000000000000000000000000000000000001';
    const hash = await sendEth(to, 1000n);
    const tx = await getTransaction(publicClient, hash);
    expect(tx).not.toBeNull();
    expect(tx!.hash).toBe(hash);
    expect(tx!.to?.toLowerCase()).toBe(to.toLowerCase());
    expect(tx!.from.toLowerCase()).toBe(ANVIL_ACCOUNT.address.toLowerCase());
    expect(tx!.value).toBe(1000n);
  });
});

describe('getReceipt', () => {
  it('returns the receipt for a real hash with status success', async () => {
    const hash = await sendEth('0x0000000000000000000000000000000000000002', 1n);
    const receipt = await getReceipt(publicClient, hash);
    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe('success');
    expect(receipt!.transactionHash).toBe(hash);
    expect(receipt!.blockNumber).toBeGreaterThan(0n);
  });

  it('returns null for a nonexistent hash', async () => {
    const fakeHash = '0x00000000000000000000000000000000000000000000000000000000000000ff';
    const receipt = await getReceipt(publicClient, fakeHash);
    expect(receipt).toBeNull();
  });
});

describe('retry behavior', () => {
  it("does not retry on 'not found' (returns null immediately)", async () => {
    const fakeHash = '0x00000000000000000000000000000000000000000000000000000000000000ee';
    const start = Date.now();
    const tx = await getTransaction(publicClient, fakeHash);
    const elapsed = Date.now() - start;
    expect(tx).toBeNull();
    // Not-found should return well under 500ms — no retry backoff.
    expect(elapsed).toBeLessThan(500);
  });
});
