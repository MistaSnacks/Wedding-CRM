import { z } from "zod";
import type { GuestRow, MealOptionRow, ResponseRow } from "@/lib/types";

export const postgresIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const id = postgresIdSchema;
const response = z.object({
  event_id: id,
  attending: z.enum(["pending", "yes", "no"]),
  meal_option_id: id.nullable().optional(),
});
export const guestPayloadSchema = z.object({
  responses: z.array(response.extend({ guest_id: id })).max(1000),
  new_plus_ones: z
    .array(
      z.object({
        guest_id: id.optional(),
        client_id: id.optional(),
        first_name: z.string().trim().min(1).max(120),
        last_name: z.string().trim().min(1).max(120),
        responses: z.array(response).max(100),
      }),
    )
    .max(50)
    .optional(),
  remove_plus_one_ids: z.array(id).max(50).optional(),
  guest_fields: z
    .array(
      z.object({
        guest_id: id,
        dietary_restrictions: z.string().max(2000).optional(),
        allergies: z.string().max(2000).optional(),
      }),
    )
    .max(100)
    .optional(),
  answers: z
    .array(
      z.object({
        question_id: id,
        guest_id: id.nullable().optional(),
        value: z.union([z.string().max(2000), z.boolean()]),
      }),
    )
    .max(200)
    .optional(),
  complete: z.boolean(),
});

export type GuestRsvpDto = Pick<
  GuestRow,
  | "id"
  | "first_name"
  | "last_name"
  | "age_type"
  | "origin"
  | "dietary_restrictions"
  | "allergies"
> & { rsvp_client_id?: string | null };
export const GUEST_RSVP_COLUMNS =
  "id, first_name, last_name, age_type, origin, dietary_restrictions, allergies, rsvp_client_id";
export function guestDto(g: GuestRsvpDto): GuestRsvpDto {
  return {
    id: g.id,
    first_name: g.first_name,
    last_name: g.last_name,
    age_type: g.age_type,
    origin: g.origin,
    dietary_restrictions: g.dietary_restrictions,
    allergies: g.allergies,
    rsvp_client_id: g.rsvp_client_id ?? null,
  };
}
export function eligibleMeals(
  meals: MealOptionRow[],
  eventId: string,
  age: string,
) {
  return meals.filter(
    (m) =>
      (!m.event_id || m.event_id === eventId) &&
      (age !== "adult" || !m.is_kids_meal),
  );
}
export function expectedRsvpStatus(
  guests: Array<{ id: string; age_type: string }>,
  events: Array<{ id: string; rsvp_enabled: boolean }>,
  responses: Pick<
    ResponseRow,
    "guest_id" | "event_id" | "attending" | "meal_option_id"
  >[],
  meals: MealOptionRow[],
) {
  const expected = guests.flatMap((g) =>
    events
      .filter((e) => e.rsvp_enabled)
      .map((e) => ({
        g,
        e,
        r: responses.find((r) => r.guest_id === g.id && r.event_id === e.id),
      })),
  );
  if (!expected.length) return "pending";
  if (expected.every((x) => x.r?.attending === "no")) return "declined";
  const complete = expected.every(
    ({ g, e, r }) =>
      r?.attending === "no" ||
      (r?.attending === "yes" &&
        (!eligibleMeals(meals, e.id, g.age_type).length ||
          eligibleMeals(meals, e.id, g.age_type).some(
            (m) => m.id === r.meal_option_id,
          ))),
  );
  if (complete) return "completed";
  return expected.some((x) => x.r && x.r.attending !== "pending")
    ? "started"
    : "pending";
}
export function householdLimitError(
  maxParty: number,
  slots: number,
  guests: Array<{ origin: string }>,
) {
  if (
    !Number.isInteger(maxParty) ||
    maxParty < 1 ||
    !Number.isInteger(slots) ||
    slots < 0
  )
    return "Use whole, non-negative guest limits.";
  const existing = guests.filter((g) => g.origin === "plus_one").length;
  if (slots < existing)
    return `This household already has ${existing} added guest(s). Remove or move them before reducing their slots.`;
  if (maxParty < guests.length)
    return `The maximum party size must include all ${guests.length} existing guests.`;
  return null;
}
