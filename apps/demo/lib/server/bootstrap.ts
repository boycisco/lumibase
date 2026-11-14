import {
  assertValidServerConfig,
  readAdminSecretForBootstrap,
  type DemoServerConfig,
} from './config';

interface BootstrapState {
  applicationKey: string | null;
  applicationId: string | null;
  bootstrappedForApiUrl: string | null;
  inflight: Promise<string> | null;
}

const state: BootstrapState = {
  applicationKey: null,
  applicationId: null,
  bootstrappedForApiUrl: null,
  inflight: null,
};

export class UpstreamLumiBaseError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message = 'Upstream LumiBase error') {
    super(message);
    this.name = 'UpstreamLumiBaseError';
    this.status = status;
    this.body = body;
  }
}

export async function ensureApplicationApiKey(
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<{ apiKey: string; config: DemoServerConfig }> {
  const config = assertValidServerConfig(env);

  if (
    state.applicationKey &&
    state.bootstrappedForApiUrl === config.lumibaseApiUrl
  ) {
    return { apiKey: state.applicationKey, config };
  }

  if (state.inflight) {
    const apiKey = await state.inflight;
    return { apiKey, config };
  }

  const bootstrapPromise = (async () => {
    const adminSecret = readAdminSecretForBootstrap(env);
    const appName = `demo-${new Date().toISOString().slice(0, 10)}`;

    let response: Response;
    try {
      response = await fetchImpl(`${config.lumibaseApiUrl}/api/v1/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Admin ${adminSecret}`,
        },
        body: JSON.stringify({ name: appName }),
        cache: 'no-store',
      });
    } catch {
      throw new UpstreamLumiBaseError(503, {
        error: {
          code: 'LUMIBASE_UNREACHABLE',
          message:
            'Unable to reach the configured LumiBase API during application bootstrap.',
          requestId: crypto.randomUUID(),
        },
      });
    }

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const envelope =
        parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody
          ? parsedBody
          : {
              error: {
                code:
                  response.status === 401
                    ? 'UNAUTHORIZED'
                    : 'APPLICATION_BOOTSTRAP_FAILED',
                message: `LumiBase application bootstrap failed with HTTP ${response.status}.`,
                requestId: crypto.randomUUID(),
              },
            };
      throw new UpstreamLumiBaseError(response.status, envelope);
    }

    const record =
      parsedBody && typeof parsedBody === 'object'
        ? (parsedBody as Record<string, unknown>)
        : null;
    const key = typeof record?.key === 'string' ? record.key : '';
    const appObj =
      record?.application && typeof record.application === 'object'
        ? (record.application as Record<string, unknown>)
        : null;
    const appId = typeof appObj?.id === 'string' ? appObj.id : null;

    if (!key) {
      throw new UpstreamLumiBaseError(502, {
        error: {
          code: 'INVALID_BOOTSTRAP_RESPONSE',
          message: 'LumiBase bootstrap response did not include an application key.',
          requestId: crypto.randomUUID(),
        },
      });
    }

    state.applicationKey = key;
    state.applicationId = appId;
    state.bootstrappedForApiUrl = config.lumibaseApiUrl;
    return key;
  })();

  state.inflight = bootstrapPromise;
  try {
    const apiKey = await bootstrapPromise;
    return { apiKey, config };
  } finally {
    state.inflight = null;
  }
}

export function getBootstrapStatusForTest(): {
  hasKey: boolean;
  applicationId: string | null;
} {
  return {
    hasKey: Boolean(state.applicationKey),
    applicationId: state.applicationId,
  };
}

export function resetBootstrapForTesting(): void {
  state.applicationKey = null;
  state.applicationId = null;
  state.bootstrappedForApiUrl = null;
  state.inflight = null;
}
