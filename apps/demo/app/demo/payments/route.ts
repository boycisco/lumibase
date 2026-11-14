import { NextResponse } from 'next/server';
import {
  enforceRateLimit,
  handleRouteError,
  readValidatedJsonBody,
} from '@/lib/server/http-helpers';
import { createPaymentInLumiBase } from '@/lib/server/lumibase-client';
import { validateCreatePaymentBody } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const rawBody = await readValidatedJsonBody(request);
    const validated = validateCreatePaymentBody(rawBody);
    const result = await createPaymentInLumiBase(validated);

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
