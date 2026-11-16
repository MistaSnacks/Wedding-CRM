import type { EventRow } from "@/lib/types";
function text(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function instant(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
/** RFC5545 folds at octet boundaries, never splitting a Unicode code point. */
function fold(line: string) {
  let result = "",
    width = 0;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (width + bytes > 75) {
      result += "\r\n ";
      width = 1;
    }
    result += char;
    width += bytes;
  }
  return result;
}
export function invitationCalendar(
  events: EventRow[],
  coupleName: string,
  now = new Date(),
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Guest CRM//Wedding invitation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const event of events.filter((e) => e.starts_at)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@guest-crm`,
      `DTSTAMP:${instant(now.toISOString())}`,
      `DTSTART:${instant(event.starts_at!)}`,
      `SUMMARY:${text(`${coupleName} — ${event.name}`)}`,
    );
    if (event.ends_at) lines.push(`DTEND:${instant(event.ends_at)}`);
    if (event.venue_name || event.venue_address)
      lines.push(
        `LOCATION:${text([event.venue_name, event.venue_address].filter(Boolean).join(", "))}`,
      );
    if (event.dress_code) lines.push(`DESCRIPTION:${text(event.dress_code)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
