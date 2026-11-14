const WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 120;
export const MAX_JSON_BODY_BYTES = 16 * 1024; // 16 KiB

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export function getClientIdentifier(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'local-client';
}

export function checkRateLimit(
  clientKey: string,
  maxRequests = DEFAULT_MAX_REQUESTS_PER_WINDOW,
  now = Date.now(),
): RateLimitResult {
  if (buckets.size > 5000) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  const existing = buckets.get(clientKey);
  if (!existing || existing.resetAt <= now) {
    buckets.set(clientKey, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, maxRequests - 1),
    };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    );
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, maxRequests - existing.count),
  };
}

export function resetRateLimiterForTesting(): void {
  buckets.clear();
}
