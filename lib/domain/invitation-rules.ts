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

/**
 * How many NEW plus-ones the UI may offer. Mirrors validateSubmission: a slot
 * only counts as open when the party-size cap also has headroom for it, so the
 * guest is never offered a card the server would reject.
 */
export function openPlusOneSlots(rules: HouseholdRules, known: KnownGuest[]): number {
  const existingPlusOnes = known.filter((k) => k.origin === "plus_one").length;
  const bySlots = rules.plusOneSlots - existingPlusOnes;
  const byPartySize = rules.maxPartySize - known.length;
  return Math.max(0, Math.min(bySlots, byPartySize));
}

/**
 * Admin-side guard: a household must always be able to use what it was
 * granted. Raises maxPartySize so named guests + plus-one slots fit.
 */
export function normalizeHouseholdRules(rules: HouseholdRules, namedGuestCount: number): HouseholdRules {
  return {
    ...rules,
    maxPartySize: Math.max(1, rules.maxPartySize, namedGuestCount + rules.plusOneSlots),
  };
}

export type NamedKnownGuest = KnownGuest & { firstName: string; lastName: string };
export type IncomingPlusOne<R> = { firstName: string; lastName: string; responses: R[] };

/**
 * Makes plus-one submission idempotent: an incoming plus-one whose name
 * matches an existing plus_one guest (case-insensitive) is an UPDATE to that
 * guest, not a new insert. Autosaving twice must not consume a second slot.
 */
export function dedupePlusOnes<R>(
  known: NamedKnownGuest[],
  incoming: IncomingPlusOne<R>[],
): { existing: Array<{ guestId: string; responses: R[] }>; fresh: IncomingPlusOne<R>[] } {
  const norm = (s: string) => s.trim().toLowerCase();
  const existing: Array<{ guestId: string; responses: R[] }> = [];
  const fresh: IncomingPlusOne<R>[] = [];
  const claimed = new Set<string>();

  for (const p of incoming) {
    const match = known.find(
      (k) =>
        k.origin === "plus_one" &&
        !claimed.has(k.id) &&
        norm(k.firstName) === norm(p.firstName) &&
        norm(k.lastName) === norm(p.lastName),
    );
    if (match) {
      claimed.add(match.id);
      existing.push({ guestId: match.id, responses: p.responses });
    } else {
      fresh.push(p);
    }
  }
  return { existing, fresh };
}

/**
 * Invite codes are drawn from an unambiguous alphabet (see newInviteCode) and
 * are looked up case-insensitively, so the lookup is a SQL ILIKE. In a LIKE
 * pattern `%`, `_` and `\` are wildcards, and PostgREST additionally treats `*`
 * as an alias for `%` — meaning an unfiltered code like "AB%%" matches every
 * household whose code starts with AB, and authenticates the caller whenever
 * exactly one does. Reject those characters here rather than escaping them:
 * no real code contains any of them, and escaping cannot reach PostgREST's `*`.
 *
 * Returns the trimmed code, or null when it could not be a real one.
 */
export function normalizeInviteCode(raw: string): string | null {
  const code = raw.trim();
  if (code.length < 4 || code.length > 12) return null;
  if (!/^[A-Za-z0-9-]+$/.test(code)) return null;
  return code;
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
