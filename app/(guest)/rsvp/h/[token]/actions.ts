"use server";

import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as rsvpData from "@/lib/data/rsvp";
import { RsvpValidationError } from "@/lib/data/rsvp";
import { confirmationHtml } from "@/lib/email/send";
import { rateLimit } from "@/lib/limiter";
import type { SubmitRsvpPayload } from "@/lib/types";
import {
  guestPayloadSchema,
  type GuestRsvpDto,
} from "@/lib/domain/rsvp-validation";
import type { ResponseRow } from "@/lib/types";

export type SubmitResult =
  | {
      ok: true;
      status: string;
      guests: GuestRsvpDto[];
      responses: ResponseRow[];
    }
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
  const parsed = guestPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "invalid_payload" };
  const limit = await rateLimit(`rsvp:${token}`, { limit: 30, windowSec: 60 });
  if (!limit.ok) return { ok: false, error: "rate_limited" };
  const scope = defaultScope();
  try {
    const household = await households.byAccessToken(scope, token);
    if (!household) return { ok: false, error: "not_found" };
    const confirmation =
      parsed.data.complete && household.email
        ? {
            recipient: household.email,
            ...confirmationHtml({
              accessToken: household.access_token,
              locale: household.preferred_locale,
              outcome: [
                ...parsed.data.responses,
                ...(parsed.data.new_plus_ones ?? []).flatMap(
                  (p) => p.responses,
                ),
              ].every((r) => r.attending === "no")
                ? "declined"
                : "completed",
            }),
          }
        : undefined;
    const result = await rsvpData.submit(scope, household.id, {
      ...parsed.data,
      via: "guest",
      confirmation,
    });
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof RsvpValidationError) return { ok: false, error: e.code };
    console.error("saveRsvp failed:", e);
    return { ok: false, error: "unknown" };
  }
}

export async function rememberLocale(
  token: string,
  locale: string,
): Promise<void> {
  if (!["en", "es", "vi"].includes(locale)) return;
  const scope = defaultScope();
  const household = await households.byAccessToken(scope, token);
  if (household)
    await households.setPreferredLocale(scope, household.id, locale);
}
