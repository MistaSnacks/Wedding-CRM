import type { WeddingScope } from "./scope";
import type { SeatingTableRow, SeatAssignmentRow } from "@/lib/types";
import * as activity from "./activity";

export async function listTables(scope: WeddingScope, eventId: string): Promise<SeatingTableRow[]> {
  const { data, error } = await scope.db
    .from("seating_tables")
    .select("id, event_id, name, capacity, shape, pos_x, pos_y")
    .eq("wedding_id", scope.weddingId)
    .eq("event_id", eventId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SeatingTableRow[];
}

export async function listAssignments(scope: WeddingScope, eventId: string): Promise<SeatAssignmentRow[]> {
  const { data, error } = await scope.db
    .from("seat_assignments")
    .select("guest_id, event_id, table_id, seat_number")
    .eq("wedding_id", scope.weddingId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  return (data ?? []) as SeatAssignmentRow[];
}

export async function upsertTable(
  scope: WeddingScope,
  t: { id?: string; eventId: string; name: string; capacity: number; shape?: "round" | "rect" | "banquet"; posX?: number; posY?: number },
): Promise<SeatingTableRow> {
  const row = {
    ...(t.id ? { id: t.id } : {}),
    wedding_id: scope.weddingId,
    event_id: t.eventId,
    name: t.name,
    capacity: t.capacity,
    ...(t.shape ? { shape: t.shape } : {}),
    ...(t.posX !== undefined ? { pos_x: t.posX } : {}),
    ...(t.posY !== undefined ? { pos_y: t.posY } : {}),
  };
  const { data, error } = await scope.db.from("seating_tables").upsert(row).select().single();
  if (error) throw new Error(error.message);
  return data as SeatingTableRow;
}

export async function moveTable(scope: WeddingScope, tableId: string, posX: number, posY: number): Promise<void> {
  const { error } = await scope.db
    .from("seating_tables")
    .update({ pos_x: posX, pos_y: posY })
    .eq("wedding_id", scope.weddingId)
    .eq("id", tableId);
  if (error) throw new Error(error.message);
}

export async function deleteTable(scope: WeddingScope, tableId: string): Promise<void> {
  const { error } = await scope.db
    .from("seating_tables")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", tableId);
  if (error) throw new Error(error.message);
}

export async function assign(
  scope: WeddingScope,
  guestId: string,
  eventId: string,
  tableId: string,
  actorId?: string,
): Promise<void> {
  const { error } = await scope.db.from("seat_assignments").upsert({
    guest_id: guestId,
    event_id: eventId,
    wedding_id: scope.weddingId,
    table_id: tableId,
  });
  if (error) throw new Error(error.message);
  const { data: guest } = await scope.db.from("guests").select("household_id").eq("id", guestId).single();
  await activity.log(scope, {
    householdId: guest?.household_id,
    guestId,
    actorType: "admin",
    actorId,
    action: "table.assigned",
    payload: { tableId, eventId },
  });
}

export async function unassign(scope: WeddingScope, guestId: string, eventId: string): Promise<void> {
  const { error } = await scope.db
    .from("seat_assignments")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("guest_id", guestId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
}

export async function setPublished(scope: WeddingScope, eventId: string, published: boolean): Promise<void> {
  const { error } = await scope.db
    .from("events")
    .update({ seating_published_at: published ? new Date().toISOString() : null })
    .eq("wedding_id", scope.weddingId)
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  await activity.log(scope, {
    actorType: "admin",
    action: published ? "seating.published" : "seating.unpublished",
    payload: { eventId },
  });
}

/** Guest-facing: the table + tablemates for one guest at one event (only if published). */
export async function guestTable(
  scope: WeddingScope,
  guestId: string,
  eventId: string,
): Promise<{ tableName: string; mates: Array<{ first_name: string; last_name: string }> } | null> {
  const { data: event } = await scope.db
    .from("events")
    .select("seating_published_at")
    .eq("id", eventId)
    .single();
  if (!event?.seating_published_at) return null;

  const { data: seat } = await scope.db
    .from("seat_assignments")
    .select("table_id")
    .eq("guest_id", guestId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!seat) return null;

  const [{ data: table }, { data: mates }] = await Promise.all([
    scope.db.from("seating_tables").select("name").eq("id", seat.table_id).single(),
    scope.db
      .from("seat_assignments")
      .select("guest_id, guests(first_name, last_name)")
      .eq("table_id", seat.table_id)
      .eq("event_id", eventId)
      .neq("guest_id", guestId),
  ]);

  return {
    tableName: table?.name ?? "",
    mates: ((mates ?? []) as unknown as Array<{ guests: { first_name: string; last_name: string } }>).map(
      (m) => m.guests,
    ),
  };
}
