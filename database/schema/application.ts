/**
 * Applications table.
 *
 * An Application is an entity that authenticates to LumiBase with an API key.
 * Per spec section 15: never store plaintext API keys — `keyHash` holds the
 * output of a strong one-way function (e.g. SHA-256 of a cryptographically
 * random key). Key generation, hashing, and rotation are wired up in Phase 8.
 *
 * `status` is a text column rather than an enum because v0.1 has only two
 * meaningful values ("active", "revoked"); a future enum can be added in a
 * migration without data loss.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});