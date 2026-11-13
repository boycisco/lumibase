import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createClient, type Client, type Database } from '../client.ts';

let client: Client;
let db: Database;

beforeAll(() => {
  client = createClient(process.env.DATABASE_URL as string);
  db = client.db;
});

afterAll(async () => {
  await client.close();
});

describe('schema: all six tables exist', () => {
  it('lists exactly the expected tables in the public schema', async () => {
    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const names = (result.rows as { table_name: string }[]).map((r) => r.table_name);
    expect(names).toEqual([
      'applications',
      'deliveries',
      'events',
      'payments',
      'transactions',
      'webhooks',
    ]);
  });
});

describe('schema: critical column types', () => {
  it('payments.amount is numeric(78,0) and NOT NULL', async () => {
    const result = await db.execute(sql`
      SELECT data_type, numeric_precision, numeric_scale, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payments'
        AND column_name = 'amount'
    `);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0] as {
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
      is_nullable: string;
    };
    expect(row.data_type).toBe('numeric');
    expect(row.numeric_precision).toBe(78);
    expect(row.numeric_scale).toBe(0);
    expect(row.is_nullable).toBe('NO');
  });

  it('transactions.hash is text and NOT NULL', async () => {
    const result = await db.execute(sql`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'transactions'
        AND column_name = 'hash'
    `);
    const row = result.rows[0] as { data_type: string; is_nullable: string };
    expect(row.data_type).toBe('text');
    expect(row.is_nullable).toBe('NO');
  });

  it('payments.expires_at is timestamptz and NOT NULL', async () => {
    const result = await db.execute(sql`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payments'
        AND column_name = 'expires_at'
    `);
    const row = result.rows[0] as { data_type: string; is_nullable: string };
    expect(row.data_type).toBe('timestamp with time zone');
    expect(row.is_nullable).toBe('NO');
  });
});

describe('schema: money-critical unique constraints', () => {
  it('transactions has UNIQUE (chain_id, hash)', async () => {
    const result = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'transactions'
        AND indexname = 'transactions_chain_hash_unique'
    `);
    expect(result.rows).toHaveLength(1);
    const def = (result.rows[0] as { indexdef: string }).indexdef;
    expect(def).toContain('UNIQUE');
    expect(def).toContain('chain_id');
    expect(def).toContain('hash');
  });

  it('deliveries has UNIQUE (webhook_id, event_id)', async () => {
    const result = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'deliveries'
        AND indexname = 'deliveries_webhook_event_unique'
    `);
    expect(result.rows).toHaveLength(1);
    const def = (result.rows[0] as { indexdef: string }).indexdef;
    expect(def).toContain('UNIQUE');
    expect(def).toContain('webhook_id');
    expect(def).toContain('event_id');
  });
});
