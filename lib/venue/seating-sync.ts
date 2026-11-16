import type { SeatingTableRow } from "@/lib/types";
import type { Draft, LayoutTable } from "./model";

/*
 * The bridge between the 3D layout editor and the saved seating chart.
 * Pure functions only, so every rule here has a unit test:
 *
 *  - canvas pixels <-> metres (one conversion, used both ways)
 *  - editor table kinds <-> the `seating_tables.shape` enum
 *  - the list of saved-chart operations that turns one draft into another.
 *    Undo and redo use the same function with the drafts swapped, so the
 *    inverse of a change is always the change computed backwards.
 */

/* ------------------------------------------------------------ coordinates */

/**
 * The admin Seating canvas (`components/admin/SeatingCanvas.tsx`) stores
 * `pos_x`/`pos_y` as the TOP-LEFT pixel of the table box. The box is
 * 280 x 96 px for rect and banquet tables and 136 x 136 px for round tables.
 * The canvas is 640 px high; its width follows the window.
 *
 * We map the CENTRE of that box to the centre of the table in metres:
 *   metres = (centrePx - ORIGIN) / PX_PER_M
 * At 20 px per metre the 28 x 28 m terrace is 560 px square. ORIGIN_Y = 320
 * centres the room in the 640 px canvas height; ORIGIN_X = 420 keeps the
 * widest box (280 px) clear of the left edge for every table the 3D room
 * allows. The canvas is a diagram, not to scale: only centres line up.
 */
export const CANVAS = {
  PX_PER_M: 20,
  ORIGIN_X: 420,
  ORIGIN_Y: 320,
  /** Must equal RECT_DIMS / ROUND_DIMS in SeatingCanvas.tsx (a test checks). */
  RECT: { w: 280, h: 96 },
  ROUND: { w: 136, h: 136 },
} as const;

export type DbShape = SeatingTableRow["shape"];

function boxFor(shape: DbShape) {
  return shape === "round" ? CANVAS.ROUND : CANVAS.RECT;
}

/** Canvas top-left pixels to the table centre in metres. */
export function canvasToMetres(posX: number, posY: number, shape: DbShape): { x: number; z: number } {
  const box = boxFor(shape);
  return {
    x: (posX + box.w / 2 - CANVAS.ORIGIN_X) / CANVAS.PX_PER_M,
    z: (posY + box.h / 2 - CANVAS.ORIGIN_Y) / CANVAS.PX_PER_M,
  };
}

/** Table centre in metres to canvas top-left pixels (whole pixels, never negative). */
export function metresToCanvas(x: number, z: number, shape: DbShape): { posX: number; posY: number } {
  const box = boxFor(shape);
  return {
    posX: Math.max(0, Math.round(CANVAS.ORIGIN_X + x * CANVAS.PX_PER_M - box.w / 2)),
    posY: Math.max(0, Math.round(CANVAS.ORIGIN_Y + z * CANVAS.PX_PER_M - box.h / 2)),
  };
}

/* ----------------------------------------------------------------- shapes */

export type TableKind = "round" | "long" | "head";

/** Editor kind to the database enum. A head table is the banquet shape. */
export function kindToDbShape(kind: TableKind): DbShape {
  return kind === "round" ? "round" : kind === "head" ? "banquet" : "rect";
}

/** Database enum to the editor kind. */
export function dbShapeToKind(shape: DbShape): TableKind {
  return shape === "round" ? "round" : shape === "banquet" ? "head" : "long";
}

/** The kind of a draft table. The drawn shape wins over a stale `kind`. */
export function kindOf(t: Pick<LayoutTable, "shape" | "kind">): TableKind {
  if (t.shape === "round") return "round";
  return t.kind === "head" ? "head" : "long";
}

export function dbShapeOf(t: Pick<LayoutTable, "shape" | "kind">): DbShape {
  return kindToDbShape(kindOf(t));
}

/* ------------------------------------------------------------- operations */

export type SeatingOp =
  | { type: "create"; tableId: string; name: string; capacity: number; shape: DbShape; posX: number; posY: number; rotation: number }
  | { type: "edit"; tableId: string; name: string; capacity: number; shape: DbShape }
  | { type: "move"; tableId: string; posX: number; posY: number }
  | { type: "turn"; tableId: string; rotation: number }
  | { type: "unassign"; guestId: string }
  | { type: "assign"; tableId: string; guestIds: string[] }
  | { type: "remove"; tableId: string };

function seatMap(tables: LayoutTable[]) {
  const m = new Map<string, string>();
  for (const t of tables) for (const g of t.guestIds) m.set(g, t.id);
  return m;
}

/**
 * The saved-chart operations that turn `before` into `after`.
 *
 * Order matters, because the database checks capacity on every write:
 *  1. new tables, so later seats have somewhere to go;
 *  2. edits that keep or raise capacity, moves and turns;
 *  3. guests who lose their seat (frees room);
 *  4. edits that lower capacity (after room is free);
 *  5. seats, one call per table so a household moves together;
 *  6. removed tables last (removal also clears their seats).
 * Guests at a removed table who get no new seat need no unassign: the
 * database clears their seats with the table.
 */
export function diffDrafts(before: Pick<Draft, "tables">, after: Pick<Draft, "tables">): SeatingOp[] {
  const prev = new Map(before.tables.map((t) => [t.id, t]));
  const next = new Map(after.tables.map((t) => [t.id, t]));
  const creates: SeatingOp[] = [];
  const grows: SeatingOp[] = [];
  const shrinks: SeatingOp[] = [];
  const unassigns: SeatingOp[] = [];
  const assigns: SeatingOp[] = [];
  const removes: SeatingOp[] = [];

  for (const t of after.tables) {
    const shape = dbShapeOf(t);
    const pos = metresToCanvas(t.x, t.z, shape);
    const old = prev.get(t.id);
    if (!old) {
      creates.push({ type: "create", tableId: t.id, name: t.name, capacity: t.capacity, shape, ...pos, rotation: t.rotation });
      continue;
    }
    const oldShape = dbShapeOf(old);
    if (old.name !== t.name || old.capacity !== t.capacity || oldShape !== shape) {
      const edit: SeatingOp = { type: "edit", tableId: t.id, name: t.name, capacity: t.capacity, shape };
      (t.capacity < old.capacity ? shrinks : grows).push(edit);
    }
    const oldPos = metresToCanvas(old.x, old.z, oldShape);
    if (oldPos.posX !== pos.posX || oldPos.posY !== pos.posY) grows.push({ type: "move", tableId: t.id, ...pos });
    if (old.rotation !== t.rotation) grows.push({ type: "turn", tableId: t.id, rotation: t.rotation });
  }
  for (const t of before.tables) if (!next.has(t.id)) removes.push({ type: "remove", tableId: t.id });

  const was = seatMap(before.tables);
  const now = seatMap(after.tables);
  for (const [guestId, tableId] of was) {
    if (now.has(guestId)) continue;
    if (!next.has(tableId)) continue; // cleared with its table
    unassigns.push({ type: "unassign", guestId });
  }
  const groups = new Map<string, string[]>();
  for (const t of after.tables)
    for (const g of t.guestIds) {
      if (was.get(g) === t.id) continue;
      const list = groups.get(t.id) ?? [];
      list.push(g);
      groups.set(t.id, list);
    }
  for (const [tableId, guestIds] of groups) assigns.push({ type: "assign", tableId, guestIds });

  return [...creates, ...grows, ...unassigns, ...shrinks, ...assigns, ...removes];
}

/* --------------------------------------------------------------- capacity */

/**
 * How many more guests fit at a table if `incoming` sit there. Guests who
 * already sit at that table do not count twice. This is the same rule as the
 * Seating page and the `assign_seating_group` database function.
 */
export function seatsLeft(table: Pick<LayoutTable, "capacity" | "guestIds">, incoming: string[]): number {
  const wanted = new Set(incoming);
  const staying = table.guestIds.filter((id) => !wanted.has(id)).length;
  return table.capacity - staying - wanted.size;
}
