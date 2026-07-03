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
