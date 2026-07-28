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
