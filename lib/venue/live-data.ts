import type { SeatingTableRow } from "@/lib/types";
import { demoGuests, initialTables } from "./model";
import { canvasToMetres, dbShapeToKind, type TableKind } from "./seating-sync";

/** One table in metres, ready for the live 3D scene. Read-only. */
export type LiveTable = {
  id: string;
  name: string;
  x: number;
  z: number;
  rotation: number;
  shape: "round" | "rect";
  width: number;
  depth: number;
  capacity: number;
  /** Round, long or head; follows `seating_tables.shape` for real tables. */
  kind?: TableKind;
  guests: string[];
  /** Guest ids in seat order, parallel to `guests`, when known. */
  guestIds?: string[];
};

/** A guest the layout editor can seat. Household is a display group. */
export type LiveGuest = { id: string; name: string; household: string; householdId?: string };

export type LiveVenue = {
  source: "live" | "sample";
  eventName: string;
  tables: LiveTable[];
  /** Everyone who can be seated, including guests without a seat. */
  guests: LiveGuest[];
  /** The real event these tables belong to (live data only). */
  eventId?: string;
};

/** Terrace interior is 28 x 28 m. Tables stay inside this square. */
const HALF = 14;
const MARGIN = 2.2;

export function footprint(
  shape: SeatingTableRow["shape"] | LiveTable["shape"],
  capacity: number,
): { shape: LiveTable["shape"]; width: number; depth: number } {
  if (shape === "round") {
    const d = capacity <= 6 ? 1.5 : capacity <= 10 ? 1.8 : 2.1;
    return { shape: "round", width: d, depth: d };
  }
  // Rect and banquet: about 0.65 m of edge per guest on two long sides.
  const perSide = Math.max(2, Math.ceil(capacity / 2));
  const width = Math.max(1.8, perSide * 0.65 + 0.3);
  return { shape: "rect", width, depth: shape === "banquet" ? 1.1 : 1.0 };
}

export function sampleVenue(): LiveVenue {
  const names = new Map(demoGuests.map((g) => [g.id, g.name]));
  return {
    source: "sample",
    eventName: "Sample reception",
    guests: demoGuests,
    tables: initialTables().map((t) => ({
      id: t.id,
      name: t.name,
      x: t.x,
      z: t.z,
      rotation: t.rotation,
      shape: t.shape,
      width: t.width,
      depth: t.depth,
      capacity: t.capacity,
      guests: t.guestIds.map((id) => names.get(id) ?? "Guest"),
      guestIds: [...t.guestIds],
    })),
  };
}

/**
 * Real tables in metres. Positions use the shared canvas conversion in
 * `seating-sync.ts`, so a table sits where the Seating page shows it and a
 * move here saves back to the same spot. `rotation` is in degrees and is
 * missing (treated as 0) until migration 0020 adds the column.
 */
export function fromSeating(
  rows: Array<SeatingTableRow & { rotation?: number | null }>,
  guestsByTable: Map<string, LiveGuest[]>,
  eventName: string,
  guests: LiveGuest[] = [],
  eventId?: string,
): LiveVenue {
  const lim = HALF - MARGIN + 0.6;
  const tables = rows.map((r): LiveTable => {
    const f = footprint(r.shape, r.capacity);
    const { x, z } = canvasToMetres(r.pos_x, r.pos_y, r.shape);
    const rotation = Number.isFinite(r.rotation) ? (r.rotation as number) : 0;
    return {
      id: r.id,
      name: r.name,
      x: Math.max(-lim, Math.min(lim, x)),
      z: Math.max(-lim, Math.min(lim, z)),
      rotation,
      ...f,
      kind: dbShapeToKind(r.shape),
      capacity: r.capacity,
      guests: (guestsByTable.get(r.id) ?? []).map((g) => g.name),
      guestIds: (guestsByTable.get(r.id) ?? []).map((g) => g.id),
    };
  });
  return { source: "live", eventName, tables, guests, eventId };
}
