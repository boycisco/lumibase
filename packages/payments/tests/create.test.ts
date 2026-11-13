import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LumiError, MAX_UINT256 } from '@lumibase/core';
import { applications, events, payments } from '@lumibase/database';
import { BASE_MAINNET, BASE_SEPOLIA, BASE_SEPOLIA_USDC } from '@lumibase/network';
import type { NetworkConfig, ResolvedChain } from '@lumibase/network';
import {
  MAX_EXPIRES_IN,
  MAX_METADATA_BYTES,
  MAX_REFERENCE_LENGTH,
  createPayment,
  resolveConfig,
} from '../src/index.ts';
import type { CreatePaymentInput, ResolvedConfig } from '../src/index.ts';
import { db, truncateAll } from './setup.ts';

afterEach(async () => {
  await truncateAll();
});

const SEPOLIA: ResolvedChain = { ...BASE_SEPOLIA, rpc: 'http://localhost:8545' };
const MAINNET: ResolvedChain = { ...BASE_MAINNET, rpc: 'http://localhost:8545' };

const chains: NetworkConfig = {
  chains: new Map([
    [SEPOLIA.id, SEPOLIA],
    [MAINNET.id, MAINNET],
  ]),
};

async function insertApp(): Promise<string> {
  const [row] = await db
    .insert(applications)
    .values({ name: 'test-app', keyHash: 'h-' + Math.random().toString(36) })
    .returning({ id: applications.id });
  if (!row) throw new Error('Failed to insert application');
  return row.id;
}

function makeInput(
  applicationId: string,
  overrides: Partial<CreatePaymentInput> = {},
): CreatePaymentInput {
  return {
    applicationId,
    chainId: SEPOLIA.id,
    token: BASE_SEPOLIA_USDC.address,
    amount: 1_500_000n,
    recipient: '0x0000000000000000000000000000000000000001',
    expiresIn: 1800,
    ...overrides,
  };
}

async function makeConfig(
  overrides: { clock?: () => Date; idGenerator?: () => string } = {},
): Promise<ResolvedConfig> {
  return resolveConfig({ db, chains, ...overrides });
}

describe('createPayment — success', () => {
  it('creates a pending payment with all fields set', async () => {
    const appId = await insertApp();
    const fixedNow = new Date('2025-06-01T12:00:00Z');
    const config = await makeConfig({ clock: () => fixedNow });
    const payment = await createPayment(config, makeInput(appId));
    expect(payment.status).toBe('pending');
    expect(payment.chainId).toBe(SEPOLIA.id);
    expect(payment.tokenAddress).toBe(BASE_SEPOLIA_USDC.address.toLowerCase());
    expect(payment.amount).toBe(1_500_000n);
    expect(payment.recipient).toBe('0x0000000000000000000000000000000000000001');
    expect(payment.payer).toBeNull();
    expect(payment.reference).toBeNull();
    expect(payment.metadata).toBeNull();
    expect(payment.createdAt).toEqual(fixedNow);
    expect(payment.updatedAt).toEqual(fixedNow);
    expect(payment.expiresAt).toEqual(new Date(fixedNow.getTime() + 1800 * 1000));
  });

  it('uses the injected idGenerator for the payment id', async () => {
    const appId = await insertApp();
    const config = await makeConfig({
      idGenerator: () => '11111111-1111-4111-8111-111111111111',
    });
    const payment = await createPayment(config, makeInput(appId));
    expect(payment.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('persists the payment in the database', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));
    const rows = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.amount).toBe('1500000');
  });

  it('persists a payment.created event in the same transaction', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId));
    const evtRows = await db.select().from(events).where(eq(events.paymentId, payment.id));
    expect(evtRows).toHaveLength(1);
    expect(evtRows[0]!.type).toBe('payment.created');
    const payload = evtRows[0]!.payload as { payment: { id: string; status: string } };
    expect(payload.payment.id).toBe(payment.id);
    expect(payload.payment.status).toBe('pending');
  });

  it('accepts payer when provided', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(
      config,
      makeInput(appId, { payer: '0x0000000000000000000000000000000000000002' }),
    );
    expect(payment.payer).toBe('0x0000000000000000000000000000000000000002');
  });

  it('accepts reference and metadata when provided', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(
      config,
      makeInput(appId, {
        reference: 'ORDER_123',
        metadata: { orderId: 'abc', source: 'web' },
      }),
    );
    expect(payment.reference).toBe('ORDER_123');
    expect(payment.metadata).toEqual({ orderId: 'abc', source: 'web' });
  });
});

describe('createPayment — amount validation', () => {
  it('rejects 0n', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(createPayment(config, makeInput(appId, { amount: 0n }))).rejects.toBeInstanceOf(
      LumiError,
    );
  });

  it('rejects amounts larger than uint256 max', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(
      createPayment(config, makeInput(appId, { amount: MAX_UINT256 + 1n })),
    ).rejects.toBeInstanceOf(LumiError);
  });

  it('accepts MAX_UINT256 exactly', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId, { amount: MAX_UINT256 }));
    expect(payment.amount).toBe(MAX_UINT256);
  });
});

describe('createPayment — expiresIn validation', () => {
  it('rejects 0', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(createPayment(config, makeInput(appId, { expiresIn: 0 }))).rejects.toBeInstanceOf(
      LumiError,
    );
  });

  it('rejects negative', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(createPayment(config, makeInput(appId, { expiresIn: -1 }))).rejects.toBeInstanceOf(
      LumiError,
    );
  });

  it('rejects non-integer', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(
      createPayment(config, makeInput(appId, { expiresIn: 1.5 })),
    ).rejects.toBeInstanceOf(LumiError);
  });

  it('rejects values above MAX_EXPIRES_IN', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(
      createPayment(config, makeInput(appId, { expiresIn: MAX_EXPIRES_IN + 1 })),
    ).rejects.toBeInstanceOf(LumiError);
  });

  it('accepts MAX_EXPIRES_IN exactly', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(config, makeInput(appId, { expiresIn: MAX_EXPIRES_IN }));
    expect(payment.expiresAt.getTime()).toBeGreaterThan(0);
  });
});

describe('createPayment — reference validation', () => {
  it('rejects references longer than 256 chars', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(
      createPayment(config, makeInput(appId, { reference: 'x'.repeat(257) })),
    ).rejects.toBeInstanceOf(LumiError);
  });

  it('accepts references of exactly 256 chars', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const payment = await createPayment(
      config,
      makeInput(appId, { reference: 'x'.repeat(MAX_REFERENCE_LENGTH) }),
    );
    expect(payment.reference).toHaveLength(MAX_REFERENCE_LENGTH);
  });
});

describe('createPayment — metadata validation', () => {
  it('rejects metadata over 8 KiB', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const big = { data: 'x'.repeat(MAX_METADATA_BYTES + 100) };
    await expect(createPayment(config, makeInput(appId, { metadata: big }))).rejects.toBeInstanceOf(
      LumiError,
    );
  });
});

describe('createPayment — address validation', () => {
  it('rejects invalid recipient', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(
      createPayment(config, makeInput(appId, { recipient: 'not-an-address' as `0x${string}` })),
    ).rejects.toBeInstanceOf(LumiError);
  });

  it('rejects invalid payer', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    await expect(
      createPayment(config, makeInput(appId, { payer: 'not-an-address' as `0x${string}` })),
    ).rejects.toBeInstanceOf(LumiError);
  });

  it('rejects addresses with invalid EIP-55 checksum', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const badChecksum = '0x5AAEB6053F3E94C9B9A09f33669435E7Ef1BeAed' as `0x${string}`;
    await expect(
      createPayment(config, makeInput(appId, { recipient: badChecksum })),
    ).rejects.toBeInstanceOf(LumiError);
  });

  it('normalizes valid EIP-55 address to lowercase', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as `0x${string}`;
    const payment = await createPayment(config, makeInput(appId, { recipient: checksummed }));
    expect(payment.recipient).toBe(checksummed.toLowerCase());
  });
});

describe('createPayment — chain validation', () => {
  it('rejects chain not in config with UNSUPPORTED_CHAIN', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    try {
      await createPayment(config, makeInput(appId, { chainId: 999999 }));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('UNSUPPORTED_CHAIN');
      expect((err as LumiError).statusCode).toBe(422);
    }
  });

  it('rejects disabled chain with UNSUPPORTED_CHAIN', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    try {
      await createPayment(config, makeInput(appId, { chainId: MAINNET.id }));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('UNSUPPORTED_CHAIN');
    }
  });
});

describe('createPayment — token validation', () => {
  it('rejects unknown token with UNSUPPORTED_TOKEN', async () => {
    const appId = await insertApp();
    const config = await makeConfig();
    try {
      await createPayment(
        config,
        makeInput(appId, {
          token: '0x0000000000000000000000000000000000000099' as `0x${string}`,
        }),
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('UNSUPPORTED_TOKEN');
      expect((err as LumiError).statusCode).toBe(422);
    }
  });

  it('rejects disabled token with UNSUPPORTED_TOKEN', async () => {
    // Build a config where Sepolia is enabled but USDC is disabled,
    // isolating the token gate from the chain gate.
    const appId = await insertApp();
    const sepoliaWithDisabledUSDC: ResolvedChain = {
      ...SEPOLIA,
      tokens: SEPOLIA.tokens.map((t) => ({ ...t, enabled: false })),
    };
    const isolatedConfig: ResolvedConfig = {
      db,
      chains: { chains: new Map([[SEPOLIA.id, sepoliaWithDisabledUSDC]]) },
      clock: () => new Date(),
      idGenerator: () => crypto.randomUUID(),
    };
    try {
      await createPayment(isolatedConfig, makeInput(appId));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as LumiError).code).toBe('UNSUPPORTED_TOKEN');
    }
  });
});

describe('createPayment — atomicity', () => {
  it('rolls back both payment and event when the application_id FK fails', async () => {
    const config = await makeConfig();
    const fakeAppId = '00000000-0000-4000-8000-000000000000';
    await expect(createPayment(config, makeInput(fakeAppId))).rejects.toThrow();
    const paymentRows = await db.select().from(payments);
    const eventRows = await db.select().from(events);
    expect(paymentRows).toHaveLength(0);
    expect(eventRows).toHaveLength(0);
  });
});
