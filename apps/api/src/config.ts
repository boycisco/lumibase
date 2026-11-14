/**
 * API configuration.
 *
 * Loads .env from the repo root, then validates every required variable
 * with Zod. Fails at startup with a clear CONFIG_ERROR if anything is
 * missing or malformed.
 */

import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadEnv, nodeEnv, port, secret, url } from '@lumibase/core';

const here = dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: resolve(here, '../../../.env') });

const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());
const optionalSecret = z.preprocess((v) => (v === '' ? undefined : v), secret(32).optional());

const schema = z.object({
  NODE_ENV: nodeEnv(),
  PORT: port(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: url(),
  API_SECRET: secret(32),
  WEBHOOK_SECRET: optionalSecret,
  BASE_SEPOLIA_RPC: optionalUrl,
  BASE_MAINNET_RPC: optionalUrl,
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
});

export type ApiConfig = {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly databaseUrl: string;
  readonly adminSecret: string;
  readonly webhookSecret: string | undefined;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly workerIntervalMs: number;
};

export function loadApiConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const parsed = loadEnv(schema, env);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    adminSecret: parsed.API_SECRET,
    webhookSecret: parsed.WEBHOOK_SECRET,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    workerIntervalMs: parsed.WORKER_INTERVAL_MS,
  };
}
