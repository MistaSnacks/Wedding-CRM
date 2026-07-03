/**
 * Invitation-rules engine — the single source of truth for what an RSVP
 * submission may contain. Pure functions; no I/O. The server validates every
 * submission here regardless of what the UI allowed.
 *
 * The client's three invitation types are configurations, not code paths:
 *   Named Guests Only  → plusOneSlots = 0
 *   Plus One Allowed   → plusOneSlots >= 1
 *   Family Invitation  → many named guests, plusOneSlots = 0 (or more if granted)
 */

export type HouseholdRules = { maxPartySize: number; plusOneSlots: number };
export type KnownGuest = { id: string; origin: "named" | "plus_one" };
export type SubmissionGuest =
  | { guestId: string }
  | { newPlusOne: { firstName: string; lastName: string } };

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "unknown_guest" | "over_party_size" | "no_plus_one_slot" | "empty_name" | "duplicate_guest";
    };

export function validateSubmission(
  rules: HouseholdRules,
  known: KnownGuest[],
  submitted: SubmissionGuest[],
): ValidationResult {
  const knownIds = new Set(known.map((k) => k.id));
  const existingPlusOnes = known.filter((k) => k.origin === "plus_one").length;

  const seen = new Set<string>();
  let newPlusOnes = 0;

  for (const s of submitted) {
    if ("guestId" in s) {
      if (!knownIds.has(s.guestId)) return { ok: false, code: "unknown_guest" };
      if (seen.has(s.guestId)) return { ok: false, code: "duplicate_guest" };
      seen.add(s.guestId);
    } else {
      const first = s.newPlusOne.firstName.trim();
      const last = s.newPlusOne.lastName.trim();
      if (!first || !last) return { ok: false, code: "empty_name" };
      newPlusOnes += 1;
    }
  }

  if (existingPlusOnes + newPlusOnes > rules.plusOneSlots) {
    return { ok: false, code: "no_plus_one_slot" };
  }

  const totalPartySize = known.length + newPlusOnes;
  if (totalPartySize > rules.maxPartySize || submitted.length > rules.maxPartySize) {
    return { ok: false, code: "over_party_size" };
  }

  return { ok: true };
}

export function computeHouseholdStatus(
  responses: Array<"pending" | "yes" | "no">,
  submittedComplete: boolean,
): "pending" | "started" | "completed" | "declined" {
  if (responses.length === 0) return "pending";
  const pending = responses.filter((r) => r === "pending").length;
  const no = responses.filter((r) => r === "no").length;

  if (no === responses.length) return "declined";
  if (submittedComplete && pending === 0) return "completed";
  if (responses.length - pending > 0) return "started";
  return "pending";
}
