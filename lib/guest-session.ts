import { cookies } from "next/headers";
import {
  GUEST_COOKIE,
  GUEST_SESSION_MAX_AGE_SEC,
  signGuestSession,
  verifyGuestSession,
  type GuestSession,
} from "./guest-session-core";

export type { GuestSession };

export async function createGuestSession(householdId: string, weddingId: string): Promise<void> {
  const token = await signGuestSession({ householdId, weddingId });
  const store = await cookies();
  store.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GUEST_SESSION_MAX_AGE_SEC,
    path: "/",
  });
}

export async function getGuestSession(): Promise<GuestSession | null> {
  const store = await cookies();
  const token = store.get(GUEST_COOKIE)?.value;
  if (!token) return null;
  return verifyGuestSession(token);
}
