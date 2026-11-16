import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATION_LINE,
  describeWeddingDetails,
  eventsOnDay,
  formatWeddingDay,
  isCalendarDay,
  locationLineFrom,
  moveEventToDay,
  previewDayMove,
  replyByDay,
  replyByInstant,
  timeZoneLabel,
  validateWeddingDetails,
  weddingFactsFromRow,
  withLocationLine,
  type WeddingDetailsInput,
} from "./wedding-details";

const LA = "America/Los_Angeles";
const now = new Date("2026-11-16T20:00:00Z");

function input(over: Partial<WeddingDetailsInput> = {}): WeddingDetailsInput {
  return {
    weddingDay: "2027-09-18",
    replyBy: "2027-07-01",
    locationLine: "Guadalajara, México",
    confirmPastDay: false,
    ...over,
  };
}

describe("the city line in weddings.theme", () => {
  it("falls back to Guadalajara when nothing was typed", () => {
    expect(locationLineFrom({ video: "/video/hero-v5.mp4" })).toBe(DEFAULT_LOCATION_LINE);
    expect(locationLineFrom(null)).toBe(DEFAULT_LOCATION_LINE);
    expect(locationLineFrom({ location_line: "   " })).toBe(DEFAULT_LOCATION_LINE);
  });

  it("reads the stored line", () => {
    expect(locationLineFrom({ location_line: " Oaxaca, México " })).toBe("Oaxaca, México");
  });

  it("keeps every other theme key when the line is saved", () => {
    const theme = { video: "/video/hero-v5.mp4", poster: "/video/hero-v5-poster.jpg" };
    expect(withLocationLine(theme, "Oaxaca, México")).toEqual({ ...theme, location_line: "Oaxaca, México" });
    expect(theme).not.toHaveProperty("location_line");
  });

  it("does not spread a theme that is not an object", () => {
    expect(withLocationLine("oops", "Oaxaca")).toEqual({ location_line: "Oaxaca" });
    expect(withLocationLine(["a"], "Oaxaca")).toEqual({ location_line: "Oaxaca" });
  });
});

describe("weddingFactsFromRow", () => {
  it("maps the row and fills the defaults", () => {
    expect(
      weddingFactsFromRow({
        couple_names: "Juliet & Juan",
        wedding_date: "2027-09-18",
        rsvp_deadline: "2027-07-02T06:59:00+00:00",
        timezone: LA,
        theme: {},
      }),
    ).toEqual({
      coupleNames: "Juliet & Juan",
      weddingDate: "2027-09-18",
      rsvpDeadline: "2027-07-02T06:59:00+00:00",
      timeZone: LA,
      locationLine: DEFAULT_LOCATION_LINE,
    });
    expect(weddingFactsFromRow(null)).toMatchObject({ weddingDate: null, rsvpDeadline: null, timeZone: LA });
  });
});

describe("the reply-by date", () => {
  it("is stored as 23:59 that day at the venue", () => {
    // July is daylight time in Los Angeles: 23:59 there is 06:59 UTC the next day.
    expect(replyByInstant("2027-07-01", LA)).toBe("2027-07-02T06:59:00.000Z");
    expect(replyByInstant("2027-07-01", "America/Mexico_City")).toBe("2027-07-02T05:59:00.000Z");
  });

  it("reads back as the day she picked", () => {
    expect(replyByDay("2027-07-02T06:59:00.000Z", LA)).toBe("2027-07-01");
    expect(replyByDay(null, LA)).toBe("");
  });

  it("round-trips in each zone a couple is likely to have", () => {
    for (const zone of ["America/Mexico_City", LA, "America/Denver", "America/Chicago", "America/New_York", "Europe/Madrid"]) {
      expect(replyByDay(replyByInstant("2027-07-01", zone), zone)).toBe("2027-07-01");
    }
  });
});

describe("timeZoneLabel", () => {
  it("names the zone in plain words", () => {
    expect(timeZoneLabel(LA)).toBe("Pacific Time (Los Angeles)");
    expect(timeZoneLabel("America/Mexico_City")).toBe("Central Mexico Time (Mexico City and Guadalajara)");
  });

  it("falls back to the city for a zone it does not list", () => {
    expect(timeZoneLabel("Europe/Madrid")).toBe("Madrid time");
    expect(timeZoneLabel("America/Puerto_Rico")).toBe("Puerto Rico time");
  });
});

describe("isCalendarDay", () => {
  it("accepts a real day and rejects an impossible one", () => {
    expect(isCalendarDay("2027-09-18")).toBe(true);
    expect(isCalendarDay("2027-02-30")).toBe(false);
    expect(isCalendarDay("09/18/2027")).toBe(false);
  });
});

describe("validateWeddingDetails", () => {
  const current = { weddingDate: "2027-09-18", rsvpDeadline: null, timeZone: LA };

  it("accepts the present details and derives the deadline instant", () => {
    expect(validateWeddingDetails(input(), current, now)).toEqual({
      ok: true,
      value: {
        weddingDate: "2027-09-18",
        rsvpDeadline: "2027-07-02T06:59:00.000Z",
        locationLine: "Guadalajara, México",
      },
    });
  });

  it("keeps the stored deadline when the reply-by day did not change", () => {
    // Set before this screen existed: 07:00 UTC is midnight in Los Angeles, July 1.
    const stored = { ...current, rsvpDeadline: "2027-07-01T07:00:00+00:00" };
    expect(validateWeddingDetails(input({ locationLine: "Zapopan, México" }), stored, now)).toMatchObject({
      ok: true,
      value: { rsvpDeadline: "2027-07-01T07:00:00+00:00" },
    });
    expect(validateWeddingDetails(input({ replyBy: "2027-07-15" }), stored, now)).toMatchObject({
      ok: true,
      value: { rsvpDeadline: "2027-07-16T06:59:00.000Z" },
    });
  });

  it("clears the deadline when the reply-by date is blank", () => {
    const result = validateWeddingDetails(input({ replyBy: "" }), current, now);
    expect(result).toMatchObject({ ok: true, value: { rsvpDeadline: null } });
  });

  it("uses the stored zone for the deadline", () => {
    const result = validateWeddingDetails(input(), { ...current, timeZone: "America/Mexico_City" }, now);
    expect(result).toMatchObject({ ok: true, value: { rsvpDeadline: "2027-07-02T05:59:00.000Z" } });
  });

  it("rejects a reply-by date after the wedding day", () => {
    const result = validateWeddingDetails(input({ replyBy: "2027-09-19" }), current, now);
    expect(result).toEqual({
      ok: false,
      fieldErrors: { replyBy: "The reply-by date is after the wedding day. Choose an earlier day." },
      needsPastConfirm: false,
    });
  });

  it("allows a reply-by date on the wedding day", () => {
    expect(validateWeddingDetails(input({ replyBy: "2027-09-18" }), current, now).ok).toBe(true);
  });

  it("asks for a wedding day and a city", () => {
    const result = validateWeddingDetails(input({ weddingDay: "", locationLine: "  " }), current, now);
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        weddingDay: "Choose the wedding day.",
        locationLine: "Add the city guests should see.",
      },
      needsPastConfirm: false,
    });
  });

  it("asks before it saves a wedding day in the past, then allows it", () => {
    const past = input({ weddingDay: "2026-06-12", replyBy: "" });
    expect(validateWeddingDetails(past, current, now)).toEqual({ ok: false, fieldErrors: {}, needsPastConfirm: true });
    expect(validateWeddingDetails({ ...past, confirmPastDay: true }, current, now)).toMatchObject({
      ok: true,
      value: { weddingDate: "2026-06-12" },
    });
  });

  it("does not ask about a past day she did not change", () => {
    const afterTheWedding = new Date("2027-10-01T20:00:00Z");
    const result = validateWeddingDetails(input({ locationLine: "Zapopan, México" }), current, afterTheWedding);
    expect(result).toMatchObject({ ok: true, value: { locationLine: "Zapopan, México" } });
  });

  it("counts today at the venue, not today in UTC", () => {
    // 03:00 UTC on the 17th is still the evening of the 16th in Los Angeles.
    const evening = new Date("2026-11-17T03:00:00Z");
    expect(validateWeddingDetails(input({ weddingDay: "2026-11-16", replyBy: "" }), current, evening).ok).toBe(true);
  });

  it("tidies the city text", () => {
    const result = validateWeddingDetails(input({ locationLine: "  Guadalajara,   México " }), current, now);
    expect(result).toMatchObject({ ok: true, value: { locationLine: "Guadalajara, México" } });
  });
});

describe("events that follow the wedding day", () => {
  const ceremony = { id: "c", starts_at: "2027-06-12T23:00:00.000Z", ends_at: null }; // 16:00 in Los Angeles
  const reception = { id: "r", starts_at: "2027-06-13T00:30:00.000Z", ends_at: "2027-06-13T06:00:00.000Z" }; // 17:30 to 23:00
  const welcome = { id: "w", starts_at: "2027-06-12T02:00:00.000Z", ends_at: null }; // 19:00 on the 11th
  const undated = { id: "u", starts_at: null, ends_at: null };
  const all = [ceremony, reception, welcome, undated];

  it("finds the events on the old day at the venue", () => {
    expect(eventsOnDay(all, "2027-06-12", LA).map((event) => event.id)).toEqual(["c", "r"]);
    expect(eventsOnDay(all, null, LA)).toEqual([]);
  });

  it("moves an event to the new day at the same venue time", () => {
    expect(moveEventToDay(ceremony, "2027-06-12", "2027-09-18", LA)).toEqual({
      startsAt: "2027-09-18T23:00:00.000Z",
      endsAt: null,
    });
  });

  it("moves the end time by the same number of days", () => {
    expect(moveEventToDay(reception, "2027-06-12", "2027-09-18", LA)).toEqual({
      startsAt: "2027-09-19T00:30:00.000Z",
      endsAt: "2027-09-19T06:00:00.000Z",
    });
  });

  it("keeps the clock time across a daylight-saving change", () => {
    // 16:00 in June is 23:00 UTC. 16:00 in December is 00:00 UTC the next day.
    expect(moveEventToDay(ceremony, "2027-06-12", "2027-12-18", LA).startsAt).toBe("2027-12-19T00:00:00.000Z");
  });

  it("can move an event to an earlier day", () => {
    expect(moveEventToDay(ceremony, "2027-06-12", "2027-06-05", LA).startsAt).toBe("2027-06-05T23:00:00.000Z");
  });
});

describe("the summary sentence", () => {
  it("states the day, the city and the reply-by date", () => {
    expect(
      describeWeddingDetails({
        weddingDate: "2027-09-18",
        rsvpDeadline: "2027-07-02T06:59:00.000Z",
        timeZone: LA,
        locationLine: "Guadalajara, México",
      }),
    ).toEqual({
      when: "Saturday, September 18, 2027 in Guadalajara, México.",
      replyBy: "Guests can reply until July 1, 2027.",
    });
  });

  it("says plainly when a value is missing", () => {
    expect(
      describeWeddingDetails({ weddingDate: null, rsvpDeadline: null, timeZone: LA, locationLine: "Guadalajara, México" }),
    ).toEqual({
      when: "No wedding day yet. Guests see Guadalajara, México.",
      replyBy: "There is no reply-by date. Guests can reply at any time.",
    });
  });

  it("writes a calendar day without shifting it through a zone", () => {
    expect(formatWeddingDay("2027-09-18")).toBe("Saturday, September 18, 2027");
    expect(formatWeddingDay("2027-02-30")).toBeNull();
  });
});

describe("previewDayMove", () => {
  const events = [
    { id: "w", name: "Welcome Party", starts_at: "2027-09-18T02:00:00.000Z", ends_at: null }, // 19:00 on the 17th
    { id: "c", name: "Ceremony", starts_at: "2027-09-18T23:00:00.000Z", ends_at: null }, // 16:00
    { id: "r", name: "Reception", starts_at: "2027-09-18T23:30:00.000Z", ends_at: null }, // 16:30
    { id: "d", name: "Getting Ready", starts_at: "2027-09-18T07:00:00.000Z", ends_at: null }, // midnight: no time set
    { id: "u", name: "Farewell Brunch", starts_at: null, ends_at: null },
  ];

  it("names the events that move and the time each keeps", () => {
    expect(previewDayMove(events, "2027-09-18", LA)).toEqual({
      follow: [
        { id: "c", name: "Ceremony", time: "4:00 PM" },
        { id: "r", name: "Reception", time: "4:30 PM" },
        { id: "d", name: "Getting Ready", time: null },
      ],
      stay: [{ name: "Welcome Party", day: "Friday, September 17" }],
    });
  });

  it("moves nothing when there is no wedding day yet", () => {
    expect(previewDayMove(events, null, LA).follow).toEqual([]);
  });
});
