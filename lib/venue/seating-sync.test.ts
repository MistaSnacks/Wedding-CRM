import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANVAS,
  canvasToMetres,
  dbShapeOf,
  dbShapeToKind,
  diffDrafts,
  kindOf,
  kindToDbShape,
  metresToCanvas,
  seatsLeft,
  type SeatingOp,
} from "./seating-sync";
import { assignDemo, clampPosition, setCapacity, type LayoutTable } from "./model";
import { draftFromVenue } from "./live-edit";
import { fromSeating } from "./live-data";

const T = (over: Partial<LayoutTable> = {}): LayoutTable => ({
  id: "a",
  name: "Table 1",
  x: 6,
  z: 4,
  rotation: 0,
  width: 1.8,
  depth: 1.8,
  shape: "round",
  capacity: 8,
  guestIds: [],
  ...over,
});
const plan = (...tables: LayoutTable[]) => ({ tables, guests: [] });

describe("canvas <-> metres", () => {
  it("matches the box sizes in SeatingCanvas.tsx", () => {
    const src = readFileSync(join(__dirname, "../../components/admin/SeatingCanvas.tsx"), "utf8");
    expect(src).toContain(`RECT_DIMS = { w: ${CANVAS.RECT.w}, h: ${CANVAS.RECT.h} }`);
    expect(src).toContain(`ROUND_DIMS = { w: ${CANVAS.ROUND.w}, h: ${CANVAS.ROUND.h} }`);
    expect(src).toContain("h-[640px]");
  });

  it("puts the room centre at the canvas origin", () => {
    expect(canvasToMetres(420 - 68, 320 - 68, "round")).toEqual({ x: 0, z: 0 });
    expect(canvasToMetres(420 - 140, 320 - 48, "rect")).toEqual({ x: 0, z: 0 });
    expect(metresToCanvas(0, 0, "banquet")).toEqual({ posX: 280, posY: 272 });
  });

  it("is 20 px per metre, with x to the right and z down the canvas", () => {
    const a = canvasToMetres(100, 100, "round");
    const b = canvasToMetres(120, 140, "round");
    expect(b.x - a.x).toBeCloseTo(1);
    expect(b.z - a.z).toBeCloseTo(2);
  });

  it.each(["round", "rect", "banquet"] as const)("round-trips every 3D spot exactly (%s)", (shape) => {
    for (let x = -12; x <= 12; x += 0.25)
      for (const z of [-12, -3.75, 0, 0.25, 7.5, 12]) {
        const { posX, posY } = metresToCanvas(x, z, shape);
        const back = canvasToMetres(posX, posY, shape);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.z).toBeCloseTo(z, 9);
      }
  });

  it("keeps a canvas position inside the room within one 3D snap step", () => {
    for (const shape of ["round", "rect"] as const)
      for (let px = 112; px <= 480; px += 16) {
        const m = canvasToMetres(px, 160, shape);
        const t = T({ shape, width: shape === "round" ? 1.8 : 3, depth: shape === "round" ? 1.8 : 1 });
        const snapped = clampPosition(t, m.x, m.z);
        const again = metresToCanvas(snapped.x, snapped.z, shape);
        expect(Math.abs(again.posX - px)).toBeLessThanOrEqual(3);
      }
  });

  it("keeps every allowed 3D spot on the canvas (no negative pixels, inside 640 px high)", () => {
    for (const shape of ["round", "rect"] as const) {
      const t = T({ shape, width: shape === "round" ? 2.4 : 5, depth: shape === "round" ? 2.4 : 1 });
      for (const rotation of [0, 90]) {
        const r = { ...t, rotation };
        for (const [x, z] of [[-99, -99], [99, 99]]) {
          const c = clampPosition(r, x, z);
          const { posX, posY } = metresToCanvas(c.x, c.z, shape);
          const box = shape === "round" ? CANVAS.ROUND : CANVAS.RECT;
          expect(posX).toBeGreaterThanOrEqual(0);
          expect(posY).toBeGreaterThanOrEqual(0);
          expect(posY + box.h).toBeLessThanOrEqual(640);
        }
      }
    }
  });

  it("loads saved tables at the converted spot and keeps rotation, defaulting to 0", () => {
    const rows = [
      { id: "t1", event_id: "e", name: "A", capacity: 8, shape: "round" as const, pos_x: 352, pos_y: 252 },
      { id: "t2", event_id: "e", name: "B", capacity: 10, shape: "banquet" as const, pos_x: 480, pos_y: 400, rotation: 90 },
    ];
    const v = fromSeating(rows, new Map(), "Reception", [], "e");
    expect(v.tables[0]).toMatchObject({ x: 0, z: 0, rotation: 0, kind: "round" });
    expect(v.tables[1]).toMatchObject({ x: 10, z: 6.4, rotation: 90, kind: "head" });
    expect(v.eventId).toBe("e");
  });
});

describe("shape mapping", () => {
  it("maps the editor kinds onto the database enum and back", () => {
    expect(kindToDbShape("round")).toBe("round");
    expect(kindToDbShape("long")).toBe("rect");
    expect(kindToDbShape("head")).toBe("banquet");
    for (const s of ["round", "rect", "banquet"] as const) expect(kindToDbShape(dbShapeToKind(s))).toBe(s);
  });

  it("trusts the drawn shape over a stale kind", () => {
    expect(kindOf({ shape: "round", kind: "head" })).toBe("round");
    expect(kindOf({ shape: "rect" })).toBe("long");
    expect(dbShapeOf({ shape: "rect", kind: "head" })).toBe("banquet");
  });
});

describe("diffDrafts", () => {
  it("sends nothing when nothing changed", () => {
    expect(diffDrafts(plan(T()), plan(T()))).toEqual([]);
  });

  it("creates a new table with its shape and spot", () => {
    const added = T({ id: "table-9", name: "Head table", shape: "rect", kind: "head", width: 3.2, depth: 1, x: 0, z: 0 });
    expect(diffDrafts(plan(T()), plan(T(), added))).toEqual([
      { type: "create", tableId: "table-9", name: "Head table", capacity: 8, shape: "banquet", posX: 280, posY: 272, rotation: 0 },
    ]);
  });

  it("saves a move, a turn, a rename and a shape change", () => {
    const ops = diffDrafts(plan(T()), plan(T({ x: 7, rotation: 45, name: "Family", shape: "rect", kind: "long" })));
    expect(ops).toContainEqual({ type: "edit", tableId: "a", name: "Family", capacity: 8, shape: "rect" });
    expect(ops).toContainEqual({ type: "turn", tableId: "a", rotation: 45 });
    expect(ops).toContainEqual({ type: "move", tableId: "a", ...metresToCanvas(7, 4, "rect") });
  });

  it("seats a household in one call and frees a seat before it lowers capacity", () => {
    const before = plan(T({ guestIds: ["g1", "g2"] }), T({ id: "b", x: -6 }));
    const after = plan(T({ guestIds: ["g1"], capacity: 7 }), T({ id: "b", x: -6, guestIds: ["h1", "h2"] }));
    const types = diffDrafts(before, after).map((o) => o.type);
    expect(types).toEqual(["unassign", "edit", "assign"]);
    expect(diffDrafts(before, after)).toContainEqual({ type: "assign", tableId: "b", guestIds: ["h1", "h2"] });
  });

  it("raises capacity before it seats more guests", () => {
    const before = plan(T({ capacity: 2, guestIds: ["g1", "g2"] }));
    const after = plan(T({ capacity: 3, guestIds: ["g1", "g2", "g3"] }));
    expect(diffDrafts(before, after).map((o) => o.type)).toEqual(["edit", "assign"]);
  });

  it("moves a guest between tables without a separate unassign", () => {
    const before = plan(T({ guestIds: ["g1"] }), T({ id: "b", x: -6 }));
    const after = plan(T(), T({ id: "b", x: -6, guestIds: ["g1"] }));
    expect(diffDrafts(before, after)).toEqual([{ type: "assign", tableId: "b", guestIds: ["g1"] }]);
  });

  it("removes a table last and lets the database clear its seats", () => {
    const before = plan(T({ guestIds: ["g1", "g2"] }), T({ id: "b", x: -6 }));
    const after = plan(T({ id: "b", x: -6, guestIds: ["g2"] }));
    expect(diffDrafts(before, after)).toEqual([
      { type: "assign", tableId: "b", guestIds: ["g2"] },
      { type: "remove", tableId: "a" },
    ]);
  });
});

describe("undo sends the inverse change", () => {
  const cases: [string, ReturnType<typeof plan>, ReturnType<typeof plan>][] = [
    ["add table", plan(T()), plan(T(), T({ id: "table-2", x: -6 }))],
    ["remove table with guests", plan(T({ guestIds: ["g1", "g2"] }), T({ id: "b", x: -6 })), plan(T({ id: "b", x: -6 }))],
    ["move", plan(T()), plan(T({ x: -2 }))],
    ["turn", plan(T()), plan(T({ rotation: 90 }))],
    ["rename + capacity", plan(T()), plan(T({ name: "Family", capacity: 10 }))],
    ["shape", plan(T()), plan(T({ shape: "rect", kind: "head" }))],
    ["seat household", plan(T(), T({ id: "b", x: -6 })), plan(T({ guestIds: ["g1", "g2"] }), T({ id: "b", x: -6 }))],
    ["unseat", plan(T({ guestIds: ["g1"] })), plan(T())],
    ["move guest", plan(T({ guestIds: ["g1"] }), T({ id: "b", x: -6 })), plan(T(), T({ id: "b", x: -6, guestIds: ["g1"] }))],
  ];

  /** Apply ops to a tiny model of the saved chart and read it back as a plan. */
  function apply(start: ReturnType<typeof plan>, ops: SeatingOp[]) {
    const tables = new Map(start.tables.map((t) => [t.id, { ...t, guestIds: [...t.guestIds] }]));
    for (const op of ops) {
      if (op.type === "create") {
        const m = canvasToMetres(op.posX, op.posY, op.shape);
        tables.set(op.tableId, T({ id: op.tableId, name: op.name, capacity: op.capacity, rotation: op.rotation, ...m, shape: op.shape === "round" ? "round" : "rect", kind: dbShapeToKind(op.shape) }));
      } else if (op.type === "edit") {
        const t = tables.get(op.tableId)!;
        if ([...tables.values()].length && t.guestIds.length > op.capacity) throw new Error("capacity below seated");
        Object.assign(t, { name: op.name, capacity: op.capacity, shape: op.shape === "round" ? "round" : "rect", kind: dbShapeToKind(op.shape) });
      } else if (op.type === "move") Object.assign(tables.get(op.tableId)!, canvasToMetres(op.posX, op.posY, dbShapeOf(tables.get(op.tableId)!)));
      else if (op.type === "turn") tables.get(op.tableId)!.rotation = op.rotation;
      else if (op.type === "remove") tables.delete(op.tableId);
      else if (op.type === "unassign") for (const t of tables.values()) t.guestIds = t.guestIds.filter((g) => g !== op.guestId);
      else {
        for (const t of tables.values()) t.guestIds = t.guestIds.filter((g) => !op.guestIds.includes(g));
        const t = tables.get(op.tableId)!;
        if (t.guestIds.length + op.guestIds.length > t.capacity) throw new Error("full");
        t.guestIds.push(...op.guestIds);
      }
    }
    return [...tables.values()];
  }
  const summary = (ts: LayoutTable[]) =>
    ts
      .map((t) => ({ id: t.id, name: t.name, cap: t.capacity, db: dbShapeOf(t), rot: t.rotation, pos: metresToCanvas(t.x, t.z, dbShapeOf(t)), g: [...t.guestIds].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id));

  it.each(cases)("%s: do then undo returns the saved chart to the start", (_name, before, after) => {
    const done = apply(before, diffDrafts(before, after));
    expect(summary(done)).toEqual(summary(after.tables));
    const undone = apply({ tables: done, guests: [] }, diffDrafts(after, before));
    expect(summary(undone)).toEqual(summary(before.tables));
  });
});

describe("capacity rules", () => {
  it("counts guests already at the table once", () => {
    expect(seatsLeft({ capacity: 4, guestIds: ["a", "b"] }, ["b", "c"])).toBe(1);
    expect(seatsLeft({ capacity: 2, guestIds: ["a", "b"] }, ["c"])).toBe(-1);
  });

  it("refuses a household that does not fit, as the Seating page does", () => {
    const tables = [T({ capacity: 2, guestIds: ["a"] })];
    const guests = ["a", "b", "c"].map((id) => ({ id, name: id, household: "H" }));
    expect(() => assignDemo(tables, "a", ["b", "c"], guests)).toThrow(/only has 1 free seat/);
    expect(assignDemo(tables, "a", ["b"], guests)[0].guestIds).toEqual(["a", "b"]);
  });

  it("does not shrink a real table that is bigger than 16 seats", () => {
    const big = T({ capacity: 20 });
    expect(setCapacity(big, 19).capacity).toBe(19);
    expect(setCapacity(T(), 40).capacity).toBe(16);
  });

  it("keeps real names and capacities whole when it builds the draft", () => {
    const name = "The very long table name for the bride's oldest friends from university days";
    const draft = draftFromVenue({
      source: "live",
      eventName: "Reception",
      eventId: "e",
      guests: [],
      tables: [{ id: "t", name, x: 0, z: 0, rotation: 0, shape: "rect", kind: "head", width: 3, depth: 1, capacity: 24, guests: [] }],
    });
    expect(draft.tables[0]).toMatchObject({ name, capacity: 24, kind: "head" });
  });
});
