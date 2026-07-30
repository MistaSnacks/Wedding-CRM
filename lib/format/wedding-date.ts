/**
 * Calendar-date helpers for `weddings.wedding_date`.
 *
 * A Postgres `date` is a day on a calendar — it has no instant and no
 * timezone. The moment you hand `"2027-06-12"` to `new Date()` it becomes UTC
 * midnight, and formatting that anywhere west of Greenwich renders the day
 * before. Both functions here keep the calendar day intact: the wedding is on
 * the twelfth in Guadalajara, in Los Angeles, and on a laptop in Hanoi.
 *
 * See `components/admin/events/when.ts` for the other half of the problem —
 * event *times*, which are real instants and do go through the venue's zone.
 */

/** The calendar day as text: `"2027-06-12"` → `"June 12, 2027"`. */
export function formatCalendarDate(date: string | null): string | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(ms));
}

/** Today's calendar day in `timeZone`, as `[year, month, day]`. */
function calendarDayAt(instant: Date, timeZone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const at: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") at[part.type] = Number(part.value);
  }
  return [at.year, at.month, at.day];
}

/**
 * Whole days from today-at-the-venue until the wedding day, floored at zero.
 *
 * Counted between calendar days rather than instants, so the number changes
 * when the day changes at the venue — not when UTC happens to tick over while
 * everyone involved is still on yesterday evening.
 */
export function daysUntilCalendarDate(date: string, now: Date, timeZone: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return 0;

  const [year, month, day] = calendarDayAt(now, timeZone);
  const today = Date.UTC(year, month - 1, day);
  return Math.max(0, Math.round((target - today) / 86_400_000));
}

/**
 * Which calendar day a real instant falls on at the venue, as `"2027-04-12"`.
 *
 * The bridge between the two kinds of date in this app: a `timestamptz` is an
 * instant, and asking "what day is that?" is only answerable once you name a
 * place. 06:59Z on the thirteenth is still the evening of the twelfth in Los
 * Angeles, and the pill in the header should say so.
 */
export function calendarDayIn(instant: Date, timeZone: string): string {
  const [year, month, day] = calendarDayAt(instant, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Signed whole days from today-at-the-venue to `date`. Negative means past.
 *
 * The counterpart to `daysUntilCalendarDate`, which floors at zero and so
 * cannot tell "due today" from "three weeks overdue". Due dates need the
 * difference, so they use this one. Both count between calendar days at the
 * venue rather than between instants, because a payment is late when the
 * morning arrives in Guadalajara, not when UTC rolls over.
 *
 * An unparseable date returns `0`, matching the sibling function: a malformed
 * value is not evidence that something is overdue.
 */
export function calendarDayDelta(date: string, now: Date, timeZone: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return 0;

  const [year, month, day] = calendarDayAt(now, timeZone);
  const today = Date.UTC(year, month - 1, day);
  return Math.round((target - today) / 86_400_000);
}

/** The header pill's wording, plus whether the deadline has run out. */
export type RsvpDeadlineNotice = { label: string; closed: boolean };

/**
 * The RSVP countdown in the admin header, from a `timestamptz` deadline.
 *
 * Counted in calendar days at the venue, not in elapsed hours: the honest
 * answer to "how long have I got?" is a number of sleeps. Instant arithmetic
 * used to round four remaining hours up to "1 days" and then stick on "0 days"
 * forever once the moment passed.
 *
 * The two clocks here are deliberate, and conflating them is the bug this
 * function exists to avoid. The *wording* counts calendar days, because sleeps
 * are what a person plans around. Whether RSVPs are actually `closed` is the
 * instant, because that is what the guest page enforces. On the deadline day
 * itself those disagree — zero sleeps left, but the form is open until 23:59 —
 * and the header must say "closes today", never "closed". Saying "closed" while
 * submissions are still landing is the one wrong answer here: it is the day the
 * couple watches this pill hardest, and it would stop them chasing the
 * stragglers with hours still on the clock.
 */
export function rsvpDeadlineNotice(
  deadline: string | null,
  now: Date,
  timeZone: string,
): RsvpDeadlineNotice | null {
  if (!deadline) return null;
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;

  if (at <= now.getTime()) return { label: "RSVPs closed", closed: true };

  const delta = calendarDayDelta(calendarDayIn(new Date(at), timeZone), now, timeZone);
  if (delta <= 0) return { label: "RSVPs close today", closed: false };
  if (delta === 1) return { label: "RSVPs close in 1 day", closed: false };
  return { label: `RSVPs close in ${delta} days`, closed: false };
}
