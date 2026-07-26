/**
 * Pure rules for event management. No I/O, no React, no `Date.now()` — vitest
 * only covers `lib/**`, so everything worth testing lives here and
 * `lib/data/events.ts` stays a thin shell around Supabase.
 */

/** One `household_event_invites` row, as read. */
export type EventInviteFact = { event_id: string; household_id: string };

/**
 * One `guest_event_responses` row plus the owning household. The table itself
 * only carries `guest_id`; the caller joins `guests.household_id` on, because
 * the deletion dialog counts households.
 */
export type EventResponseFact = {
  event_id: string;
  household_id: string;
  guest_id: string;
  attending: "pending" | "yes" | "no";
  meal_option_id: string | null;
};

/**
 * What deleting an event destroys. Every field is a count of rows that the
 * cascade actually removes — the confirmation dialog states these numbers, and
 * a number that does not match reality is worse than showing no number.
 *
 * Units differ per field on purpose; the dialog must say which is which.
 * - `households`  — invited households (rows removed from `household_event_invites`)
 * - `replied`     — households where at least one guest actually answered
 * - `mealsChosen` — guests with a meal recorded for this event
 * - `responseRows`— every `guest_event_responses` row removed, replies or not
 */
export type DeletionImpact = {
  households: number;
  replied: number;
  mealsChosen: number;
  responseRows: number;
};

export type InviteDiff = { toAdd: string[]; toRemove: string[] };

export type EventFieldError = { field: "name" | "startsAt" | "endsAt"; message: string };

export type EventDraft = {
  name: string;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type EventValidation =
  | { ok: true; value: { name: string; startsAt: string | null; endsAt: string | null } }
  | { ok: false; errors: EventFieldError[] };

/**
 * Exact cost of deleting `eventId`.
 *
 * Both lists may span every event in the wedding; this filters to `eventId`
 * first. Counting unfiltered would report the whole wedding's RSVPs as being
 * at risk — and a guest's meal choice is copied onto their response row for
 * *every* event they attend, so an unfiltered meal count multiplies by the
 * number of events.
 *
 * `replied` excludes `attending === 'pending'`: `guests.add()` eagerly inserts
 * a placeholder row per invited event, so a household with placeholders only
 * has not replied to anything. Those rows are still deleted, so they are
 * counted in `responseRows`.
 *
 * `mealsChosen` counts any non-null `meal_option_id`, including on a declined
 * reply. This deliberately diverges from `metrics.mealCounts`, which filters to
 * `attending === 'yes'` because it answers "how many entrees do we order".
 * This function answers "how much data am I about to destroy", and a stored
 * meal choice is destroyed whatever the reply says.
 *
 * Responses are deduped by guest and invites by household, so a repeated row
 * cannot inflate a count.
 */
export function deletionImpact(
  eventId: string,
  invites: EventInviteFact[],
  responses: EventResponseFact[],
): DeletionImpact {
  const mine = responses.filter((r) => r.event_id === eventId);

  const households = new Set(
    invites.filter((i) => i.event_id === eventId).map((i) => i.household_id),
  );
  const replied = new Set(
    mine.filter((r) => r.attending !== "pending").map((r) => r.household_id),
  );
  const mealsChosen = new Set(
    mine.filter((r) => r.meal_option_id !== null).map((r) => r.guest_id),
  );

  return {
    households: households.size,
    replied: replied.size,
    mealsChosen: mealsChosen.size,
    responseRows: mine.length,
  };
}

/**
 * What to write so the invite list for an event matches `selected`.
 *
 * Set-based and order-independent: re-saving an unchanged selection returns two
 * empty arrays, so the caller writes nothing. That keeps a no-op save from
 * churning rows (and from firing cascade side effects on responses).
 */
export function inviteDiff(current: string[], selected: string[]): InviteDiff {
  const currentSet = new Set(current);
  const selectedSet = new Set(selected);
  return {
    toAdd: [...selectedSet].filter((id) => !currentSet.has(id)),
    toRemove: [...currentSet].filter((id) => !selectedSet.has(id)),
  };
}

/** Blank, whitespace-only, null and undefined all mean "not set". */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Only the name is required — a half-finished event is normal months out, so
 * date, time and venue are all optional. An end before its start is the one
 * genuine contradiction.
 *
 * Dates are compared as instants via `Date.parse`, not as strings: an ISO
 * string with an offset can sort earlier as text while being later in time.
 * An unparseable date is an error rather than being silently dropped, because
 * a NaN comparison would let a bad range through.
 */
export function validateEvent(draft: EventDraft): EventValidation {
  const errors: EventFieldError[] = [];

  const name = draft.name.trim();
  if (name.length === 0) {
    errors.push({ field: "name", message: "Give this event a name." });
  }

  const startsAt = blankToNull(draft.startsAt);
  const endsAt = blankToNull(draft.endsAt);

  const startMs = startsAt === null ? null : Date.parse(startsAt);
  const endMs = endsAt === null ? null : Date.parse(endsAt);

  if (startMs !== null && Number.isNaN(startMs)) {
    errors.push({ field: "startsAt", message: "That start date is not a real date." });
  }
  if (endMs !== null && Number.isNaN(endMs)) {
    errors.push({ field: "endsAt", message: "That end date is not a real date." });
  }

  if (
    startMs !== null &&
    endMs !== null &&
    !Number.isNaN(startMs) &&
    !Number.isNaN(endMs) &&
    endMs < startMs
  ) {
    errors.push({ field: "endsAt", message: "This event ends before it starts." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { name, startsAt, endsAt } };
}
