import type { WeddingScope } from "./scope";
import {
  deletionImpact,
  inviteDiff,
  validateEvent,
  type DeletionImpact,
  type EventFieldError,
  type EventInviteFact,
  type EventResponseFact,
} from "./event-rules";
import * as activity from "./activity";

/**
 * I/O for event management. All logic worth testing lives in `event-rules.ts`
 * (vitest only covers `lib/**`), so this module stays a thin, auditable shell:
 * every function takes a `WeddingScope` and filters on `wedding_id`. That is
 * the tenancy guarantee; RLS is the backstop.
 */

export type EventVisibility = "all" | "invited_only";

/**
 * The full `events` row. Deliberately separate from `lib/types.ts`'s
 * `EventRow`, which is a narrower projection several existing pages select
 * into — widening that type would break them, and this task does not refactor
 * their queries.
 */
export type EventDetailRow = {
  id: string;
  wedding_id: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  dress_code: string | null;
  visibility: EventVisibility;
  rsvp_enabled: boolean;
  seating_published_at: string | null;
  sort_order: number;
};

export type EventWithCounts = EventDetailRow & {
  /** Households with an invite row — the list's "N invited". */
  invitedHouseholds: number;
  /** Households where at least one guest actually answered. */
  respondedHouseholds: number;
};

export type EventInput = {
  name: string;
  startsAt?: string | null;
  endsAt?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  dressCode?: string | null;
  visibility?: EventVisibility;
  rsvpEnabled?: boolean;
};

/** Thrown when `validateEvent` rejects a draft, carrying per-field messages. */
export class EventValidationError extends Error {
  constructor(public errors: EventFieldError[]) {
    super(errors.map((e) => e.message).join(" "));
    this.name = "EventValidationError";
  }
}

const EVENT_COLS =
  "id, wedding_id, name, starts_at, ends_at, venue_name, venue_address, dress_code, visibility, rsvp_enabled, seating_published_at, sort_order";

/** Blank strings from a form mean "not set", not an empty value. */
function orNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads the invite and response facts `deletionImpact` needs, wedding-scoped.
 *
 * `guest_event_responses` has no `household_id`, so guests are read purely to
 * map `guest_id -> household_id`. A response whose guest is missing is
 * impossible under the foreign key, but is kept under a synthetic key rather
 * than dropped: undercounting here would understate what a delete destroys.
 */
async function readFacts(
  scope: WeddingScope,
  eventId?: string,
): Promise<{ invites: EventInviteFact[]; responses: EventResponseFact[] }> {
  let inviteQuery = scope.db
    .from("household_event_invites")
    .select("event_id, household_id")
    .eq("wedding_id", scope.weddingId);
  let responseQuery = scope.db
    .from("guest_event_responses")
    .select("guest_id, event_id, attending, meal_option_id")
    .eq("wedding_id", scope.weddingId);
  if (eventId !== undefined) {
    inviteQuery = inviteQuery.eq("event_id", eventId);
    responseQuery = responseQuery.eq("event_id", eventId);
  }

  const [invitesResult, responsesResult, guestsResult] = await Promise.all([
    inviteQuery,
    responseQuery,
    scope.db.from("guests").select("id, household_id").eq("wedding_id", scope.weddingId),
  ]);
  if (invitesResult.error) throw new Error(invitesResult.error.message);
  if (responsesResult.error) throw new Error(responsesResult.error.message);
  if (guestsResult.error) throw new Error(guestsResult.error.message);

  const guestRows: Array<{ id: string; household_id: string }> = guestsResult.data ?? [];
  const householdOf = new Map(guestRows.map((g) => [g.id, g.household_id]));

  const inviteRows: EventInviteFact[] = invitesResult.data ?? [];
  const responseRows: Array<{
    guest_id: string;
    event_id: string;
    attending: EventResponseFact["attending"];
    meal_option_id: string | null;
  }> = responsesResult.data ?? [];

  return {
    invites: inviteRows,
    responses: responseRows.map((r) => ({
      event_id: r.event_id,
      guest_id: r.guest_id,
      household_id: householdOf.get(r.guest_id) ?? `orphan:${r.guest_id}`,
      attending: r.attending,
      meal_option_id: r.meal_option_id,
    })),
  };
}

/** Confirms an event belongs to this wedding before any write touches it. */
async function requireEvent(scope: WeddingScope, id: string): Promise<EventDetailRow> {
  const { data, error } = await scope.db
    .from("events")
    .select(EVENT_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const event: EventDetailRow = data;
  return event;
}

/**
 * Events in display order with their invited and responded household counts.
 *
 * The counts come from the same `deletionImpact` the delete dialog uses, so
 * the number on the list and the number in the confirmation cannot drift
 * apart — they are the same function over the same rows.
 */
export async function list(scope: WeddingScope): Promise<EventWithCounts[]> {
  const [eventsResult, facts] = await Promise.all([
    scope.db
      .from("events")
      .select(EVENT_COLS)
      .eq("wedding_id", scope.weddingId)
      .order("sort_order"),
    readFacts(scope),
  ]);
  if (eventsResult.error) throw new Error(eventsResult.error.message);
  const events: EventDetailRow[] = eventsResult.data ?? [];

  return events.map((event) => {
    const impact = deletionImpact(event.id, facts.invites, facts.responses);
    return {
      ...event,
      invitedHouseholds: impact.households,
      respondedHouseholds: impact.replied,
    };
  });
}

export async function get(scope: WeddingScope, id: string): Promise<EventDetailRow> {
  return requireEvent(scope, id);
}

/** Validated, wedding-scoped patch shared by create and update. */
function toRow(input: EventInput): {
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  dress_code: string | null;
  visibility: EventVisibility;
  rsvp_enabled: boolean;
} {
  const validation = validateEvent({
    name: input.name,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
  if (!validation.ok) throw new EventValidationError(validation.errors);

  return {
    name: validation.value.name,
    starts_at: validation.value.startsAt,
    ends_at: validation.value.endsAt,
    venue_name: orNull(input.venueName),
    venue_address: orNull(input.venueAddress),
    dress_code: orNull(input.dressCode),
    visibility: input.visibility ?? "all",
    rsvp_enabled: input.rsvpEnabled ?? true,
  };
}

/** Appends to the end of the current order. Only the name is required. */
export async function create(
  scope: WeddingScope,
  input: EventInput,
  actorId?: string,
): Promise<EventDetailRow> {
  const row = toRow(input);

  const { data: last, error: lastError } = await scope.db
    .from("events")
    .select("sort_order")
    .eq("wedding_id", scope.weddingId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(lastError.message);
  const lastRow: { sort_order: number } | null = last;

  const { data, error } = await scope.db
    .from("events")
    .insert({
      ...row,
      wedding_id: scope.weddingId,
      sort_order: lastRow === null ? 0 : lastRow.sort_order + 1,
    })
    .select(EVENT_COLS)
    .single();
  if (error) throw new Error(error.message);
  const created: EventDetailRow = data;

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "event.created",
    payload: { eventId: created.id, name: created.name },
  });
  return created;
}

/**
 * Last write wins, consistent with the rest of this admin. Renaming and
 * re-timing never touch responses; turning `rsvpEnabled` off retains them and
 * simply stops collecting — the warning about that belongs in the UI.
 */
export async function update(
  scope: WeddingScope,
  id: string,
  input: EventInput,
  actorId?: string,
): Promise<EventDetailRow> {
  const row = toRow(input);

  const { data, error } = await scope.db
    .from("events")
    .update(row)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(EVENT_COLS)
    .single();
  if (error) throw new Error(error.message);
  const updated: EventDetailRow = data;

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "event.updated",
    payload: { eventId: id, name: updated.name },
  });
  return updated;
}

/**
 * The most dangerous action in this feature. Deleting cascades to
 * `household_event_invites` and `guest_event_responses` by foreign key, so the
 * caller must show `impactOf()` first and take a typed confirmation.
 *
 * The impact is re-read here and written to the activity log, so there is a
 * durable record of exactly what was destroyed even though there is no undo.
 */
export async function remove(
  scope: WeddingScope,
  id: string,
  actorId?: string,
): Promise<DeletionImpact> {
  const event = await requireEvent(scope, id);
  const impact = await impactOf(scope, id);

  const { error } = await scope.db
    .from("events")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "event.removed",
    payload: { eventId: id, name: event.name, destroyed: impact },
  });
  return impact;
}

/**
 * Writes `sort_order` to match the given order. Ids outside this wedding match
 * nothing, so a foreign id is a silent no-op rather than a cross-tenant write.
 */
export async function reorder(
  scope: WeddingScope,
  orderedIds: string[],
  actorId?: string,
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      scope.db
        .from("events")
        .update({ sort_order: index })
        .eq("wedding_id", scope.weddingId)
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "event.reordered",
    payload: { order: orderedIds },
  });
}

export async function invitedHouseholdIds(
  scope: WeddingScope,
  eventId: string,
): Promise<string[]> {
  const { data, error } = await scope.db
    .from("household_event_invites")
    .select("household_id")
    .eq("wedding_id", scope.weddingId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  const rows: Array<{ household_id: string }> = data ?? [];
  return rows.map((r) => r.household_id);
}

/** The opposite direction: which events a household is invited to. */
export async function invitedEventIds(
  scope: WeddingScope,
  householdId: string,
): Promise<string[]> {
  const { data, error } = await scope.db
    .from("household_event_invites")
    .select("event_id")
    .eq("wedding_id", scope.weddingId)
    .eq("household_id", householdId);
  if (error) throw new Error(error.message);
  const rows: Array<{ event_id: string }> = data ?? [];
  return rows.map((r) => r.event_id);
}

/**
 * Makes the invite list for an event exactly `householdIds`.
 *
 * `inviteDiff` means an unchanged selection writes nothing at all — no churn,
 * no pointless cascade triggering.
 *
 * Newly invited households get a placeholder `guest_event_responses` row per
 * guest, matching what `guests.add()` already does for existing invites, so
 * both paths leave the same shape. The upsert ignores duplicates, so
 * re-inviting a household never resets a reply it already gave.
 *
 * Un-inviting removes only the invite row. Existing responses are retained on
 * purpose: the spec requires invite changes to be reversible, and only
 * deleting the event itself may destroy replies.
 */
export async function setInvites(
  scope: WeddingScope,
  eventId: string,
  householdIds: string[],
  actorId?: string,
): Promise<{ added: number; removed: number }> {
  await requireEvent(scope, eventId);

  const current = await invitedHouseholdIds(scope, eventId);
  const { toAdd, toRemove } = inviteDiff(current, householdIds);
  if (toAdd.length === 0 && toRemove.length === 0) return { added: 0, removed: 0 };

  if (toAdd.length > 0) {
    // Only households in this wedding may be invited.
    const { data: valid, error: validError } = await scope.db
      .from("households")
      .select("id")
      .eq("wedding_id", scope.weddingId)
      .in("id", toAdd);
    if (validError) throw new Error(validError.message);
    const validRows: Array<{ id: string }> = valid ?? [];
    const validIds = validRows.map((h) => h.id);

    if (validIds.length > 0) {
      const { error } = await scope.db.from("household_event_invites").insert(
        validIds.map((householdId) => ({
          household_id: householdId,
          event_id: eventId,
          wedding_id: scope.weddingId,
        })),
      );
      if (error) throw new Error(error.message);

      const { data: guests, error: guestsError } = await scope.db
        .from("guests")
        .select("id")
        .eq("wedding_id", scope.weddingId)
        .in("household_id", validIds);
      if (guestsError) throw new Error(guestsError.message);
      const guestRows: Array<{ id: string }> = guests ?? [];

      if (guestRows.length > 0) {
        const { error: responseError } = await scope.db.from("guest_event_responses").upsert(
          guestRows.map((g) => ({
            guest_id: g.id,
            event_id: eventId,
            wedding_id: scope.weddingId,
          })),
          { onConflict: "guest_id,event_id", ignoreDuplicates: true },
        );
        if (responseError) throw new Error(responseError.message);
      }
    }
  }

  if (toRemove.length > 0) {
    const { error } = await scope.db
      .from("household_event_invites")
      .delete()
      .eq("wedding_id", scope.weddingId)
      .eq("event_id", eventId)
      .in("household_id", toRemove);
    if (error) throw new Error(error.message);
  }

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "event.invites_changed",
    payload: { eventId, added: toAdd, removed: toRemove },
  });
  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * The real cost of deleting `eventId`, for the confirmation dialog.
 *
 * Reads only this event's rows, then hands them to the pure `deletionImpact`,
 * which filters by event id again — the same function `list()` uses for its
 * counts, so the dialog and the list can never disagree.
 */
export async function impactOf(scope: WeddingScope, eventId: string): Promise<DeletionImpact> {
  await requireEvent(scope, eventId);
  const facts = await readFacts(scope, eventId);
  return deletionImpact(eventId, facts.invites, facts.responses);
}
