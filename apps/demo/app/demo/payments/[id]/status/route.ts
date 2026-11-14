import { NextResponse } from 'next/server';
import { enforceRateLimit, handleRouteError } from '@/lib/server/http-helpers';
import { getPaymentStatusFromLumiBase } from '@/lib/server/lumibase-client';
import { validatePaymentId } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const { id } = await context.params;
    const validId = validatePaymentId(id);
    const result = await getPaymentStatusFromLumiBase(validId);

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
