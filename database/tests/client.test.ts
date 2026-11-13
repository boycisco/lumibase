import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createClient } from '../client.ts';

describe('createClient', () => {
  const url = process.env.DATABASE_URL as string;

  it('throws when url is empty', () => {
    expect(() => createClient('')).toThrow(/Database URL is required/);
  });

  it('connects and can run a trivial query', async () => {
    const { db, close } = createClient(url);
    try {
      const result = await db.execute(sql`SELECT 1 AS n`);
      expect(result.rows).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('close() is idempotent enough to be called from teardown', async () => {
    const { close } = createClient(url);
    await close();
  });
});
