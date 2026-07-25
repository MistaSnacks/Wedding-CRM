import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

const CONTEXT = {
  events: [
    { id: "ev-main", name: "Main" },
    { id: "ev-extra", name: "Extra" },
  ],
  mealOptions: [],
};

const CSV = `Household,First Name,Last Name,Main RSVP,Extra RSVP
Group A,Ann,One,Attending,Not Invited
Group A,Bob,One,Declined,Not Invited
Group B,Cal,Two,Pending,Attending
`;

const MAPPING_EVENTS = [
  { column: "Main RSVP", eventId: "ev-main" },
  { column: "Extra RSVP", eventId: "ev-extra" },
];

describe("per-event mapping", () => {
  it("translates rsvp values into per-event attendance", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, { ...detectMapping(headers), events: MAPPING_EVENTS }, CONTEXT);
    const a = v.households.find((h) => h.displayName === "Group A")!;
    expect(a.guests.find((g) => g.firstName === "Ann")!.attendingByEventId).toEqual({
      "ev-main": "yes",
    });
    expect(a.guests.find((g) => g.firstName === "Bob")!.attendingByEventId).toEqual({
      "ev-main": "no",
    });
  });

  it("records a not-invited event on the household", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, { ...detectMapping(headers), events: MAPPING_EVENTS }, CONTEXT);
    const a = v.households.find((h) => h.displayName === "Group A")!;
    const b = v.households.find((h) => h.displayName === "Group B")!;
    expect(a.notInvitedEventIds).toEqual(["ev-extra"]);
    expect(b.notInvitedEventIds ?? []).toEqual([]);
    expect(b.guests[0].attendingByEventId).toEqual({ "ev-main": "pending", "ev-extra": "yes" });
  });

  it("omits event data entirely when no event columns are mapped", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.households[0].notInvitedEventIds).toBeUndefined();
    expect(v.households[0].guests[0].attendingByEventId).toBeUndefined();
  });
});
