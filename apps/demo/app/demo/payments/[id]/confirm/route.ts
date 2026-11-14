import { NextResponse } from 'next/server';
import {
  enforceRateLimit,
  handleRouteError,
  readValidatedJsonBody,
} from '@/lib/server/http-helpers';
import { confirmPaymentInLumiBase } from '@/lib/server/lumibase-client';
import {
  RequestValidationError,
  validatePaymentId,
  validateTransactionHash,
} from '@/lib/server/validation';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const { id } = await context.params;
    const validId = validatePaymentId(id);

    const rawBody = await readValidatedJsonBody(request);
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      throw new RequestValidationError('Request body must be a JSON object.');
    }

    const txHash = validateTransactionHash((rawBody as Record<string, unknown>).transactionHash);

    const result = await confirmPaymentInLumiBase(validId, txHash);

    return NextResponse.json(result.body, {
      status: result.status,
      headers: {
        'Cache-Control': 'no-store',
        ...(result.headers ?? {}),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
