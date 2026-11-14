import { NextResponse } from 'next/server';
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_NAME,
  BASE_SEPOLIA_EXPLORER_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_DECIMALS,
} from '@/lib/lumibase/constants';
import type { DemoPublicConfig } from '@/lib/lumibase/types';
import { ensureApplicationApiKey } from '@/lib/server/bootstrap';
import { enforceRateLimit, handleRouteError } from '@/lib/server/http-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const { config } = await ensureApplicationApiKey();

    const publicConfig: DemoPublicConfig = {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      chainName: BASE_SEPOLIA_CHAIN_NAME,
      usdc: BASE_SEPOLIA_USDC_ADDRESS,
      decimals: BASE_SEPOLIA_USDC_DECIMALS,
      recipient: config.demoRecipient,
      explorer: BASE_SEPOLIA_EXPLORER_URL,
    };

    return NextResponse.json(publicConfig, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
