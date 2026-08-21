"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import { matchHouseholds, type EntrySearchResult } from "@/lib/domain/entry-match";
import { createGuestSession } from "@/lib/guest-session";
import { rateLimit } from "@/lib/limiter";

/**
 * Entry is name-first: the paper invite's QR opens the site with no code and
 * no per-guest link, so guests type a household member's name (or the
 * household email) and, after confirming their party on a card, go straight
 * into the RSVP — no emailed link round-trip. Direct entry is a deliberate
 * simplification for this wedding; the multi-tenant product keeps emailed
 * links as a per-wedding delivery mode (see docs/superpowers/specs/
 * 2026-07-23-multi-tenant-guest-entry-design.md and git history for the
 * previous enterWithCode / findInvitation actions).
 *
 * Anti-abuse: searches are rate-limited per IP, results reveal only the
 * household display name + member first names (the confirm card), and names
 * require first + last so single tokens can't browse the guest list.
 */

export type FindPartyResult = EntrySearchResult | { status: "rate_limited" };
export type EnterPartyResult = { status: "not_found" | "rate_limited" };

async function clientKey(prefix: string): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${prefix}:${ip}`;
}

export async function findParty(_prev: FindPartyResult | null, formData: FormData): Promise<FindPartyResult> {
  const name = String(formData.get("name") ?? "").slice(0, 120).trim();
  const email = String(formData.get("email") ?? "").slice(0, 120).trim();

  const limit = await rateLimit(await clientKey("find"), { limit: 10, windowSec: 60 });
  if (!limit.ok) return { status: "rate_limited" };

  // Two boxes, either works. Try the email first (exact match), then the
  // name; a non-email string in the email box falls back to name matching so
  // a name typed in the wrong box still finds its party.
  const tries: string[] = [];
  if (email.includes("@")) tries.push(email);
  if (name) tries.push(name);
  if (email && !email.includes("@")) tries.push(email);
  if (tries.length === 0) return { status: "too_short" };

  const scope = defaultScope();
  const all = await households.list(scope);

  let last: FindPartyResult = { status: "none" };
  for (const q of tries) {
    last = matchHouseholds(q, all);
    if (last.status === "matches") return last;
  }
  return last;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enterParty(_prev: EnterPartyResult | null, formData: FormData): Promise<EnterPartyResult> {
  const id = String(formData.get("household") ?? "");
  if (!UUID_RE.test(id)) return { status: "not_found" };

  const limit = await rateLimit(await clientKey("enter"), { limit: 20, windowSec: 60 });
  if (!limit.ok) return { status: "rate_limited" };

  const scope = defaultScope();
  const household = await households.byId(scope, id);
  if (!household) return { status: "not_found" };

  await createGuestSession(household.id, scope.weddingId);
  redirect(`/rsvp/h/${household.access_token}`);
}
