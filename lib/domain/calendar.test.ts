import { it, expect } from "vitest";
import { invitationCalendar } from "./calendar";
it("uses UTC instants and escapes untrusted event text without calendar injection", () => {
  const result = invitationCalendar(
    [
      {
        id: "event",
        name: "Reception\r\nATTENDEE:bad",
        starts_at: "2027-06-12T17:30:00-07:00",
        venue_name: "Venue, City",
        rsvp_enabled: true,
        seating_published_at: null,
        sort_order: 0,
      },
    ],
    "Juliet & Juan",
    new Date("2026-09-04T00:00:00Z"),
  );
  expect(result).toContain("DTSTART:20270613T003000Z");
  expect(result).not.toContain("\r\nATTENDEE:");
  expect(result).toContain("LOCATION:Venue\\, City");
});
it("folds long multilingual text without splitting unicode", () => {
  const result = invitationCalendar(
    [
      {
        id: "event",
        name: "Việt Nam ".repeat(30),
        starts_at: "2027-06-12T00:00:00Z",
        venue_name: null,
        rsvp_enabled: true,
        seating_published_at: null,
        sort_order: 0,
      },
    ],
    "Couple",
  );
  expect(
    result
      .split("\r\n")
      .every((line) => new TextEncoder().encode(line).length <= 75),
  ).toBe(true);
  expect(result).not.toContain("\uFFFD");
});
