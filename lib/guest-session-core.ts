import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

export const GUEST_COOKIE = "guest_session";
export const GUEST_SESSION_MAX_AGE_SEC = 14 * 24 * 60 * 60;

export type GuestSession = { householdId: string; weddingId: string };

function secret(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function signGuestSession(s: GuestSession): Promise<string> {
  return new SignJWT({ hid: s.householdId, wid: s.weddingId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GUEST_SESSION_MAX_AGE_SEC}s`)
    .sign(secret());
}

export async function verifyGuestSession(token: string): Promise<GuestSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.hid !== "string" || typeof payload.wid !== "string") return null;
    return { householdId: payload.hid, weddingId: payload.wid };
  } catch {
    return null;
  }
}
