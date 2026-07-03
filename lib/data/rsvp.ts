import type { WeddingScope } from "./scope";
import type { SubmitRsvpPayload, EventRow, MealOptionRow, QuestionRow, ResponseRow } from "@/lib/types";
import { validateSubmission, dedupePlusOnes, type SubmissionGuest } from "@/lib/domain/invitation-rules";
import { invalidateCache } from "@/lib/limiter";

export class RsvpValidationError extends Error {
  constructor(public code: string) {
    super(`rsvp validation failed: ${code}`);
  }
}

/** Everything the guest flow needs to render a household's RSVP. */
export async function getRsvpContext(scope: WeddingScope, householdId: string) {
  const [{ data: guests }, { data: invites }, { data: meals }, { data: questions }, { data: responses }] =
    await Promise.all([
      scope.db.from("guests").select("*").eq("household_id", householdId).order("created_at"),
      scope.db
        .from("household_event_invites")
        .select("events(id, name, starts_at, venue_name, rsvp_enabled, seating_published_at, sort_order)")
        .eq("household_id", householdId),
      scope.db.from("meal_options").select("id, name, is_kids_meal, sort_order, event_id").eq("wedding_id", scope.weddingId).order("sort_order"),
      scope.db.from("rsvp_questions").select("id, label, type, options, scope, sort_order, is_active").eq("wedding_id", scope.weddingId).eq("is_active", true).order("sort_order"),
      scope.db
        .from("guest_event_responses")
        .select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via")
        .eq("wedding_id", scope.weddingId),
    ]);

  const events = ((invites ?? []) as unknown as Array<{ events: EventRow }>)
    .map((i) => i.events)
    .filter((e) => e.rsvp_enabled)
    .sort((a, b) => a.sort_order - b.sort_order);

  const guestIds = new Set((guests ?? []).map((g: { id: string }) => g.id));

  return {
    guests: guests ?? [],
    events,
    meals: (meals ?? []) as MealOptionRow[],
    questions: (questions ?? []) as QuestionRow[],
    responses: ((responses ?? []) as ResponseRow[]).filter((r) => guestIds.has(r.guest_id)),
  };
}

/**
 * Validates with the domain engine, then submits atomically via the
 * submit_rsvp Postgres function. Throws RsvpValidationError on rule breaches.
 */
export async function submit(
  scope: WeddingScope,
  householdId: string,
  payload: SubmitRsvpPayload,
): Promise<{ status: string }> {
  const [{ data: household }, { data: guests }] = await Promise.all([
    scope.db
      .from("households")
      .select("id, max_party_size, plus_one_slots")
      .eq("wedding_id", scope.weddingId)
      .eq("id", householdId)
      .single(),
    scope.db.from("guests").select("id, origin, first_name, last_name").eq("household_id", householdId),
  ]);
  if (!household) throw new Error("household not found");

  const known = (guests ?? []).map(
    (g: { id: string; origin: "named" | "plus_one"; first_name: string; last_name: string }) => ({
      id: g.id,
      origin: g.origin,
      firstName: g.first_name,
      lastName: g.last_name,
    }),
  );

  // Idempotency: a re-submitted plus-one (autosave, retry, edit) matches the
  // guest row it already created instead of consuming another slot.
  const incoming = (payload.new_plus_ones ?? []).map((p) => ({
    firstName: p.first_name,
    lastName: p.last_name,
    responses: p.responses,
  }));
  const { existing: reusedPlusOnes, fresh } = dedupePlusOnes(known, incoming);

  payload = {
    ...payload,
    responses: [
      ...payload.responses,
      ...reusedPlusOnes.flatMap((r) =>
        r.responses.map((resp) => ({
          guest_id: r.guestId,
          event_id: resp.event_id,
          attending: resp.attending,
          meal_option_id: resp.meal_option_id ?? null,
        })),
      ),
    ],
    new_plus_ones: fresh.map((p) => ({
      first_name: p.firstName,
      last_name: p.lastName,
      responses: p.responses,
    })),
  };

  const submitted: SubmissionGuest[] = [
    ...Array.from(new Set(payload.responses.map((r) => r.guest_id))).map((guestId) => ({ guestId })),
    ...(payload.new_plus_ones ?? []).map((p) => ({
      newPlusOne: { firstName: p.first_name, lastName: p.last_name },
    })),
  ];

  const verdict = validateSubmission(
    { maxPartySize: household.max_party_size, plusOneSlots: household.plus_one_slots },
    known,
    submitted,
  );
  if (!verdict.ok) throw new RsvpValidationError(verdict.code);

  const { data, error } = await scope.db.rpc("submit_rsvp", {
    p_household_id: householdId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);

  invalidateCache(`metrics:${scope.weddingId}`);
  return data as { status: string };
}

export async function getDeadline(scope: WeddingScope): Promise<string | null> {
  const { data } = await scope.db
    .from("weddings")
    .select("rsvp_deadline")
    .eq("id", scope.weddingId)
    .single();
  return data?.rsvp_deadline ?? null;
}

export async function deadlinePassed(scope: WeddingScope): Promise<boolean> {
  const deadline = await getDeadline(scope);
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}
