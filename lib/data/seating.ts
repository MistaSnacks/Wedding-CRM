import { readAll } from "./query";
import type { WeddingScope } from "./scope";
import type { SeatingTableRow, SeatAssignmentRow } from "@/lib/types";
import * as activity from "./activity";
import { invalidateCache } from "@/lib/limiter";

/**
 * I/O for seating. Every id that reaches this module came from a page, a drag
 * handler, or a form field, which means it came from the client and cannot be
 * trusted. So every query filters `wedding_id`, and every write that names an
 * existing row confirms the row is ours first (`requireTable`) rather than
 * letting an `upsert` adopt a foreign row by rewriting its `wedding_id`.
 * RLS is the backstop; the admin surface uses the service-role client, which
 * bypasses RLS entirely, so these filters are the actual guarantee.
 */

const TABLE_COLS = "id, event_id, name, capacity, shape, pos_x, pos_y";

/** Everything that changes a seating chart also changes the Overview numbers. */
function invalidateMetrics(scope: WeddingScope): void {
  invalidateCache(`metrics:${scope.weddingId}`);
}

/** Confirms a table belongs to this wedding before any write touches it. */
async function requireTable(
  scope: WeddingScope,
  id: string,
): Promise<SeatingTableRow> {
  const { data, error } = await scope.db
    .from("seating_tables")
    .select(TABLE_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Table not found in this wedding");
  return data as SeatingTableRow;
}

/** Confirms an event belongs to this wedding before a table is attached to it. */
async function requireEventId(
  scope: WeddingScope,
  eventId: string,
): Promise<void> {
  const { data, error } = await scope.db
    .from("events")
    .select("id")
    .eq("wedding_id", scope.weddingId)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Event not found in this wedding");
}

export async function listTables(
  scope: WeddingScope,
  eventId: string,
): Promise<SeatingTableRow[]> {
  return readAll<SeatingTableRow>(() => scope.db.from("seating_tables").select(TABLE_COLS).eq("wedding_id",scope.weddingId).eq("event_id",eventId).order("name").order("id"));
}

export async function listAssignments(
  scope: WeddingScope,
  eventId: string,
): Promise<SeatAssignmentRow[]> {
  return readAll<SeatAssignmentRow>(() => scope.db.from("seat_assignments").select("guest_id,event_id,table_id,seat_number").eq("wedding_id",scope.weddingId).eq("event_id",eventId).order("guest_id"));
}

/**
 * Creates a table, or edits one this wedding owns.
 *
 * Split into insert and update on purpose. A single `upsert` carrying a
 * client-supplied primary key will happily write `wedding_id` onto a row that
 * belongs to somebody else — the id conflicts, the update applies, and the
 * table is silently moved between weddings. An update filtered on
 * `wedding_id` cannot do that, and `requireTable` turns a foreign id into an
 * error instead of a no-op so the caller learns the edit did not happen.
 */
export async function upsertTable(
  scope: WeddingScope,
  t: {
    id?: string;
    eventId: string;
    name: string;
    capacity: number;
    shape?: "round" | "rect" | "banquet";
    posX?: number;
    posY?: number;
  },
): Promise<SeatingTableRow> {
  if (
    !t.name.trim() ||
    t.name.length > 120 ||
    !Number.isInteger(t.capacity) ||
    t.capacity < 1 ||
    t.capacity > 1000
  )
    throw new Error("Enter a table name and capacity between 1 and 1000.");
  await requireEventId(scope, t.eventId);

  const fields = {
    event_id: t.eventId,
    name: t.name.trim(),
    capacity: t.capacity,
    ...(t.shape ? { shape: t.shape } : {}),
    ...(t.posX !== undefined ? { pos_x: t.posX } : {}),
    ...(t.posY !== undefined ? { pos_y: t.posY } : {}),
  };

  if (t.id) {
    await requireTable(scope, t.id);
    const { data, error } = await scope.db
      .from("seating_tables")
      .update(fields)
      .eq("wedding_id", scope.weddingId)
      .eq("id", t.id)
      .select(TABLE_COLS)
      .single();
    if (error) throw new Error(error.message);
    invalidateMetrics(scope);
    return data as SeatingTableRow;
  }

  const { data, error } = await scope.db
    .from("seating_tables")
    .insert({ ...fields, wedding_id: scope.weddingId })
    .select(TABLE_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);
  return data as SeatingTableRow;
}

export async function moveTable(
  scope: WeddingScope,
  tableId: string,
  posX: number,
  posY: number,
): Promise<void> {
  if (!Number.isFinite(posX) || !Number.isFinite(posY))
    throw new Error("Invalid table position");
  const { error } = await scope.db
    .from("seating_tables")
    .update({ pos_x: posX, pos_y: posY })
    .eq("wedding_id", scope.weddingId)
    .eq("id", tableId);
  if (error) throw new Error(error.message);
}

/**
 * Saves a table's turn, in degrees, from the 3D venue editor.
 *
 * `rotation` arrives with migration 0020. Until that runs, the column is
 * missing and the write reports `persisted: false` instead of failing, so the
 * editor keeps working and simply does not remember turns.
 */
export async function turnTable(
  scope: WeddingScope,
  tableId: string,
  rotation: number,
): Promise<{ persisted: boolean }> {
  if (!Number.isFinite(rotation)) throw new Error("Invalid table turn");
  await requireTable(scope, tableId);
  const degrees = ((Math.round(rotation) % 360) + 360) % 360;
  const { error } = await scope.db
    .from("seating_tables")
    .update({ rotation: degrees })
    .eq("wedding_id", scope.weddingId)
    .eq("id", tableId);
  if (error) {
    if (isMissingRotation(error)) return { persisted: false };
    throw new Error(error.message);
  }
  return { persisted: true };
}

/** PostgREST (PGRST204) or Postgres (42703) saying the column is not there yet. */
export function isMissingRotation(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === "PGRST204" || error.code === "42703") &&
    /rotation/i.test(error.message ?? "")
  );
}

export async function deleteTable(
  scope: WeddingScope,
  tableId: string,
): Promise<void> {
  const { error } = await scope.db
    .from("seating_tables")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", tableId);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);
}

/**
 * Seats one guest at one table.
 *
 * Both ids are checked before the write, not after: the table must be ours,
 * the guest must be ours, and the table must belong to the event being seated
 * — otherwise a crafted `tableId` would attach one of our guests to another
 * wedding's chart, and the old unscoped `guests` lookup would have leaked that
 * guest's household id into our activity log on the way past.
 */
export async function assign(
  scope: WeddingScope,
  guestId: string,
  eventId: string,
  tableId: string,
  actorId?: string,
): Promise<void> {
  const table = await requireTable(scope, tableId);
  if (table.event_id !== eventId)
    throw new Error("Table does not belong to this event");

  const { data: guest, error: guestError } = await scope.db
    .from("guests")
    .select("household_id")
    .eq("wedding_id", scope.weddingId)
    .eq("id", guestId)
    .maybeSingle();
  if (guestError) throw new Error(guestError.message);
  if (!guest) throw new Error("Guest not found in this wedding");

  await assignGroup(scope, [guestId], eventId, tableId, actorId);
}

/** One SQL transaction validates and seats the entire group. */
export async function assignGroup(
  scope: WeddingScope,
  guestIds: string[],
  eventId: string,
  tableId: string,
  actorId?: string,
): Promise<void> {
  const { error } = await scope.db.rpc("assign_seating_group", {
    p_wedding_id: scope.weddingId,
    p_event_id: eventId,
    p_table_id: tableId,
    p_guest_ids: [...new Set(guestIds)],
    p_actor_id: actorId ?? null,
  });
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);
}

export async function unassign(
  scope: WeddingScope,
  guestId: string,
  eventId: string,
): Promise<void> {
  const { error } = await scope.db
    .from("seat_assignments")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("guest_id", guestId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);
}

export async function setPublished(
  scope: WeddingScope,
  eventId: string,
  published: boolean,
  actorId?: string,
): Promise<void> {
  const { error } = await scope.db.rpc("publish_seating", {
    p_wedding_id: scope.weddingId,
    p_event_id: eventId,
    p_published: published,
    p_actor_id: actorId ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Guest-facing: the table + tablemates for one guest at one event (only if published). */
export async function guestTable(
  scope: WeddingScope,
  guestId: string,
  eventId: string,
): Promise<{
  tableName: string;
  mates: Array<{ first_name: string; last_name: string }>;
} | null> {
  const { data, error } = await scope.db.rpc("guest_table_info", {
    p_wedding_id: scope.weddingId,
    p_guest_id: guestId,
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return data as {
    tableName: string;
    mates: Array<{ first_name: string; last_name: string }>;
  } | null;
}
