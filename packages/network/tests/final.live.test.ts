import { beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_ACCOUNT, ensureAnvil, publicClient, walletClient } from './setup.ts';
import { waitForBlock } from '../src/read.ts';
import { checkConfirmations } from '../src/final.ts';

beforeAll(async () => {
  await ensureAnvil();
});

async function sendAndWait(): Promise<{
  hash: `0x${string}`;
  blockNumber: bigint;
}> {
  const hash = await walletClient.sendTransaction({
    to: ANVIL_ACCOUNT.address,
    value: 1n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, blockNumber: receipt.blockNumber };
}

/**
 * Most tests here use `receipt.blockNumber` directly as the "currentBlock"
 * argument. This is a legitimate shortcut: the receipt is definitive, and
 * its blockNumber represents the minimum possible chain head at the moment
 * the receipt exists. Testing checkConfirmations with that input exercises
 * the pure function against a real receipt without being affected by
 * eth_blockNumber timing.
 *
 * Two tests DO use waitForBlock, because they specifically need to prove
 * the chain head advances (once for the "advances" case, once for
 * waitForBlock itself). Those are the only tests that legitimately need
 * to observe the head.
 */
describe('live finality checks', () => {
  it('a fresh tx with blocks=1 is confirmed (tx block counts as 1)', async () => {
    const { hash } = await sendAndWait();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const result = checkConfirmations(receipt, receipt.blockNumber, {
      blocks: 1,
      finality: 'soft',
    });
    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBe(1);
    expect(result.required).toBe(1);
  });

  it('a fresh tx with blocks=5 is pending', async () => {
    const { hash } = await sendAndWait();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const result = checkConfirmations(receipt, receipt.blockNumber, {
      blocks: 5,
      finality: 'soft',
    });
    expect(result.status).toBe('pending');
    expect(result.confirmations).toBe(1);
    expect(result.required).toBe(5);
  });

  it("uses the chain's declared 12-block policy", async () => {
    const { hash } = await sendAndWait();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const result = checkConfirmations(receipt, receipt.blockNumber, {
      blocks: 12,
      finality: 'soft',
    });
    expect(result.status).toBe('pending');
    expect(result.confirmations).toBe(1);
    expect(result.required).toBe(12);
  });

  it('after mining additional blocks, a previously-pending tx becomes confirmed', async () => {
    const { hash, blockNumber } = await sendAndWait();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const policy = { blocks: 3, finality: 'soft' } as const;

    // Immediate state via receipt.blockNumber: pending (depth 1 < 3).
    expect(checkConfirmations(receipt, blockNumber, policy).status).toBe('pending');

    // Mine 2 more blocks (each tx = 1 block on anvil).
    await sendAndWait();
    await sendAndWait();

    // Now we DO need to observe the head, because we're proving the chain
    // has genuinely advanced by 2 blocks since the receipt. Use
    // waitForBlock because the receipt for the LAST tx is definitive but
    // eth_blockNumber may lag it by a moment.
    const head = await waitForBlock(publicClient, blockNumber + 2n);

    const result = checkConfirmations(receipt, head, policy);
    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBeGreaterThanOrEqual(3);
  });

  it('waitForBlock returns a head >= the target', async () => {
    const { hash, blockNumber } = await sendAndWait();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const head = await waitForBlock(publicClient, receipt.blockNumber);
    expect(head).toBeGreaterThanOrEqual(blockNumber);
  });
});
