/**
 * Convert a database row to the internal Payment shape.
 *
 * Extracted so create.ts, read.ts, expire.ts, and cancel.ts all share one
 * conversion. This is the ONLY place that knows:
 *   - amount is numeric(78,0) in the DB, bigint in memory
 *   - addresses are stored lowercase, type-asserted to `0x${string}`
 *   - status is text in the DB, narrowed to the PaymentStatus union
 *   - metadata is jsonb, typed to Record<string, unknown> | null
 *
 * Any other file that converts rows would silently drift; there should be
 * exactly one such file.
 */

import type { payments } from '@lumibase/database';
import type { Payment, PaymentStatus } from './types.ts';

export function rowToPayment(row: typeof payments.$inferSelect): Payment {
  return {
    id: row.id,
    applicationId: row.applicationId,
    reference: row.reference,
    chainId: row.chainId,
    tokenAddress: row.tokenAddress as `0x${string}`,
    amount: BigInt(row.amount),
    recipient: row.recipient as `0x${string}`,
    payer: row.payer === null ? null : (row.payer as `0x${string}`),
    status: row.status as PaymentStatus,
    expiresAt: row.expiresAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
