import { beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_ACCOUNT, ensureAnvil, publicClient, walletClient } from './setup.ts';
import { deployMockUSDC, type DeployedToken } from './mock.ts';
import { decodeTransfers } from '../src/log.ts';
import { getReceipt } from '../src/read.ts';

let token: DeployedToken;

beforeAll(async () => {
  await ensureAnvil();
  // Deploy once per file. Supply = 1_000_000 USDC (6 decimals).
  token = await deployMockUSDC(1_000_000n * 10n ** 6n);
});

async function sendTransfer(to: `0x${string}`, value: bigint): Promise<{ hash: `0x${string}` }> {
  const hash = await walletClient.writeContract({
    address: token.address,
    abi: token.abi,
    functionName: 'transfer',
    args: [to, value],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash };
}

describe('decodeTransfers', () => {
  it('decodes a single well-formed ERC-20 Transfer from a real receipt', async () => {
    const recipient = '0x0000000000000000000000000000000000000042';
    const amount = 1_500_000n; // 1.5 USDC

    const { hash } = await sendTransfer(recipient, amount);
    const receipt = await getReceipt(publicClient, hash);
    expect(receipt).not.toBeNull();

    const transfers = decodeTransfers(receipt!);
    expect(transfers).toHaveLength(1);

    const t = transfers[0]!;
    expect(t.token.toLowerCase()).toBe(token.address.toLowerCase());
    expect(t.from.toLowerCase()).toBe(ANVIL_ACCOUNT.address.toLowerCase());
    expect(t.to.toLowerCase()).toBe(recipient.toLowerCase());
    expect(t.value).toBe(amount);
  });

  it('returns no transfers from a plain ETH transfer receipt', async () => {
    const hash = await walletClient.sendTransaction({
      to: '0x0000000000000000000000000000000000000099',
      value: 1n,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const receipt = await getReceipt(publicClient, hash);
    expect(decodeTransfers(receipt!)).toHaveLength(0);
  });

  it('returns the Transfer from the deploy receipt (constructor emit)', async () => {
    // Our MockUSDC constructor emits Transfer(address(0), msg.sender, initialSupply).
    // This is a good edge case: sender is the zero address, which is legal
    // in ERC-20 (mints are Transfer from zero).
    const receipt = await getReceipt(publicClient, token.hash);
    expect(receipt).not.toBeNull();
    const transfers = decodeTransfers(receipt!);
    expect(transfers).toHaveLength(1);
    const mint = transfers[0]!;
    expect(mint.from).toBe('0x0000000000000000000000000000000000000000');
    expect(mint.to.toLowerCase()).toBe(ANVIL_ACCOUNT.address.toLowerCase());
    expect(mint.value).toBe(1_000_000n * 10n ** 6n);
  });

  it('preserves the correct bigint amount for a large transfer', async () => {
    const recipient = '0x0000000000000000000000000000000000000043';
    const amount = 123_456_789_000n; // 123456.789 USDC

    const { hash } = await sendTransfer(recipient, amount);
    const receipt = await getReceipt(publicClient, hash);
    const transfers = decodeTransfers(receipt!);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.value).toBe(amount);
  });

  it('does not throw on receipts with no logs', async () => {
    // A transaction with empty data and value 0 — no events emitted.
    const hash = await walletClient.sendTransaction({
      to: ANVIL_ACCOUNT.address,
      value: 0n,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const receipt = await getReceipt(publicClient, hash);
    expect(() => decodeTransfers(receipt!)).not.toThrow();
    expect(decodeTransfers(receipt!)).toHaveLength(0);
  });
});
