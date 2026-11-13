/**
 * Transactions table.
 *
 * One row per observed on-chain transaction attempt (see
 * specs/payments/lifecycle.json atomicity.transactionUniqueness).
 *
 * The unique constraint on (chain_id, hash) is THE enforcement point for
 * "no two payments may ever be confirmed by the same transaction."
 * It is checked by Postgres, not by application code, so concurrent
 * confirms in different processes cannot race past it.
 *
 * status is the transaction's own verification outcome (verified, rejected,
 * orphaned) — distinct from the parent payment's lifecycle status.
 */

import {
  bigint,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { payments } from "./payment.ts";

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    chainId: integer("chain_id").notNull(),
    hash: text("hash").notNull(),
    sender: text("sender"),
    recipient: text("recipient").notNull(),
    tokenAddress: text("token_address").notNull(),
    amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    status: text("status").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chainHashUnique: uniqueIndex("transactions_chain_hash_unique").on(
      table.chainId,
      table.hash,
    ),
    paymentIdx: index("transactions_payment_idx").on(table.paymentId),
  }),
);