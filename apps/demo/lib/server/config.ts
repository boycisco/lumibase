import { getAddress, isAddress } from 'viem';

export interface DemoServerConfig {
  lumibaseApiUrl: string;
  demoRecipient: `0x${string}`;
  demoPort: number;
  nodeEnv: string;
}

export interface ConfigValidationFailure {
  ok: false;
  missing: string[];
  invalid: string[];
  message: string;
}

export interface ConfigValidationSuccess {
  ok: true;
  config: DemoServerConfig;
}

export type ConfigValidationResult =
  | ConfigValidationSuccess
  | ConfigValidationFailure;

export class DemoConfigurationError extends Error {
  readonly code = 'DEMO_CONFIGURATION_ERROR';
  readonly missing: string[];
  readonly invalid: string[];

  constructor(failure: ConfigValidationFailure) {
    super(failure.message);
    this.name = 'DemoConfigurationError';
    this.missing = failure.missing;
    this.invalid = failure.invalid;
  }
}

export function validateServerConfig(
  env: Record<string, string | undefined> = process.env,
): ConfigValidationResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  const rawApiUrl = env.LUMIBASE_API_URL?.trim();
  const rawApiSecret = env.API_SECRET?.trim();
  const rawRecipient = env.DEMO_RECIPIENT?.trim();
  const rawPort = env.DEMO_PORT?.trim();
  const nodeEnv = env.NODE_ENV?.trim() || 'development';

  if (!rawApiUrl) {
    missing.push('LUMIBASE_API_URL');
  }
  if (!rawApiSecret) {
    missing.push('API_SECRET');
  }
  if (!rawRecipient) {
    missing.push('DEMO_RECIPIENT');
  }

  let normalizedApiUrl = '';
  if (rawApiUrl) {
    try {
      const parsed = new URL(rawApiUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        invalid.push('LUMIBASE_API_URL (must use http or https protocol)');
      } else {
        normalizedApiUrl = parsed.toString().replace(/\/+$/, '');
      }
    } catch {
      invalid.push('LUMIBASE_API_URL (must be a valid URL)');
    }
  }

  let checksummedRecipient: `0x${string}` | null = null;
  if (rawRecipient) {
    if (!isAddress(rawRecipient, { strict: false })) {
      invalid.push('DEMO_RECIPIENT (must be a valid EVM address)');
    } else {
      checksummedRecipient = getAddress(rawRecipient);
    }
  }

  let demoPort = 4000;
  if (rawPort) {
    const parsedPort = Number(rawPort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      invalid.push('DEMO_PORT (must be an integer between 1 and 65535)');
    } else {
      demoPort = parsedPort;
    }
  }

  if (missing.length > 0 || invalid.length > 0 || !checksummedRecipient) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`Missing required environment variable(s): ${missing.join(', ')}`);
    }
    if (invalid.length > 0) {
      parts.push(`Invalid environment variable(s): ${invalid.join('; ')}`);
    }
    return {
      ok: false,
      missing,
      invalid,
      message: `${parts.join('. ')}. Configure these server-side variables without placeholders and restart.`,
    };
  }

  return {
    ok: true,
    config: {
      lumibaseApiUrl: normalizedApiUrl,
      demoRecipient: checksummedRecipient,
      demoPort,
      nodeEnv,
    },
  };
}

/**
 * Reads API_SECRET strictly on-demand for the startup bootstrap call
 * without persisting it in long-lived config structs.
 */
export function readAdminSecretForBootstrap(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.API_SECRET?.trim();
  if (!secret) {
    throw new DemoConfigurationError({
      ok: false,
      missing: ['API_SECRET'],
      invalid: [],
      message:
        'Missing required environment variable(s): API_SECRET. Configure this server-side variable and restart.',
    });
  }
  return secret;
}

export function assertValidServerConfig(
  env: Record<string, string | undefined> = process.env,
): DemoServerConfig {
  const result = validateServerConfig(env);
  if (!result.ok) {
    throw new DemoConfigurationError(result);
  }
  return result.config;
}
