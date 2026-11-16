import { createHash } from "node:crypto";

export type RateLimitResult = { ok: boolean; retryAfterSec?: number };
const buckets = new Map<string, { count: number; expiresAt: number }>();
const cacheStore = new Map<string, { value: unknown; expiresAt: number }>();
const MAX_LOCAL_KEYS = 5000;

function prune<T extends { expiresAt: number }>(store: Map<string, T>) {
  const now = Date.now();
  for (const [key, value] of store) if (value.expiresAt <= now) store.delete(key);
  while (store.size >= MAX_LOCAL_KEYS) store.delete(store.keys().next().value!);
}

// Atomic fixed window starting with the first request. Redis owns the clock.
const SCRIPT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}`;

/** Shared production limits: Redis when configured, otherwise PostgreSQL.
 * Local memory is only a bounded development/test fallback. Backend outages
 * fail closed rather than silently disabling abuse protection.
 */
export async function rateLimit(key: string, opts: { limit?: number; windowSec?: number } = {}): Promise<RateLimitResult> {
  const limit = opts.limit ?? 10;
  const windowSec = opts.windowSec ?? 60;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSec) || windowSec < 1) throw new Error("Invalid rate limit");
  const digest = createHash("sha256").update(key).digest("hex");
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    if (url && token) {
      const response = await fetch(url, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", SCRIPT, "1", `guest-crm:limit:${digest}`, String(windowSec)]),
        cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      const body = await response.json();
      if (!response.ok || body.error || !Array.isArray(body.result)) throw new Error("Rate limit store unavailable");
      const [count, ttl] = body.result as number[];
      if (!Number.isInteger(count) || count < 1 || !Number.isFinite(ttl) || ttl < 0) throw new Error("Invalid rate limit result");
      return count <= limit ? { ok: true } : { ok: false, retryAfterSec: Math.max(1, ttl) };
    }
    if (process.env.NODE_ENV === "production") {
      const { adminDb } = await import("@/lib/supabase/admin");
      const { data, error } = await adminDb().rpc("consume_rate_limit", { p_key: digest, p_limit: limit, p_window_seconds: windowSec });
      if (error || !data) throw new Error("Rate limit store unavailable");
      return data as RateLimitResult;
    }
  } catch {
    console.error("Shared rate limit unavailable");
    return { ok: false, retryAfterSec: 30 };
  }
  prune(buckets);
  const bucket = buckets.get(digest) ?? { count: 0, expiresAt: Date.now() + windowSec * 1000 };
  bucket.count++;
  buckets.set(digest, bucket);
  return bucket.count <= limit ? { ok: true } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.expiresAt - Date.now()) / 1000)) };
}

/** Production reads stay fresh across instances. The bounded local cache is
 * for development only; a future shared cache must have shared invalidation.
 */
export async function cache<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === "production") return fn();
  prune(cacheStore);
  const hit = cacheStore.get(key);
  if (hit) return hit.value as T;
  const value = await fn();
  cacheStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  return value;
}

export function invalidateCache(prefix: string) {
  for (const key of cacheStore.keys()) if (key.startsWith(prefix)) cacheStore.delete(key);
}
