import { toFields, toInstant } from "@/components/admin/events/when";
import { calendarDayIn } from "@/lib/format/wedding-date";

/**
 * The wedding's own details: the day, the reply-by date and the city.
 *
 * These values appear on the RSVP page and in every email, so they are read
 * from the `weddings` row everywhere and edited in one place, the "Wedding
 * details" card on the Events screen. The venue's time zone is read here too,
 * but it is shown, not edited: see `timeZoneLabel`. Everything here is pure, so the
 * rules can be tested without a database: what counts as a valid change, which
 * instant "reply by July 1" really is, and which events follow the wedding day
 * when it moves.
 */

/** The city line shown when the couple has not typed one yet. */
export const DEFAULT_LOCATION_LINE = "Guadalajara, México";

/** Matches the column default in `0001_init.sql`. */
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

/** What guest pages and emails need to know about the wedding. */
export type WeddingFacts = {
  coupleNames: string;
  /** A calendar day, `YYYY-MM-DD`. It has no time and no zone. */
  weddingDate: string | null;
  /** A real instant: 23:59 at the venue on the reply-by day. */
  rsvpDeadline: string | null;
  timeZone: string;
  /** For example "Guadalajara, México". */
  locationLine: string;
};

/** The columns of `weddings` that the facts are read from. */
export type WeddingFactsRow = {
  couple_names?: string | null;
  wedding_date?: string | null;
  rsvp_deadline?: string | null;
  timezone?: string | null;
  theme?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The city line from `weddings.theme`. There is no column for it, so it lives
 * in the jsonb under `location_line`, next to the video and poster settings.
 */
export function locationLineFrom(theme: unknown): string {
  if (isRecord(theme)) {
    const line = theme.location_line;
    if (typeof line === "string" && line.trim().length > 0) return line.trim();
  }
  return DEFAULT_LOCATION_LINE;
}

/**
 * `theme` with the city line set and every other key untouched.
 *
 * The jsonb is written back whole, so a save that forgot the keys it did not
 * edit would delete the hero video. A value that is not an object (it should
 * never be) is replaced instead of spread.
 */
export function withLocationLine(theme: unknown, line: string): Record<string, unknown> {
  return { ...(isRecord(theme) ? theme : {}), location_line: line.trim() };
}

export function weddingFactsFromRow(row: WeddingFactsRow | null | undefined): WeddingFacts {
  return {
    coupleNames: row?.couple_names?.trim() || "Juliet & Juan",
    weddingDate: row?.wedding_date ?? null,
    rsvpDeadline: row?.rsvp_deadline ?? null,
    timeZone: row?.timezone || DEFAULT_TIME_ZONE,
    locationLine: locationLineFrom(row?.theme),
  };
}

/**
 * Plain names for the zones a couple is likely to have. The zone is shown on
 * the Events screen and is not editable there: changing it would move every
 * event time, which needs one atomic database step that does not exist yet.
 */
const TIME_ZONE_NAMES: Record<string, string> = {
  "America/Mexico_City": "Central Mexico Time (Mexico City and Guadalajara)",
  "America/Los_Angeles": "Pacific Time (Los Angeles)",
  "America/Denver": "Mountain Time (Denver)",
  "America/Chicago": "Central Time (Chicago)",
  "America/New_York": "Eastern Time (New York)",
};

/** The plain name of a zone: `"America/Los_Angeles"` → `"Pacific Time (Los Angeles)"`. */
export function timeZoneLabel(value: string): string {
  const named = TIME_ZONE_NAMES[value];
  if (named) return named;
  const city = (value.split("/").pop() ?? value).replace(/_/g, " ");
  return `${city} time`;
}

/** A real calendar day written `YYYY-MM-DD`. "2027-02-30" is not one. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * "Reply by July 1" as an instant: 23:59 that day at the venue.
 *
 * Guests can reply for the whole of the day she picked. Midnight at the start
 * of the day would close the form a day early.
 */
export function replyByInstant(day: string, timeZone: string): string | null {
  if (!isCalendarDay(day)) return null;
  return toInstant(day, "23:59", timeZone);
}

/** The stored deadline back as the day she picked, for the date input. */
export function replyByDay(deadline: string | null, timeZone: string): string {
  if (!deadline) return "";
  const ms = Date.parse(deadline);
  if (Number.isNaN(ms)) return "";
  return calendarDayIn(new Date(ms), timeZone);
}

/** True when `day` is before today at the venue. */
export function isPastDay(day: string, now: Date, timeZone: string): boolean {
  return isCalendarDay(day) && day < calendarDayIn(now, timeZone);
}

export type WeddingDetailsInput = {
  weddingDay: string;
  /** Blank means "no deadline". */
  replyBy: string;
  locationLine: string;
  /** She saw the "this day is in the past" warning and saved anyway. */
  confirmPastDay: boolean;
};

export type WeddingDetailsErrors = {
  weddingDay?: string;
  replyBy?: string;
  locationLine?: string;
};

export type WeddingDetailsValue = {
  weddingDate: string;
  rsvpDeadline: string | null;
  locationLine: string;
};

/** What is stored now. The zone comes from here, never from the form. */
export type WeddingDetailsCurrent = {
  weddingDate: string | null;
  rsvpDeadline: string | null;
  timeZone: string;
};

export type WeddingDetailsResult =
  | { ok: true; value: WeddingDetailsValue }
  | { ok: false; fieldErrors: WeddingDetailsErrors; needsPastConfirm: boolean };

export const LOCATION_LINE_MAX = 80;

/**
 * Checks a change to the wedding details and turns it into what is stored.
 *
 * A wedding day in the past is allowed, but only after she confirms it. The
 * check runs only when the day changes, so fixing the city after the wedding
 * does not ask about a date she did not touch.
 *
 * When the reply-by day did not change, the stored deadline is kept as it is.
 * A deadline set before this screen existed may not be exactly 23:59, and
 * fixing the city must not move it.
 */
export function validateWeddingDetails(
  input: WeddingDetailsInput,
  current: WeddingDetailsCurrent,
  now: Date,
): WeddingDetailsResult {
  const fieldErrors: WeddingDetailsErrors = {};
  const weddingDay = input.weddingDay.trim();
  const replyBy = input.replyBy.trim();
  const locationLine = input.locationLine.trim().replace(/\s+/g, " ");
  const { timeZone } = current;

  if (weddingDay.length === 0) fieldErrors.weddingDay = "Choose the wedding day.";
  else if (!isCalendarDay(weddingDay)) fieldErrors.weddingDay = "That is not a day on the calendar. Choose the wedding day again.";

  if (replyBy.length > 0) {
    if (!isCalendarDay(replyBy)) fieldErrors.replyBy = "That is not a day on the calendar. Choose the reply-by date again.";
    else if (!fieldErrors.weddingDay && replyBy > weddingDay) fieldErrors.replyBy = "The reply-by date is after the wedding day. Choose an earlier day.";
  }

  if (locationLine.length === 0) fieldErrors.locationLine = "Add the city guests should see.";
  else if (locationLine.length > LOCATION_LINE_MAX) fieldErrors.locationLine = `Keep the city to ${LOCATION_LINE_MAX} characters or fewer.`;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, needsPastConfirm: false };

  const dayChanged = weddingDay !== current.weddingDate;
  if (dayChanged && !input.confirmPastDay && isPastDay(weddingDay, now, timeZone)) {
    return { ok: false, fieldErrors: {}, needsPastConfirm: true };
  }

  const replyByUnchanged = current.rsvpDeadline !== null && replyBy === replyByDay(current.rsvpDeadline, timeZone);
  return {
    ok: true,
    value: {
      weddingDate: weddingDay,
      rsvpDeadline:
        replyBy.length === 0 ? null : replyByUnchanged ? current.rsvpDeadline : replyByInstant(replyBy, timeZone),
      locationLine,
    },
  };
}

/** `"2027-09-18"` → `"Saturday, September 18, 2027"`. A calendar day, so no zone. */
export function formatWeddingDay(day: string): string | null {
  if (!isCalendarDay(day)) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** `"2027-07-01"` → `"July 1, 2027"`. */
function formatShortDay(day: string): string | null {
  if (!isCalendarDay(day)) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * The details as two sentences she can check at a glance:
 * "Saturday, September 18, 2027 in Guadalajara, México."
 * "Guests can reply until July 1, 2027."
 */
export function describeWeddingDetails(facts: Pick<WeddingFacts, "weddingDate" | "rsvpDeadline" | "timeZone" | "locationLine">): {
  when: string;
  replyBy: string;
} {
  const day = facts.weddingDate ? formatWeddingDay(facts.weddingDate) : null;
  const when = day ? `${day} in ${facts.locationLine}.` : `No wedding day yet. Guests see ${facts.locationLine}.`;
  const replyDay = formatShortDay(replyByDay(facts.rsvpDeadline, facts.timeZone));
  const replyBy = replyDay ? `Guests can reply until ${replyDay}.` : "There is no reply-by date. Guests can reply at any time.";
  return { when, replyBy };
}

/** The parts of an event that decide which day it is on. */
export type MovableEvent = { id: string; starts_at: string | null; ends_at: string | null };

/** The events that start on `day` at the venue. Events with no date never match. */
export function eventsOnDay<T extends MovableEvent>(events: T[], day: string | null, timeZone: string): T[] {
  if (!day) return [];
  return events.filter((event) => event.starts_at !== null && toFields(event.starts_at, timeZone).date === day);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * New start and end for an event that follows the wedding from `fromDay` to
 * `toDay`: the same clock time at the venue, the new day.
 *
 * Moved by calendar days and read back through the venue's zone, not by adding
 * a number of hours. Four in the afternoon stays four in the afternoon when the
 * two days sit on different sides of a daylight-saving change.
 */
export function moveEventToDay(
  event: MovableEvent,
  fromDay: string,
  toDay: string,
  timeZone: string,
): { startsAt: string | null; endsAt: string | null } {
  const days = Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
  const shift = (iso: string | null): string | null => {
    if (iso === null) return null;
    const fields = toFields(iso, timeZone);
    if (fields.date === "") return iso;
    return toInstant(addDays(fields.date, days), fields.time, timeZone);
  };
  return { startsAt: shift(event.starts_at), endsAt: shift(event.ends_at) };
}

/** An event as the "Wedding details" card names it. */
export type NamedEvent = MovableEvent & { name: string };

export type DayMovePreview = {
  /** Events on the wedding day. They move with it and keep their clock time. */
  follow: Array<{ id: string; name: string; time: string | null }>;
  /** Events on other days. They keep their dates. */
  stay: Array<{ name: string; day: string }>;
};

/**
 * What a change of wedding day does to the schedule, in her words: which
 * events move with the day (and the time each keeps), and which stay put.
 * Events with no date are in neither list, because nothing happens to them.
 */
export function previewDayMove(events: NamedEvent[], weddingDay: string | null, timeZone: string): DayMovePreview {
  const following = new Set(eventsOnDay(events, weddingDay, timeZone).map((event) => event.id));
  const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" });
  const preview: DayMovePreview = { follow: [], stay: [] };
  for (const event of events) {
    if (event.starts_at === null || Number.isNaN(Date.parse(event.starts_at))) continue;
    const at = new Date(event.starts_at);
    if (following.has(event.id)) {
      const hasTime = toFields(event.starts_at, timeZone).time !== "";
      preview.follow.push({ id: event.id, name: event.name, time: hasTime ? clock.format(at) : null });
    } else {
      preview.stay.push({ name: event.name, day: day.format(at) });
    }
  }
  return preview;
}
