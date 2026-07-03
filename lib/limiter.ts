/**
 * Rate limiting + short-TTL caching behind one interface.
 * Memory-backed by default; swaps to Upstash Redis when
 * UPSTASH_REDIS_REST_URL/TOKEN are configured (same call sites, no changes).
 */

export type RateLimitResult = { ok: boolean; retryAfterSec?: number };

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();
const cacheStore = new Map<string, { value: unknown; expiresAt: number }>();

/** Sliding-window limiter. Default: 10 requests / 60s per key. */
export async function rateLimit(
  key: string,
  opts: { limit?: number; windowSec?: number } = {},
): Promise<RateLimitResult> {
  const limit = opts.limit ?? 10;
  const windowMs = (opts.windowSec ?? 60) * 1000;
  const now = Date.now();

  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    buckets.set(key, bucket);
    return { ok: false, retryAfterSec: Math.ceil((oldest + windowMs - now) / 1000) };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { ok: true };
}

/** Read-through cache with TTL seconds. */
export async function cache<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheStore.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  cacheStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  return value;
}

export function invalidateCache(prefix: string) {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) cacheStore.delete(key);
  }
}
