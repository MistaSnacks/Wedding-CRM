import { serverClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/admin";
import { forWedding, type WeddingScope } from "@/lib/data/scope";
import { readAll } from "@/lib/data/query";
import type { SeatAssignmentRow, SeatingTableRow } from "@/lib/types";
import type { LiveGuest } from "./live-data";
import { fromSeating, sampleVenue, type LiveVenue } from "./live-data";

export type VenuePageData = LiveVenue & {
  signedIn: boolean;
  /** Owner or editor: edits save to Seating. Viewers see real data, read-only. */
  canEdit: boolean;
  /** The wedding's events, for the event picker (signed-in members only). */
  events: { id: string; name: string }[];
};

/**
 * Real tables for the signed-in member's wedding, or the labelled sample.
 *
 * The page is public, so data loads only for a wedding member. The wedding
 * comes from the same membership lookup as `requireAdmin`, so the page shows
 * the wedding that the seating actions write to. Every query filters on that
 * one `wedding_id`; no id from the URL can reach another wedding's rows (the
 * `event` parameter is only matched against this wedding's own events).
 */
export async function loadVenue(eventId?: string): Promise<VenuePageData> {
  let member: { weddingId: string; role: string } | null = null;
  try {
    const supabase = await serverClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { data: m } = await adminDb()
        .from("wedding_members")
        .select("wedding_id, role")
        .eq("user_id", data.user.id)
        .limit(1)
        .maybeSingle();
      member = m ? { weddingId: m.wedding_id, role: m.role } : null;
    }
  } catch {
    member = null;
  }
  if (!member) return { ...sampleVenue(), signedIn: false, canEdit: false, events: [] };

  const scope = forWedding(member.weddingId);
  type Ev = { id: string; name: string; sort_order: number | null };
  const [events, tables, seats] = await Promise.all([
    readAll<Ev>(() => scope.db.from("events").select("id,name,sort_order").eq("wedding_id", scope.weddingId).order("sort_order").order("id")),
    readTables(scope),
    readAll<SeatAssignmentRow>(() => scope.db.from("seat_assignments").select("guest_id,event_id,table_id,seat_number").eq("wedding_id", scope.weddingId).order("guest_id").order("event_id")),
  ]);
  const canEdit = member.role === "owner" || member.role === "editor";
  const eventList = events.map((e) => ({ id: e.id, name: e.name }));
  // The requested event, else the last event with tables, else the last event
  // (the Seating page's default), so a new wedding can start its first table here.
  const withTables = events.filter((e) => tables.some((t) => t.event_id === e.id));
  const event =
    events.find((e) => e.id === eventId) ?? withTables[withTables.length - 1] ?? events[events.length - 1];
  if (!event) return { ...sampleVenue(), signedIn: true, canEdit: false, events: [] };

  const rows = tables.filter((t) => t.event_id === event.id);
  const assigned = seats.filter((s) => s.event_id === event.id);
  type G = { id: string; first_name: string | null; last_name: string | null; household_id: string | null };
  type H = { id: string; display_name: string | null; archived_at: string | null };
  const [all, households, invites, yes] = await Promise.all([
    readAll<G>(() => scope.db.from("guests").select("id,first_name,last_name,household_id").eq("wedding_id", scope.weddingId).order("id")),
    readAll<H>(() => scope.db.from("households").select("id,display_name,archived_at").eq("wedding_id", scope.weddingId).order("id")),
    readAll<{ household_id: string }>(() => scope.db.from("household_event_invites").select("household_id").eq("wedding_id", scope.weddingId).eq("event_id", event.id).order("household_id")),
    readAll<{ guest_id: string }>(() => scope.db.from("guest_event_responses").select("guest_id").eq("wedding_id", scope.weddingId).eq("event_id", event.id).eq("attending", "yes").order("guest_id")),
  ]);
  const familyName = new Map(households.map((h) => [h.id, (h.display_name ?? "").trim()]));
  const active = new Set(households.filter((h) => !h.archived_at).map((h) => h.id));
  const invited = new Set(invites.map((i) => i.household_id));
  const coming = new Set(yes.map((r) => r.guest_id));
  const seatedIds = new Set(assigned.map((s) => s.guest_id));
  // The same rule as the Seating page and the database: only invited guests
  // who said yes can take a seat. Anyone already seated stays visible.
  const seatable = all.filter(
    (g) =>
      seatedIds.has(g.id) ||
      (coming.has(g.id) && g.household_id !== null && active.has(g.household_id) && invited.has(g.household_id)),
  );
  const guests: LiveGuest[] = seatable.map((g) => {
    const name = `${g.first_name ?? ""} ${g.last_name ?? ""}`.trim() || "Guest";
    const family = (g.household_id && familyName.get(g.household_id)) || `${g.last_name ?? name} family`;
    return { id: g.id, name, household: family, ...(g.household_id ? { householdId: g.household_id } : {}) };
  });
  const byId = new Map(guests.map((g) => [g.id, g]));
  const byTable = new Map<string, LiveGuest[]>();
  for (const s of [...assigned].sort((a, b) => (a.seat_number ?? 99) - (b.seat_number ?? 99))) {
    const list = byTable.get(s.table_id) ?? [];
    list.push(byId.get(s.guest_id) ?? { id: s.guest_id, name: "Guest", household: "Guests" });
    byTable.set(s.table_id, list);
  }
  return {
    ...fromSeating(rows, byTable, event.name, guests, event.id),
    signedIn: true,
    canEdit,
    events: eventList,
  };
}

type TableWithTurn = SeatingTableRow & { rotation?: number | null };

/**
 * Tables with their turn. Before migration 0020 there is no `rotation`
 * column; then read without it, and every table counts as unturned.
 */
async function readTables(scope: WeddingScope): Promise<TableWithTurn[]> {
  const withTurn = () =>
    readAll<TableWithTurn>(() => scope.db.from("seating_tables").select("id,event_id,name,capacity,shape,pos_x,pos_y,rotation").eq("wedding_id", scope.weddingId).order("id"));
  const without = () =>
    readAll<TableWithTurn>(() => scope.db.from("seating_tables").select("id,event_id,name,capacity,shape,pos_x,pos_y").eq("wedding_id", scope.weddingId).order("id"));
  try {
    return await withTurn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // readAll keeps only the message, so match the column name in it.
    if (!/rotation/i.test(message)) throw error;
    return without();
  }
}
