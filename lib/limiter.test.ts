import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateLimit, cache } from "./limiter";

describe("rateLimit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit and blocks the next request", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit("k1", { limit: 3, windowSec: 60 })).ok).toBe(true);
    }
    const blocked = await rateLimit("k1", { limit: 3, windowSec: 60 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after the window passes", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("k2", { limit: 3, windowSec: 60 });
    expect((await rateLimit("k2", { limit: 3, windowSec: 60 })).ok).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect((await rateLimit("k2", { limit: 3, windowSec: 60 })).ok).toBe(true);
  });

  it("isolates keys", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("k3", { limit: 3, windowSec: 60 });
    expect((await rateLimit("k4", { limit: 3, windowSec: 60 })).ok).toBe(true);
  });
});

describe("cache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns cached value within TTL and refetches after", async () => {
    let calls = 0;
    const fn = async () => ++calls;
    expect(await cache("c1", 60, fn)).toBe(1);
    expect(await cache("c1", 60, fn)).toBe(1);
    vi.advanceTimersByTime(61_000);
    expect(await cache("c1", 60, fn)).toBe(2);
  });
});

describe("shared limiter",()=>{
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
  it("uses one atomic Redis call with a hashed key and honors TTL",async()=>{
    vi.stubEnv('UPSTASH_REDIS_REST_URL','https://redis.example');vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','test');
    const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({result:[4,17]})});vi.stubGlobal('fetch',fetcher);
    expect(await rateLimit('private@example.test',{limit:3})).toEqual({ok:false,retryAfterSec:17});
    const command=JSON.parse(fetcher.mock.calls[0][1].body);
    expect(command[0]).toBe('EVAL');expect(command[3]).toMatch(/^guest-crm:limit:[a-f0-9]{64}$/);
    expect(command.join(' ')).not.toContain('private@example.test');
  });
  it("fails closed when the shared backend is unavailable",async()=>{
    vi.stubEnv('UPSTASH_REDIS_REST_URL','https://redis.example');vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','test');
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));vi.spyOn(console,'error').mockImplementation(()=>{});
    expect(await rateLimit('failure')).toEqual({ok:false,retryAfterSec:30});
  });
  it("does not serve process-local cached data in production",async()=>{
    vi.stubEnv('NODE_ENV','production');let calls=0;const fn=async()=>++calls;
    expect(await cache('fresh',60,fn)).toBe(1);expect(await cache('fresh',60,fn)).toBe(2);
  });
});
