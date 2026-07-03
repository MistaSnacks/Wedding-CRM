"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import { createGuestSession } from "@/lib/guest-session";
import { rateLimit } from "@/lib/limiter";
import { sendVerificationEmail } from "@/lib/email/send";

export type EntryResult = { ok: true } | { ok: false; error: "rate_limited" | "not_found" | "invalid" };

async function clientKey(prefix: string): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${prefix}:${ip}`;
}

export async function enterWithCode(_prev: EntryResult | null, formData: FormData): Promise<EntryResult> {
  const code = String(formData.get("code") ?? "").trim();
  if (code.length < 4 || code.length > 12) return { ok: false, error: "invalid" };

  const limit = await rateLimit(await clientKey("code"), { limit: 10, windowSec: 60 });
  if (!limit.ok) return { ok: false, error: "rate_limited" };

  const scope = defaultScope();
  const household = await households.byInviteCode(scope, code);
  if (!household) return { ok: false, error: "not_found" };

  await createGuestSession(household.id, scope.weddingId);
  redirect(`/rsvp/h/${household.access_token}`);
}

/**
 * "Find my invitation": on a match we EMAIL the household's address a link —
 * never open the RSVP directly, and the response is identical whether or not
 * anything matched (no guest-list enumeration).
 */
export async function findInvitation(
  _prev: { done: boolean } | null,
  formData: FormData,
): Promise<{ done: boolean; rateLimited?: boolean }> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  const limit = await rateLimit(await clientKey("find"), { limit: 5, windowSec: 300 });
  if (!limit.ok) return { done: false, rateLimited: true };

  if (name && email) {
    const scope = defaultScope();
    const match = await households.fuzzyFind(scope, name, email);
    if (match) {
      await sendVerificationEmail({
        to: match.email,
        accessToken: match.access_token,
        locale: match.preferred_locale,
      });
    }
  }
  return { done: true };
}
