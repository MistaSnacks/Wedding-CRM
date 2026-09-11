export function safeDocumentUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const url = new URL(raw.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTPS or HTTP document link.");
  return url.toString();
}

export function validCalendarDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new Error("Choose a valid calendar date.");
  return value;
}

export type CalendarEntry = { id: string; title: string; date: string; description?: string; url?: string };
const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r\n?|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
/** Fold by UTF-8 bytes so Unicode vendor names are valid RFC5545 lines. */
function fold(line: string): string {
  let current = "", out = "", bytes = 0;
  for (const c of line) {
    const length = new TextEncoder().encode(c).length;
    if (bytes + length > 73) { out += current + "\r\n "; current = ""; bytes = 1; }
    current += c; bytes += length;
  }
  return out + current;
}
export function planningCalendar(entries: CalendarEntry[], generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Guest CRM//Planning//EN", "CALSCALE:GREGORIAN"];
  for (const e of entries) {
    validCalendarDay(e.date);
    lines.push("BEGIN:VEVENT", `UID:${escapeIcs(e.id)}@guest-crm`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`, `SUMMARY:${escapeIcs(e.title)}`,
      `DESCRIPTION:${escapeIcs(e.description ?? "")}`);
    if (e.url) lines.push(`URL:${escapeIcs(e.url)}`);
    lines.push("END:VEVENT");
  }
  return lines.concat("END:VCALENDAR").map(fold).join("\r\n") + "\r\n";
}

export function headcountEstimate(count: number, unitCents: number): number {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(unitCents) || unitCents < 0 || !Number.isSafeInteger(count * unitCents))
    throw new Error("Headcount and price must be valid non-negative numbers.");
  return count * unitCents;
}
