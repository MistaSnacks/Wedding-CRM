"use server";

import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as rsvpData from "@/lib/data/rsvp";
import { RsvpValidationError } from "@/lib/data/rsvp";
import { sendConfirmationEmail } from "@/lib/email/send";
import { rateLimit } from "@/lib/limiter";
import type { SubmitRsvpPayload } from "@/lib/types";

export type SubmitResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

/**
 * Both autosave (complete=false) and final submit (complete=true).
 * The token in the URL is re-verified on every call — the household can only
 * ever write to itself.
 */
export async function saveRsvp(
  token: string,
  payload: Omit<SubmitRsvpPayload, "via">,
): Promise<SubmitResult> {
  const limit = await rateLimit(`rsvp:${token}`, { limit: 30, windowSec: 60 });
  if (!limit.ok) return { ok: false, error: "rate_limited" };

  const scope = defaultScope();
  const household = await households.byAccessToken(scope, token);
  if (!household) return { ok: false, error: "not_found" };

  if (await rsvpData.deadlinePassed(scope)) return { ok: false, error: "deadline_passed" };

  try {
    const result = await rsvpData.submit(scope, household.id, { ...payload, via: "guest" });
    if (payload.complete && household.email) {
      await sendConfirmationEmail({
        to: household.email,
        accessToken: household.access_token,
        locale: household.preferred_locale,
      });
    }
    return { ok: true, status: result.status };
  } catch (e) {
    if (e instanceof RsvpValidationError) return { ok: false, error: e.code };
    console.error("saveRsvp failed:", e);
    return { ok: false, error: "unknown" };
  }
}

export async function rememberLocale(token: string, locale: string): Promise<void> {
  if (!["en", "es", "vi"].includes(locale)) return;
  const scope = defaultScope();
  const household = await households.byAccessToken(scope, token);
  if (household) await households.setPreferredLocale(scope, household.id, locale);
}
