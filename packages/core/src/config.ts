/**
 * Environment configuration helpers.
 *
 * These are building blocks. They do NOT decide what LumiBase's environment
 * variables are — that belongs to the app that reads its own config
 * (e.g. apps/api in Phase 8). Core provides validated primitives so every
 * app in the monorepo validates its configuration the same way.
 *
 * Rules encoded here:
 *   - Missing required values fail loudly at startup, not silently later.
 *   - Defaults are only used for non-security-relevant values (like NODE_ENV).
 *   - Error details list WHAT is wrong, never WHAT THE VALUE WAS. Invalid
 *     secrets must never appear in logs or error responses.
 */

import { z } from 'zod';
import { HTTP_STATUS, LumiError } from './error.js';

/**
 * A TCP port. Accepts string input from process.env (e.g. "3000") and
 * coerces to a number. Rejects 0, anything above 65535, non-integers,
 * and non-numeric strings.
 */
export function port(): z.ZodType<number, z.ZodTypeDef, unknown> {
  return z.coerce
    .number()
    .int()
    .min(1, { message: 'Port must be at least 1.' })
    .max(65535, { message: 'Port must be at most 65535.' });
}

/**
 * An http(s) URL. Use for RPC endpoints and webhook URLs where we must
 * not allow other schemes (ws://, ftp://, file://, etc.).
 */
export function httpUrl(): z.ZodType<string, z.ZodTypeDef, unknown> {
  return z
    .string()
    .url({ message: 'Must be a valid URL.' })
    .refine((s) => /^https?:\/\//.test(s), {
      message: 'Must start with http:// or https://.',
    });
}

/**
 * Any URL with a scheme. Use for DATABASE_URL (postgresql://), etc.
 * Does not allow arbitrary strings — the URL must parse.
 */
export function url(): z.ZodType<string, z.ZodTypeDef, unknown> {
  return z.string().url({ message: 'Must be a valid URL.' });
}

/**
 * A secret string. Enforces a minimum length (default 32 characters,
 * which corresponds to ~192 bits of entropy for base64/hex random).
 *
 * If you generate secrets with crypto.randomBytes(32).toString("hex"),
 * the result is 64 characters. This min is a floor, not a target.
 */
export function secret(min: number = 32): z.ZodType<string, z.ZodTypeDef, unknown> {
  return z.string().min(min, { message: `Secret must be at least ${min} characters.` });
}

/**
 * NODE_ENV. Defaults to "development" if unset.
 *
 * Deliberately does NOT allow arbitrary values like "staging" — a typo'd
 * environment is a security risk (e.g. someone intending "production"
 * writes "prod" and gets development behavior).
 */
export function nodeEnv(): z.ZodType<'development' | 'test' | 'production', z.ZodTypeDef, unknown> {
  return z
    .enum(['development', 'test', 'production'], {
      message: 'Must be one of: development, test, production.',
    })
    .default('development');
}

/**
 * Load and validate the environment against a Zod schema.
 *
 * On success returns the parsed, validated object.
 *
 * On failure throws a LumiError with code "CONFIG_ERROR". The `details`
 * field lists field paths and messages — NEVER the offending values.
 * `LumiError.toBody` further strips `details`, so this can also be
 * returned from an API without leaking secrets.
 *
 * @param schema Zod object schema describing the expected environment
 * @param env Where to read from. Defaults to `process.env`. Injecting a
 *            plain object is useful in tests; never pass user input here.
 */
export function loadEnv<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  env: Record<string, string | undefined> = process.env,
): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
      code: issue.code,
    }));
    throw new LumiError('CONFIG_ERROR', 'Configuration is invalid.', {
      statusCode: HTTP_STATUS.INTERNAL,
      details: { issues },
    });
  }
  return result.data;
}
