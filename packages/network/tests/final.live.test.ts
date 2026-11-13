import { beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_ACCOUNT, ensureAnvil, publicClient, walletClient } from './setup.ts';
import { getBlockNumber, waitForBlock } from '../src/read.ts';
import { checkConfirmations } from '../src/final.ts';

beforeAll(async () => {
  await ensureAnvil();
});

describe('live finality checks', () => {
  it('a fresh tx with blocks=1 is confirmed (tx block counts as 1)', async () => {
    const hash = await walletClient.sendTransaction({
      to: ANVIL_ACCOUNT.address,
      value: 1n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // After waitForTransactionReceipt returns, the receipt is definitive
    // but eth_blockNumber may briefly report a lower head. Poll until the
    // head at least reaches the receipt's block.
    const head = await waitForBlock(publicClient, receipt.blockNumber);

    const result = checkConfirmations(receipt, head, {
      blocks: 1,
      finality: 'soft',
    });
    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBeGreaterThanOrEqual(1);
  });

  it('a fresh tx with blocks=5 is pending', async () => {
    const hash = await walletClient.sendTransaction({
      to: ANVIL_ACCOUNT.address,
      value: 1n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const head = await waitForBlock(publicClient, receipt.blockNumber);

    const result = checkConfirmations(receipt, head, {
      blocks: 5,
      finality: 'soft',
    });
    // Right after the tx, depth is 1, so 5 is not satisfied.
    expect(result.status).toBe('pending');
    expect(result.confirmations).toBeLessThan(5);
  });

  it('after mining additional blocks, a previously-pending tx becomes confirmed', async () => {
    // Send tx, receive it in some block N.
    const hash = await walletClient.sendTransaction({
      to: ANVIL_ACCOUNT.address,
      value: 1n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const policy = { blocks: 3, finality: 'soft' } as const;

    // Right after: still pending (depth 1 < 3).
    const head0 = await waitForBlock(publicClient, receipt.blockNumber);
    expect(checkConfirmations(receipt, head0, policy).status).toBe('pending');

    // Mine enough transactions to push depth past 3.
    // 2 more blocks is enough: 1 (own) + 2 = 3 confirmations.
    for (let i = 0; i < 2; i += 1) {
      const mineHash = await walletClient.sendTransaction({
        to: ANVIL_ACCOUNT.address,
        value: 1n,
      });
      await publicClient.waitForTransactionReceipt({ hash: mineHash });
    }

    // Poll until the head has observed at least 2 blocks beyond the
    // receipt's block. This is exactly the phase 7 pattern: don't trust
    // a stale head; force the RPC to reveal current depth.
    const head1 = await waitForBlock(publicClient, receipt.blockNumber + 2n);
    const result = checkConfirmations(receipt, head1, policy);
    expect(result.status).toBe('confirmed');
    expect(result.confirmations).toBeGreaterThanOrEqual(3);
  });

  it("uses the chain's declared 12-block policy", async () => {
    const hash = await walletClient.sendTransaction({
      to: ANVIL_ACCOUNT.address,
      value: 1n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const head = await waitForBlock(publicClient, receipt.blockNumber);

    const result = checkConfirmations(receipt, head, {
      blocks: 12,
      finality: 'soft',
    });
    // Immediately after: depth 1 << 12, so pending.
    expect(result.status).toBe('pending');
    expect(result.confirmations).toBeLessThan(12);
    expect(result.required).toBe(12);
  });

  it('getBlockNumber eventually agrees with waitForBlock', async () => {
    // Sanity check for waitForBlock itself: after waitForBlock returns a
    // head at block N, a plain getBlockNumber call must return >= N.
    const hash = await walletClient.sendTransaction({
      to: ANVIL_ACCOUNT.address,
      value: 1n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const head = await waitForBlock(publicClient, receipt.blockNumber);
    const plainHead = await getBlockNumber(publicClient);
    expect(plainHead).toBeGreaterThanOrEqual(head);
    expect(plainHead).toBeGreaterThanOrEqual(receipt.blockNumber);
  });
});
