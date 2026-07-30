import { describe, expect, test } from "vitest";
import {
  formatCalendarDate,
  daysUntilCalendarDate,
  calendarDayIn,
  calendarDayDelta,
  rsvpDeadlineNotice,
  calendarDaysBefore,
} from "./wedding-date";

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

/**
 * `weddings.rsvp_deadline` is a `timestamptz` — a real instant, unlike
 * `wedding_date`. Asking which day it lands on is only answerable once you
 * name a place, and the place is the venue.
 */
describe("calendarDayIn", () => {
  test("reads the venue's day, not UTC's, when the two disagree", () => {
    // 06:59Z on the 13th is still 23:59 on the 12th in Los Angeles.
    const instant = new Date("2027-04-13T06:59:00Z");
    expect(calendarDayIn(instant, "America/Los_Angeles")).toBe("2027-04-12");
    expect(calendarDayIn(instant, "UTC")).toBe("2027-04-13");
  });

  test("pads month and day to two digits", () => {
    expect(calendarDayIn(new Date("2027-01-05T12:00:00Z"), "UTC")).toBe("2027-01-05");
  });
});

/**
 * The signed counterpart to `daysUntilCalendarDate`. Every due-date feature
 * needs to tell "due today" from "overdue", which a floored count cannot do.
 */
describe("calendarDayDelta", () => {
  test("goes negative for a day that has already passed at the venue", () => {
    const now = new Date("2027-04-12T18:00:00Z"); // 11:00 on the 12th in LA
    expect(calendarDayDelta("2027-04-10", now, "America/Los_Angeles")).toBe(-2);
  });

  test("is zero at the venue even when UTC has already reached tomorrow", () => {
    const now = new Date("2027-04-13T03:00:00Z"); // 20:00 on the 12th in LA
    expect(calendarDayDelta("2027-04-12", now, "America/Los_Angeles")).toBe(0);
  });

  test("agrees with the floored version whenever the date is still ahead", () => {
    const now = new Date("2026-07-28T19:00:00Z");
    expect(calendarDayDelta("2027-06-12", now, "America/Los_Angeles")).toBe(319);
  });

  test("treats an unparseable date as today rather than as overdue", () => {
    expect(calendarDayDelta("not-a-date", new Date("2027-04-12T18:00:00Z"), "UTC")).toBe(0);
  });
});

/**
 * The header pill. It used to divide elapsed milliseconds by a day and round
 * up, so four hours before the deadline it read "RSVPs close in 1 days" and
 * from then on it read "0 days" forever. Sleeps, not hours — counted at the
 * venue.
 */
describe("rsvpDeadlineNotice", () => {
  const LA = "America/Los_Angeles";
  const deadline = "2027-04-13T06:59:00Z"; // 23:59 on the 12th in Los Angeles

  test("says one day, singular, at 20:00 the evening before", () => {
    const now = new Date("2027-04-12T03:00:00Z"); // 20:00 on the 11th in LA
    // Instant arithmetic saw 27.98 hours here and rounded it up to two.
    expect(rsvpDeadlineNotice(deadline, now, LA)).toEqual({
      label: "RSVPs close in 1 day",
      closed: false,
    });
  });

  test("pluralises everywhere else", () => {
    const now = new Date("2027-04-10T19:00:00Z"); // 12:00 on the 10th in LA
    expect(rsvpDeadlineNotice(deadline, now, LA)?.label).toBe("RSVPs close in 2 days");
  });

  test("closes at the deadline instead of pinning at zero", () => {
    const now = new Date("2027-04-13T06:59:00Z"); // the deadline itself
    expect(rsvpDeadlineNotice(deadline, now, LA)).toEqual({ label: "RSVPs closed", closed: true });
  });

  test("stays closed once the deadline is behind us", () => {
    const now = new Date("2027-04-20T18:00:00Z");
    expect(rsvpDeadlineNotice(deadline, now, LA)).toEqual({ label: "RSVPs closed", closed: true });
  });

  test("dates the deadline at the venue, so a late-evening cutoff is not read as tomorrow", () => {
    const now = new Date("2027-04-12T19:00:00Z"); // 12:00 on the 12th in LA
    // Reading the deadline in UTC would call it the 13th and promise a day more.
    expect(rsvpDeadlineNotice(deadline, now, LA)?.label).toBe("RSVPs close today");
    expect(rsvpDeadlineNotice(deadline, now, "UTC")?.label).toBe("RSVPs close in 1 day");
  });

  // The deadline is 23:59 on the 12th at the venue. For the whole of that day
  // there are zero sleeps left but the guest form is still accepting, and the
  // header has to say so — "closed" here would stop the couple chasing the last
  // households with twelve hours still on the clock.
  test("says 'close today' all through the final day, and stays open", () => {
    for (const iso of ["2027-04-12T07:01:00Z", "2027-04-12T19:00:00Z", "2027-04-13T03:00:00Z"]) {
      expect(rsvpDeadlineNotice(deadline, new Date(iso), LA)).toEqual({
        label: "RSVPs close today",
        closed: false,
      });
    }
  });

  test("flips to closed on the instant, not at the start of the deadline day", () => {
    const oneMinuteBefore = new Date("2027-04-13T06:58:00Z");
    expect(rsvpDeadlineNotice(deadline, oneMinuteBefore, LA)?.closed).toBe(false);
    const oneMinuteAfter = new Date("2027-04-13T07:00:00Z");
    expect(rsvpDeadlineNotice(deadline, oneMinuteAfter, LA)?.closed).toBe(true);
  });

  test("renders nothing when no deadline is set", () => {
    expect(rsvpDeadlineNotice(null, new Date("2027-04-12T18:00:00Z"), LA)).toBeNull();
  });
});

describe("calendarDaysBefore", () => {
  test("counts back in whole calendar days", () => {
    expect(calendarDaysBefore("2027-06-12", 30)).toBe("2027-05-13");
    expect(calendarDaysBefore("2027-06-12", 0)).toBe("2027-06-12");
  });

  test("crosses a month and a year boundary", () => {
    expect(calendarDaysBefore("2027-01-10", 30)).toBe("2026-12-11");
  });

  test("crosses a leap day", () => {
    expect(calendarDaysBefore("2028-03-01", 1)).toBe("2028-02-29");
  });

  // A DST transition must not shift the answer: these are calendar days, not
  // instants, and the venue's clock changing does not move a due date.
  test("is unaffected by a daylight-saving transition in between", () => {
    expect(calendarDaysBefore("2027-03-20", 14)).toBe("2027-03-06");
  });

  test("returns null for a missing or malformed date", () => {
    expect(calendarDaysBefore(null, 30)).toBeNull();
    expect(calendarDaysBefore("", 30)).toBeNull();
    expect(calendarDaysBefore("not-a-date", 30)).toBeNull();
  });
});
