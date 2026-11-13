/**
 * ERC-20 log decoding.
 *
 * Given a transaction receipt, extract every well-formed ERC-20 Transfer
 * event it emitted. This is a PURE function: no RPC calls, no network I/O.
 * The receipt is already in memory from a prior read.
 *
 * Spec section 10.1:
 *   "For ERC-20 transfers, inspect the Transfer event logs. Do not assume
 *    that a successful transaction to a token contract is necessarily a
 *    successful payment to the intended recipient."
 *
 * That's why this function returns EVERY Transfer in the receipt, not just
 * the first one. The payment verification layer (Phase 7) is responsible
 * for picking the one that matches the payment request, and it must reject
 * if the transfer it needs isn't there.
 */

import { erc20Abi, parseEventLogs, type TransactionReceipt } from 'viem';

export interface Erc20Transfer {
  /** ERC-20 contract that emitted the Transfer. */
  readonly token: `0x${string}`;
  /** Sending address, decoded from the indexed `from` topic. */
  readonly from: `0x${string}`;
  /** Receiving address, decoded from the indexed `to` topic. */
  readonly to: `0x${string}`;
  /** Amount in the token's smallest indivisible unit. */
  readonly value: bigint;
  /** Position of this log within the block. Useful for deterministic ordering. */
  readonly logIndex: number;
}

const TRANSFER_EVENT = erc20Abi.filter((item) => item.type === 'event' && item.name === 'Transfer');

/**
 * Decode every ERC-20 Transfer event in a receipt.
 *
 * Ignores:
 *   - non-Transfer logs (Approval, arbitrary contract logs)
 *   - malformed logs whose topic/data structure doesn't fully decode
 *
 * Returns an array of Erc20Transfer objects in log-index order.
 *
 * With `strict: false`, viem types every decoded argument as
 * `T | undefined`. We filter undefined explicitly so the output type
 * is exact; this also defends against receipts containing a Transfer
 * event whose data block was truncated.
 */
export function decodeTransfers(receipt: TransactionReceipt): Erc20Transfer[] {
  const logs = parseEventLogs({
    abi: TRANSFER_EVENT,
    logs: receipt.logs,
    eventName: 'Transfer',
    strict: false,
  });

  const out: Erc20Transfer[] = [];
  for (const log of logs) {
    const { from, to, value } = log.args;
    if (from === undefined || to === undefined || value === undefined) {
      continue;
    }
    out.push({
      token: log.address,
      from,
      to,
      value,
      logIndex: log.logIndex ?? 0,
    });
  }
  return out;
}
