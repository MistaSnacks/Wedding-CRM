import { cache } from "react";
import type { WeddingScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import { readAll } from "@/lib/data/query";
import { liveResponses } from "@/lib/data/event-rules";
import type { ResponseRow, MealOptionRow, EventRow, SeatingTableRow, SeatAssignmentRow } from "@/lib/types";

export type ReportTable = { name: string; rows: Array<Record<string, string | number>> };
export const GUEST_REPORTS = ["guest-list", "households", "rsvp-status", "attending", "declined", "pending", "meals", "dietary", "accessibility", "seating", "addresses", "caterer"] as const;
export const EVENT_REPORTS: readonly string[] = ["attending", "declined", "pending", "meals", "dietary", "accessibility", "seating", "caterer"];
export class ReportInputError extends Error {}

export function formatAddress(address: Record<string, string> | null): string {
  if (!address) return "";
  if (address.raw) return address.raw;
  return [address.street, address.city, address.state, address.zip, address.country].filter(Boolean).join(", ");
}

/** Deduplicate the same scoped snapshot within one server render only. */
export const loadReportData = cache(async (scope: WeddingScope) => {
  const [hhs, responses, invites, meals, events, tables, seats] = await Promise.all([
    households.list(scope),
    readAll<ResponseRow>(() => scope.db.from("guest_event_responses").select("guest_id,event_id,attending,meal_option_id,responded_at,responded_via").eq("wedding_id", scope.weddingId).order("guest_id").order("event_id")),
    readAll<{ household_id: string; event_id: string }>(() => scope.db.from("household_event_invites").select("household_id,event_id").eq("wedding_id", scope.weddingId).order("household_id").order("event_id")),
    readAll<MealOptionRow>(() => scope.db.from("meal_options").select("id,name,is_kids_meal,sort_order,event_id,is_active,name_i18n").eq("wedding_id", scope.weddingId).order("sort_order").order("id")),
    readAll<EventRow>(() => scope.db.from("events").select("id,name,starts_at,venue_name,rsvp_enabled,seating_published_at,sort_order").eq("wedding_id", scope.weddingId).order("sort_order").order("id")),
    readAll<SeatingTableRow>(() => scope.db.from("seating_tables").select("id,event_id,name,capacity,shape,pos_x,pos_y").eq("wedding_id", scope.weddingId).order("id")),
    readAll<SeatAssignmentRow>(() => scope.db.from("seat_assignments").select("guest_id,event_id,table_id,seat_number").eq("wedding_id", scope.weddingId).order("guest_id").order("event_id")),
  ]);
  return { hhs, responses: liveResponses(responses, invites, hhs.flatMap(h => h.guests)), invites, meals, events, tables, seats };
});
export type ReportData = Awaited<ReturnType<typeof loadReportData>>;

export function selectedEvent(data: Pick<ReportData, "events">, eventId?: string | null) {
  const event = eventId ? data.events.find(e => e.id === eventId) : data.events.length === 1 ? data.events[0] : undefined;
  if (!event) throw new ReportInputError(eventId ? "That event is not available." : "Choose an event for this report.");
  return event;
}

/** Pure report construction: every operational fact is joined by guest AND event. */
export function buildGuestReport(data: ReportData, report: string, eventId?: string | null, generatedAt = new Date().toISOString()): ReportTable {
  const event = EVENT_REPORTS.includes(report) ? selectedEvent(data, eventId) : null;
  const byResponse = new Map(data.responses.map(r => [`${r.guest_id}:${r.event_id}`, r]));
  const bySeat = new Map(data.seats.map(s => [`${s.guest_id}:${s.event_id}`, s]));
  const byTable = new Map(data.tables.map(t => [t.id, t]));
  const byMeal = new Map(data.meals.map(m => [m.id, m]));
  const invites = new Set(data.invites.map(i => `${i.household_id}:${i.event_id}`));
  const rows = data.hhs.flatMap(h => h.guests.map(g => ({ h, g })));
  const attending = (id: string, eid: string) => byResponse.get(`${id}:${eid}`)?.attending ?? "pending";
  const meal = (id: string, eid: string) => {
    const option = byMeal.get(byResponse.get(`${id}:${eid}`)?.meal_option_id ?? "");
    return option && (!option.event_id || option.event_id === eid) ? option.name : "";
  };
  const table = (id: string, eid: string) => {
    const seat = bySeat.get(`${id}:${eid}`);
    const t = seat && byTable.get(seat.table_id);
    return t?.event_id === eid ? t.name : "";
  };
  const liveRows = event ? rows.filter(({ h }) => invites.has(`${h.id}:${event.id}`)) : rows;
  const name = event ? `${event.name} ${report}` : report;
  const stamp: Record<string,string> = event ? { Event: event.name, "Generated at": generatedAt } : {};
  switch (report) {
    case "guest-list": return { name: "Guest List", rows: rows.map(({ h, g }) => ({
      Household: h.display_name, "First Name": g.first_name, "Last Name": g.last_name, "Age Type": g.age_type,
      ...Object.fromEntries(data.events.flatMap(e => [
        [`${e.name} [${e.id}] RSVP`, invites.has(`${h.id}:${e.id}`) ? attending(g.id, e.id) : "not invited"],
        [`${e.name} [${e.id}] Meal`, meal(g.id, e.id)], [`${e.name} [${e.id}] Table`, table(g.id, e.id)],
      ])), Dietary: g.dietary_restrictions ?? "", Allergies: g.allergies ?? "", Accessibility: g.accessibility_needs ?? "",
    })) };
    case "households": return { name: "Households", rows: data.hhs.map(h => ({ Household: h.display_name, Contact: h.primary_contact_name ?? "", Email: h.email ?? "", Phone: h.phone ?? "", Guests: h.guests.length, "Max Party": h.max_party_size, "Plus Ones": h.plus_one_slots, Status: h.rsvp_status, Language: h.preferred_locale })) };
    case "rsvp-status": return { name: "RSVP Status", rows: data.hhs.map(h => ({ Household: h.display_name, Status: h.rsvp_status, Guests: h.guests.length })) };
    case "addresses": return { name: "Addresses", rows: data.hhs.map(h => ({ Household: h.display_name, Contact: h.primary_contact_name ?? "", Address: formatAddress(h.mailing_address), Email: h.email ?? "", Phone: h.phone ?? "" })) };
    case "attending": case "declined": case "pending": {
      const want = report === "attending" ? "yes" : report === "declined" ? "no" : "pending";
      return { name, rows: liveRows.filter(({ g }) => attending(g.id, event!.id) === want).map(({ h, g }) => ({ ...stamp, Household: h.display_name, Guest: `${g.first_name} ${g.last_name}`, Status: want, Meal: meal(g.id, event!.id), Email: h.email ?? "" })) };
    }
    case "meals": {
      const yes = liveRows.filter(({ g }) => attending(g.id, event!.id) === "yes");
      const counts = new Map<string, number>();
      for (const { g } of yes) { const label = meal(g.id, event!.id) || "MISSING"; counts.set(label, (counts.get(label) ?? 0) + 1); }
      return { name, rows: [...counts].map(([Meal, Count]) => ({ ...stamp, Meal, Count })) };
    }
    case "dietary": case "accessibility": return { name, rows: liveRows.filter(({ g }) => attending(g.id, event!.id) === "yes" && (report === "dietary" ? g.dietary_restrictions || g.allergies : g.accessibility_needs)).map(({ h, g }) => ({ ...stamp, Guest: `${g.first_name} ${g.last_name}`, Household: h.display_name, Table: table(g.id, event!.id), ...(report === "dietary" ? { Dietary: g.dietary_restrictions ?? "", Allergies: g.allergies ?? "" } : { Needs: g.accessibility_needs ?? "" }) })) };
    case "seating": case "caterer": return { name, rows: liveRows.filter(({ g }) => attending(g.id, event!.id) === "yes").map(({ h, g }) => {
      const seat = bySeat.get(`${g.id}:${event!.id}`);
      return { ...stamp, Guest: `${g.first_name} ${g.last_name}`, "Guest ID": g.id, Table: table(g.id, event!.id) || "UNASSIGNED", "Table ID": seat?.table_id ?? "", Seat: seat?.seat_number ?? "", Meal: meal(g.id, event!.id) || "MISSING", "Age Type": g.age_type, Dietary: [g.dietary_restrictions, g.allergies].filter(Boolean).join(" / "), Household: h.display_name };
    }) };
    default: throw new ReportInputError("Unknown report");
  }
}
