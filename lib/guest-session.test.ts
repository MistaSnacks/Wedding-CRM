import { describe, it, expect, beforeAll } from "vitest";
import { signGuestSession, verifyGuestSession } from "./guest-session-core";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-42";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "placeholder-anon-key-placeholder";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-key-placeholder";
});

describe("guest session", () => {
  it("round-trips a valid session", async () => {
    const token = await signGuestSession({ householdId: "h1", weddingId: "w1" });
    const session = await verifyGuestSession(token);
    expect(session).toEqual({ householdId: "h1", weddingId: "w1" });
  });

  it("rejects a tampered token", async () => {
    const token = await signGuestSession({ householdId: "h1", weddingId: "w1" });
    const tampered = token.slice(0, -4) + "AAAA";
    expect(await verifyGuestSession(tampered)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyGuestSession("not-a-jwt")).toBeNull();
  });
});
