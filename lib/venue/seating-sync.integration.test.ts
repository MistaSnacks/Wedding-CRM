import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createTestDatabase } from "@/lib/testing/database";
import { diffDrafts, type SeatingOp } from "./seating-sync";
import type { LayoutTable } from "./model";

/*
 * Replays the 3D editor's operations against the real schema, triggers and
 * `assign_seating_group` in an in-memory database (no remote connection).
 * Each op maps to the same SQL the seating actions run in lib/data/seating.ts.
 */
let db: Awaited<ReturnType<typeof createTestDatabase>>;
const wedding = "11111111-1111-1111-1111-111111111111",
  event = "22222222-2222-2222-2222-222222222202";
const g1 = "55555555-5555-5555-5555-555555555501",
  g2 = "55555555-5555-5555-5555-555555555502",
  g3 = "55555555-5555-5555-5555-555555555503";

beforeAll(async () => {
  db = await createTestDatabase();
}, 30000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await db.query("update guest_event_responses set attending='yes' where event_id=$1", [event]);
});
afterEach(async () => {
  await db.exec("rollback");
});

async function run(ops: SeatingOp[], alias: Map<string, string>) {
  const id = (t: string) => alias.get(t) ?? t;
  for (const op of ops) {
    if (op.type === "create") {
      const { rows } = await db.query<{ id: string }>(
        "insert into seating_tables(wedding_id,event_id,name,capacity,shape,pos_x,pos_y,rotation) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
        [wedding, event, op.name, op.capacity, op.shape, op.posX, op.posY, op.rotation],
      );
      alias.set(op.tableId, rows[0].id);
    } else if (op.type === "edit")
      await db.query("update seating_tables set name=$1,capacity=$2,shape=$3 where id=$4 and wedding_id=$5", [op.name, op.capacity, op.shape, id(op.tableId), wedding]);
    else if (op.type === "move")
      await db.query("update seating_tables set pos_x=$1,pos_y=$2 where id=$3 and wedding_id=$4", [op.posX, op.posY, id(op.tableId), wedding]);
    else if (op.type === "turn")
      await db.query("update seating_tables set rotation=$1 where id=$2 and wedding_id=$3", [op.rotation, id(op.tableId), wedding]);
    else if (op.type === "unassign")
      await db.query("delete from seat_assignments where guest_id=$1 and event_id=$2 and wedding_id=$3", [op.guestId, event, wedding]);
    else if (op.type === "assign")
      await db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [wedding, event, id(op.tableId), op.guestIds]);
    else await db.query("delete from seating_tables where id=$1 and wedding_id=$2", [id(op.tableId), wedding]);
  }
}

async function saved(alias: Map<string, string>) {
  const back = new Map([...alias].map(([k, v]) => [v, k]));
  const { rows } = await db.query<{ id: string; name: string; capacity: number; shape: string; pos_x: number; pos_y: number; rotation: number; guests: string[] | null }>(
    `select t.id,t.name,t.capacity,t.shape,t.pos_x,t.pos_y,t.rotation,
       (select array_agg(guest_id::text order by guest_id) from seat_assignments s where s.table_id=t.id) guests
     from seating_tables t where t.wedding_id=$1 and t.event_id=$2 order by t.name`,
    [wedding, event],
  );
  return rows.map((r) => ({ ...r, id: back.get(r.id) ?? r.id, guests: r.guests ?? [] }));
}

const T = (over: Partial<LayoutTable>): LayoutTable => ({
  id: "x", name: "T", x: 6, z: 4, rotation: 0, width: 1.8, depth: 1.8, shape: "round", capacity: 2, guestIds: [], ...over,
});
const plan = (...tables: LayoutTable[]) => ({ tables, guests: [] });

it("has the rotation column from migration 0020, default 0", async () => {
  const { rows } = await db.query<{ data_type: string; column_default: string; is_nullable: string }>(
    "select data_type,column_default,is_nullable from information_schema.columns where table_name='seating_tables' and column_name='rotation'",
  );
  expect(rows[0]).toMatchObject({ data_type: "real", is_nullable: "NO" });
  expect(rows[0].column_default).toMatch(/0/);
});

it("saves a full editing session and every undo, with the real capacity triggers", async () => {
  const alias = new Map<string, string>();
  const empty = plan();
  const steps = [
    empty,
    plan(T({ id: "table-1", name: "A" })),
    plan(T({ id: "table-1", name: "A" }), T({ id: "table-2", name: "B", x: -6, shape: "rect", kind: "head" })),
    // seat a household of two at A (full)
    plan(T({ id: "table-1", name: "A", guestIds: [g1, g2] }), T({ id: "table-2", name: "B", x: -6, shape: "rect", kind: "head" })),
    // swap one guest out, lower nothing: B grows to 3 and takes g2 and g3
    plan(T({ id: "table-1", name: "A", guestIds: [g1] }), T({ id: "table-2", name: "B", x: -6, shape: "rect", kind: "head", capacity: 3, guestIds: [g2, g3] })),
    // A shrinks to 1 seat, turns and moves
    plan(T({ id: "table-1", name: "A", capacity: 1, rotation: 90, x: 2, guestIds: [g1] }), T({ id: "table-2", name: "B", x: -6, shape: "rect", kind: "head", capacity: 3, guestIds: [g2, g3] })),
    // remove B with its guests
    plan(T({ id: "table-1", name: "A", capacity: 1, rotation: 90, x: 2, guestIds: [g1] })),
  ];
  const snapshots = [await saved(alias)];
  for (let i = 1; i < steps.length; i++) {
    await run(diffDrafts(steps[i - 1], steps[i]), alias);
    snapshots.push(await saved(alias));
  }
  expect(snapshots[3].find((t) => t.name === "A")?.guests).toEqual([g1, g2].sort());
  expect(snapshots[2].find((t) => t.name === "B")).toMatchObject({ shape: "banquet" });
  expect(snapshots[5].find((t) => t.name === "A")).toMatchObject({ capacity: 1, rotation: 90 });
  // Undo everything, one step at a time: each undo is the diff run backwards.
  for (let i = steps.length - 1; i > 0; i--) {
    await run(diffDrafts(steps[i], steps[i - 1]), alias);
    const now = await saved(alias);
    const strip = (rows: Awaited<ReturnType<typeof saved>>) => rows.map(({ id: _id, ...r }) => r);
    expect(strip(now)).toEqual(strip(snapshots[i - 1]));
  }
});

it("refuses a seat over capacity, as the Seating page does", async () => {
  const alias = new Map<string, string>();
  await run(diffDrafts(plan(), plan(T({ id: "table-1", name: "A", capacity: 1 }))), alias);
  await db.exec("savepoint seat_try");
  await expect(run(diffDrafts(plan(T({ id: "table-1", name: "A", capacity: 1 })), plan(T({ id: "table-1", name: "A", capacity: 1, guestIds: [g1, g2] }))), alias)).rejects.toThrow(/fit/);
  await db.exec("rollback to seat_try");
});
