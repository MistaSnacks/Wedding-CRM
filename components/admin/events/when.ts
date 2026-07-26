/**
 * Wall-clock helpers for event times.
 *
 * A time she types is the time at the venue, so every conversion goes through
 * the wedding's own timezone rather than the server's — a Vercel function runs
 * in UTC and would otherwise shift every event she enters by seven hours.
 *
 * Pure and server-side: the pages format labels and split form fields before
 * handing them to the client, so no date logic ships to the browser.
 */

/** How far `timeZone` sits from UTC at a given instant, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const at: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") at[part.type] = Number(part.value);
  }
  // Some ICU builds render midnight as hour 24 under hour12: false.
  const asUtc = Date.UTC(at.year, at.month - 1, at.day, at.hour % 24, at.minute, at.second);
  return asUtc - instant.getTime();
}

/**
 * `2027-06-12` + `18:00` read as venue time → the matching UTC instant.
 *
 * Returns null when there is no date: a time on its own has nothing to attach
 * to, and the caller says so in words rather than guessing a day.
 *
 * The offset is applied twice because the first reading is taken at roughly
 * the right instant; the second corrects the case where that guess landed on
 * the far side of a daylight-saving change.
 */
export function toInstant(date: string, time: string, timeZone: string): string | null {
  const day = date.trim();
  if (day.length === 0) return null;

  const wall = Date.parse(`${day}T${time.trim() || "00:00"}:00Z`);
  if (Number.isNaN(wall)) return null;

  let ms = wall - offsetAt(new Date(wall), timeZone);
  ms = wall - offsetAt(new Date(ms), timeZone);
  return new Date(ms).toISOString();
}

/**
 * The inverse, for form defaults: an instant back into the `<input type=date>`
 * and `<input type=time>` values that produced it.
 *
 * A stored midnight comes back as a blank time. `starts_at` cannot record
 * "this day, time still undecided" on its own, and a half-planned event with
 * no time yet is far more common than one that starts on the stroke of
 * midnight — which she can still enter as 12:01 AM.
 */
export function toFields(iso: string | null, timeZone: string): { date: string; time: string } {
  if (iso === null) return { date: "", time: "" };
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { date: "", time: "" };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));

  const at: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") at[part.type] = part.value;
  }
  const hour = String(Number(at.hour) % 24).padStart(2, "0");
  const time = hour === "00" && at.minute === "00" ? "" : `${hour}:${at.minute}`;
  return { date: `${at.year}-${at.month}-${at.day}`, time };
}

/** "Saturday, June 12, 2027 · 4:00 PM" — or without the time when there isn't one. */
export function formatWhen(iso: string | null, timeZone: string): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const at = new Date(ms);

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(at);

  const { time } = toFields(iso, timeZone);
  if (time === "") return day;

  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  return `${day} · ${clock}`;
}
