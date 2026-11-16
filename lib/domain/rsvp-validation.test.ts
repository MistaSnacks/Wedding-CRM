import { describe, it, expect } from "vitest";
import {
  guestDto,
  guestPayloadSchema,
  expectedRsvpStatus,
  householdLimitError,
  eligibleMeals,
} from "./rsvp-validation";
import type { MealOptionRow } from "@/lib/types";
const meal: MealOptionRow = {
  id: "meal",
  name: "Dinner",
  event_id: "reception",
  is_kids_meal: false,
  sort_order: 0,
  is_active: true,
  name_i18n: {},
};
describe("guest boundary", () => {
  it("projects away private columns even when a caller supplies complete rows", () => {
    const dto = guestDto({
      id: "g",
      first_name: "A",
      last_name: "B",
      age_type: "adult",
      origin: "named",
      dietary_restrictions: null,
      allergies: null,
      internal_notes: "PRIVATE",
      is_vip: true,
    } as Parameters<typeof guestDto>[0]);
    expect(JSON.stringify(dto)).not.toContain("PRIVATE");
    expect(dto).not.toHaveProperty("internal_notes");
    expect(dto).not.toHaveProperty("is_vip");
  });
  it("accepts existing PostgreSQL fixture UUIDs without RFC version bits", () => {
    expect(
      guestPayloadSchema.safeParse({
        responses: [
          {
            guest_id: "55555555-5555-5555-5555-555555555501",
            event_id: "22222222-2222-2222-2222-222222222201",
            meal_option_id: "33333333-3333-3333-3333-333333333301",
            attending: "yes",
          },
        ],
        complete: true,
      }).success,
    ).toBe(true);
  });
  it("validates runtime input and strips server-only fields", () => {
    expect(
      guestPayloadSchema.safeParse({
        responses: [],
        complete: true,
        via: "admin",
        confirmation: { recipient: "bad" },
      }).data,
    ).toEqual({ responses: [], complete: true });
    expect(
      guestPayloadSchema.safeParse({
        responses: [],
        complete: true,
        new_plus_ones: [{ first_name: "A", last_name: "", responses: [] }],
      }).success,
    ).toBe(false);
  });
});
describe("expected RSVP combinations", () => {
  const guests = [{ id: "g", age_type: "adult" }];
  const events = [
    { id: "reception", rsvp_enabled: true },
    { id: "rehearsal", rsvp_enabled: true },
  ];
  it("does not complete an empty or partial response set", () => {
    expect(expectedRsvpStatus(guests, events, [], [])).toBe("pending");
    expect(
      expectedRsvpStatus(
        guests,
        events,
        [
          {
            guest_id: "g",
            event_id: "reception",
            attending: "yes",
            meal_option_id: null,
          },
        ],
        [],
      ),
    ).toBe("started");
  });
  it("excludes disabled events but requires compatible meals", () => {
    const events = [
      { id: "reception", rsvp_enabled: true },
      { id: "rehearsal", rsvp_enabled: false },
    ];
    expect(
      expectedRsvpStatus(
        guests,
        events,
        [
          {
            guest_id: "g",
            event_id: "reception",
            attending: "yes",
            meal_option_id: null,
          },
        ],
        [meal],
      ),
    ).toBe("started");
    expect(
      expectedRsvpStatus(
        guests,
        events,
        [
          {
            guest_id: "g",
            event_id: "reception",
            attending: "yes",
            meal_option_id: "meal",
          },
        ],
        [meal],
      ),
    ).toBe("completed");
  });
  it("handles decline and no active requirements", () => {
    expect(
      expectedRsvpStatus(
        guests,
        events,
        events.map((e) => ({
          guest_id: "g",
          event_id: e.id,
          attending: "no" as const,
          meal_option_id: null,
        })),
        [meal],
      ),
    ).toBe("declined");
    expect(expectedRsvpStatus(guests, [], [], [])).toBe("pending");
  });
  it("filters menu by event and age", () =>
    expect(
      eligibleMeals(
        [meal, { ...meal, id: "child", is_kids_meal: true }],
        "rehearsal",
        "adult",
      ),
    ).toEqual([]));
  it("does not shrink limits under existing plus-ones", () =>
    expect(
      householdLimitError(2, 0, [{ origin: "named" }, { origin: "plus_one" }]),
    ).toContain("already has"));
});
