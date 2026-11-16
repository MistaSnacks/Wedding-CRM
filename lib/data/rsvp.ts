import type { WeddingScope } from "./scope";
import type {
  SubmitRsvpPayload,
  EventRow,
  MealOptionRow,
  QuestionRow,
  ResponseRow,
} from "@/lib/types";
import {
  GUEST_RSVP_COLUMNS,
  guestDto,
  type GuestRsvpDto,
} from "@/lib/domain/rsvp-validation";
import { invalidateCache } from "@/lib/limiter";

export class RsvpValidationError extends Error {
  constructor(public code: string) {
    super(`rsvp validation failed: ${code}`);
  }
}

/** Guest context is deliberately projected; administrative data never crosses this boundary. */
export async function getRsvpContext(scope: WeddingScope, householdId: string) {
  const guestResult = await scope.db
    .from("guests")
    .select(GUEST_RSVP_COLUMNS)
    .eq("wedding_id", scope.weddingId)
    .eq("household_id", householdId)
    .order("created_at");
  if (guestResult.error) throw new Error(guestResult.error.message);
  const guests = (guestResult.data ?? []).map((g) =>
    guestDto(g as unknown as GuestRsvpDto),
  );
  const results = await Promise.all([
    scope.db
      .from("household_event_invites")
      .select(
        "events(id, name, starts_at, ends_at, venue_name, venue_address, dress_code, rsvp_enabled, seating_published_at, sort_order)",
      )
      .eq("wedding_id", scope.weddingId)
      .eq("household_id", householdId),
    scope.db
      .from("meal_options")
      .select("id, name, is_kids_meal, sort_order, event_id, is_active, name_i18n")
      .eq("wedding_id", scope.weddingId)
      .order("sort_order"),
    scope.db
      .from("rsvp_questions")
      .select(
        "id, event_id, label, type, options, scope, sort_order, is_active",
      )
      .eq("wedding_id", scope.weddingId)
      .eq("is_active", true)
      .eq("scope", "household")
      .order("sort_order"),
    guests.length
      ? scope.db
          .from("guest_event_responses")
          .select(
            "guest_id, event_id, attending, meal_option_id, responded_at, responded_via",
          )
          .eq("wedding_id", scope.weddingId)
          .in(
            "guest_id",
            guests.map((g) => g.id),
          )
      : Promise.resolve({ data: [], error: null }),
    scope.db
      .from("rsvp_answers")
      .select("question_id, value")
      .eq("wedding_id", scope.weddingId)
      .eq("household_id", householdId)
      .is("guest_id", null),
  ]);
  for (const result of results)
    if (result.error) throw new Error(result.error.message);
  const allEvents = (
    (results[0].data as unknown as Array<{ events: EventRow }>) ?? []
  )
    .map((i) => i.events)
    .filter(Boolean)
    .sort((a, b) => a.sort_order - b.sort_order);
  return {
    guests,
    allEvents,
    events: allEvents.filter((e) => e.rsvp_enabled),
    // Dishes on offer, plus any hidden dish this household already chose: a
    // guest who picked Fish before it left the menu must still read "Fish",
    // not "No meal selected". The form offers a hidden dish only to its owner.
    meals: (results[1].data as MealOptionRow[]).filter(
      (m) =>
        m.is_active ||
        (results[3].data as ResponseRow[]).some((r) => r.meal_option_id === m.id),
    ),
    questions: (results[2].data as QuestionRow[]).filter(
      (q) =>
        !q.event_id ||
        allEvents.some((e) => e.id === q.event_id && e.rsvp_enabled),
    ),
    responses: results[3].data as ResponseRow[],
    answers: results[4].data as Array<{
      question_id: string;
      value: string | boolean;
    }>,
  };
}

/** The database locks the household and validates references/caps in the transaction. */
export async function submit(
  scope: WeddingScope,
  householdId: string,
  payload: SubmitRsvpPayload,
): Promise<{
  status: string;
  guests: GuestRsvpDto[];
  responses: ResponseRow[];
}> {
  const { data: household, error: lookupError } = await scope.db
    .from("households")
    .select("id")
    .eq("wedding_id", scope.weddingId)
    .eq("id", householdId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!household) throw new RsvpValidationError("not_found");
  const { data, error } = await scope.db.rpc("submit_rsvp", {
    p_household_id: householdId,
    p_payload: payload,
  });
  if (error) {
    const codes = [
      "not_found",
      "deadline_passed",
      "empty_name",
      "unknown_guest",
      "no_plus_one_slot",
      "over_party_size",
      "invalid_meal",
      "invalid_answer",
      "invalid_payload",
      "incomplete_rsvp",
    ];
    if (codes.includes(error.message))
      throw new RsvpValidationError(error.message);
    throw new Error(error.message);
  }
  invalidateCache(`metrics:${scope.weddingId}`);
  return data as {
    status: string;
    guests: GuestRsvpDto[];
    responses: ResponseRow[];
  };
}

/**
 * "Will you need hotel recommendations?" has no stable key — the question bank
 * is free-form and the couple can reword it in the admin — so the English label
 * containing "hotel" is the signal. Type must be boolean: a text answer that
 * merely mentions a hotel is not a request for recommendations.
 */
export function isHotelQuestion(q: {
  type: string;
  label: Record<string, string> | null;
}): boolean {
  return q.type === "boolean" && /hotel/i.test(q.label?.en ?? "");
}

export function hotelRecsRequested(
  questions: Array<{
    id: string;
    type: string;
    label: Record<string, string> | null;
  }>,
  answers: Array<{ question_id: string; value: unknown }>,
): boolean {
  const ids = new Set(questions.filter(isHotelQuestion).map((q) => q.id));
  return answers.some(
    (a) => ids.has(a.question_id) && (a.value === true || a.value === "true"),
  );
}

/** Whether this household answered yes to the hotel-recommendations question. */
export async function wantsHotelRecs(
  scope: WeddingScope,
  householdId: string,
): Promise<boolean> {
  const [{ data: questions }, { data: answers }] = await Promise.all([
    scope.db
      .from("rsvp_questions")
      .select("id, type, label")
      .eq("wedding_id", scope.weddingId)
      .eq("is_active", true),
    scope.db
      .from("rsvp_answers")
      .select("question_id, value")
      .eq("wedding_id", scope.weddingId)
      .eq("household_id", householdId),
  ]);
  return hotelRecsRequested(questions ?? [], answers ?? []);
}

export async function getDeadline(scope: WeddingScope): Promise<string | null> {
  const { data, error } = await scope.db
    .from("weddings")
    .select("rsvp_deadline")
    .eq("id", scope.weddingId)
    .single();
  if (error) throw new Error(error.message);
  return data?.rsvp_deadline ?? null;
}

/**
 * The deadline together with the zone it should be read in.
 *
 * They travel as a pair because the deadline alone cannot be formatted: it is
 * an instant, and 06:59Z is the evening of the twelfth in Los Angeles but the
 * morning of the thirteenth in UTC. Showing a guest the wrong one of those tells
 * them to reply on a day the form has already stopped accepting.
 */
export async function getDeadlineContext(
  scope: WeddingScope,
): Promise<{ deadline: string | null; timeZone: string }> {
  const { data, error } = await scope.db
    .from("weddings")
    .select("rsvp_deadline, timezone")
    .eq("id", scope.weddingId)
    .single();
  if (error) throw new Error(error.message);
  return {
    deadline: data?.rsvp_deadline ?? null,
    timeZone: data?.timezone ?? "America/Los_Angeles",
  };
}

export async function deadlinePassed(scope: WeddingScope): Promise<boolean> {
  const deadline = await getDeadline(scope);
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}
