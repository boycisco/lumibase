import { NextResponse } from 'next/server';
import { DemoConfigurationError } from './config';
import { UpstreamLumiBaseError } from './bootstrap';
import {
  checkRateLimit,
  getClientIdentifier,
  MAX_JSON_BODY_BYTES,
} from './rate-limit';
import { RequestValidationError } from './validation';

export function jsonErrorEnvelope(
  status: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId: crypto.randomUUID(),
      },
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(extraHeaders ?? {}),
      },
    },
  );
}

export function enforceRateLimit(request: Request): NextResponse | null {
  const clientKey = getClientIdentifier(request.headers);
  const result = checkRateLimit(clientKey);
  if (!result.allowed) {
    return jsonErrorEnvelope(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Too many requests to the demo server. Please retry after the cooldown.',
      {
        'Retry-After': String(result.retryAfterSeconds),
      },
    );
  }
  return null;
}

export async function readValidatedJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_JSON_BODY_BYTES) {
      throw new RequestValidationError(
        `Request body exceeds maximum size of ${MAX_JSON_BODY_BYTES} bytes.`,
      );
    }
  }

  const rawText = await request.text();
  if (Buffer.byteLength(rawText, 'utf8') > MAX_JSON_BODY_BYTES) {
    throw new RequestValidationError(
      `Request body exceeds maximum size of ${MAX_JSON_BODY_BYTES} bytes.`,
    );
  }

  if (!rawText.trim()) {
    throw new RequestValidationError('Request body must be valid JSON.');
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new RequestValidationError('Request body must be valid JSON.');
  }
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof RequestValidationError) {
    return jsonErrorEnvelope(error.status, error.code, error.message);
  }

  if (error instanceof DemoConfigurationError) {
    return jsonErrorEnvelope(503, error.code, error.message);
  }

  if (error instanceof UpstreamLumiBaseError) {
    return NextResponse.json(error.body, {
      status: error.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return jsonErrorEnvelope(
    500,
    'INTERNAL_SERVER_ERROR',
    'An unexpected demo server error occurred.',
  );
}
