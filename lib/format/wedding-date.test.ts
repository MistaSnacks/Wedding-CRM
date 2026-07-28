import { describe, expect, test } from "vitest";
import { formatCalendarDate, daysUntilCalendarDate } from "./wedding-date";

/**
 * `weddings.wedding_date` is a Postgres `date` — a calendar day, with no
 * instant and no timezone. `new Date("2027-06-12")` turns it into UTC
 * midnight, so formatting it anywhere west of Greenwich renders the day
 * before. That is how the admin sidebar came to greet Juliet with the wrong
 * wedding date on a Pacific machine, while production (Vercel runs UTC) got
 * it right by luck.
 *
 * These tests are meaningful precisely because the suite runs in the
 * developer's own timezone: on a Pacific machine the naive implementation
 * returns "June 11, 2027" here.
 */
describe("formatCalendarDate", () => {
  test("renders the stored day regardless of the machine's timezone", () => {
    expect(formatCalendarDate("2027-06-12")).toBe("June 12, 2027");
  });

  test("returns null for a missing date rather than inventing one", () => {
    expect(formatCalendarDate(null)).toBeNull();
  });
});

/**
 * "Days out" is a human count of sleeps, so it is measured from the day it
 * currently is *at the venue* — not from a UTC instant that has already
 * rolled over while everyone involved is still on yesterday evening.
 */
describe("daysUntilCalendarDate", () => {
  test("counts whole days between today at the venue and the wedding day", () => {
    const now = new Date("2026-07-28T19:00:00Z"); // 12:00 in Los Angeles
    expect(daysUntilCalendarDate("2027-06-12", now, "America/Los_Angeles")).toBe(319);
  });

  test("is zero on the wedding day itself", () => {
    const now = new Date("2027-06-12T18:00:00Z"); // 11:00 in Los Angeles
    expect(daysUntilCalendarDate("2027-06-12", now, "America/Los_Angeles")).toBe(0);
  });

  test("still says one day out when UTC has rolled over but the venue has not", () => {
    const now = new Date("2027-06-12T03:00:00Z"); // still 20:00 on the 11th in LA
    expect(daysUntilCalendarDate("2027-06-12", now, "America/Los_Angeles")).toBe(1);
  });

  test("never counts backwards once the day has passed", () => {
    const now = new Date("2027-08-01T00:00:00Z");
    expect(daysUntilCalendarDate("2027-06-12", now, "America/Los_Angeles")).toBe(0);
  });
});
