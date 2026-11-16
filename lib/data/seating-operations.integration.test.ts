import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import { createTestDatabase } from "@/lib/testing/database";
let db: Awaited<ReturnType<typeof createTestDatabase>>;
const wedding = "11111111-1111-1111-1111-111111111111",
  event = "22222222-2222-2222-2222-222222222202";
const g1 = "55555555-5555-5555-5555-555555555501",
  g2 = "55555555-5555-5555-5555-555555555502";
const table = "77777777-7777-4777-8777-777777777777";
beforeAll(async () => {
  db = await createTestDatabase();
}, 30000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await db.query(
    "update guest_event_responses set attending='yes' where event_id=$1",
    [event],
  );
  await db.query(
    "insert into seating_tables(id,wedding_id,event_id,name,capacity) values($1,$2,$3,'Test table',2)",
    [table, wedding, event],
  );
});
afterEach(async () => {
  await db.exec("rollback");
});
it("assigns a whole household atomically and rejects overcapacity", async () => {
  await db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [
    wedding,
    event,
    table,
    [g1, g2],
  ]);
  expect(
    (
      await db.query("select * from seat_assignments where table_id=$1", [
        table,
      ])
    ).rows,
  ).toHaveLength(2);
  await db.exec("savepoint attempt");
  await expect(
    db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [
      wedding,
      event,
      table,
      ["55555555-5555-5555-5555-555555555503"],
    ]),
  ).rejects.toThrow(/fit/);
  await db.exec("rollback to attempt");
  expect(
    (
      await db.query("select * from seat_assignments where table_id=$1", [
        table,
      ])
    ).rows,
  ).toHaveLength(2);
});
it("rolls back the earlier group assignment when a later guest is ineligible", async () => {
  await db.query(
    "update guest_event_responses set attending='no' where guest_id=$1 and event_id=$2",
    [g2, event],
  );
  await db.exec("savepoint attempt");
  await expect(
    db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [
      wedding,
      event,
      table,
      [g1, g2],
    ]),
  ).rejects.toThrow(/attending/);
  await db.exec("rollback to attempt");
  expect(
    (
      await db.query("select * from seat_assignments where table_id=$1", [
        table,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("does not reduce table capacity below existing seats", async () => {
  await db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [
    wedding,
    event,
    table,
    [g1, g2],
  ]);
  await db.exec("savepoint attempt");
  await expect(
    db.query("update seating_tables set capacity=1 where id=$1", [table]),
  ).rejects.toThrow(/Move guests/);
  await db.exec("rollback to attempt");
});
it("protects used menus against deletion", async () => {
  const meal = "33333333-3333-3333-3333-333333333301";
  await db.query(
    "update guest_event_responses set meal_option_id=$1 where guest_id=$2 and event_id=$3",
    [meal, g1, event],
  );
  await db.exec("savepoint attempt");
  await expect(
    db.query("select manage_meal_option($1,$2,'Chicken',null,false,true)", [
      wedding,
      meal,
    ]),
  ).rejects.toThrow(/already chose this dish/);
  await db.exec("rollback to attempt");
});
it("uses a shared rate bucket and expires it", async () => {
  const key = "a".repeat(64);
  for (let i = 0; i < 3; i++)
    expect(
      (
        await db.query<{ result: { ok: boolean } }>(
          "select consume_rate_limit($1,3,60) result",
          [key],
        )
      ).rows[0].result.ok,
    ).toBe(true);
  expect(
    (
      await db.query<{ result: { ok: boolean } }>(
        "select consume_rate_limit($1,3,60) result",
        [key],
      )
    ).rows[0].result.ok,
  ).toBe(false);
  await db.query(
    "update rate_limit_buckets set expires_at=now()-interval '1 second' where key=$1",
    [key],
  );
  expect(
    (
      await db.query<{ result: { ok: boolean } }>(
        "select consume_rate_limit($1,3,60) result",
        [key],
      )
    ).rows[0].result.ok,
  ).toBe(true);
});
it("does not expose operational write RPCs to guest or authenticated API roles", async () => {
  for (const fn of [
    "assign_seating_group(uuid,uuid,uuid,uuid[],uuid)",
    "consume_rate_limit(text,integer,integer)",
    "manage_meal_option(uuid,uuid,text,uuid,boolean,boolean)",
  ]) {
    const rows = (
      await db.query<{ anon: boolean; member: boolean }>(
        "select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') member",
        [fn],
      )
    ).rows;
    expect(rows[0]).toEqual({ anon: false, member: false });
  }
});
it("publishes only an eligible chart and reveals current live tablemates", async () => {
  await db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [
    wedding,
    event,
    table,
    [g1, g2],
  ]);
  await db.query("select publish_seating($1,$2,true)", [wedding, event]);
  expect(
    (
      await db.query<{ info: { tableName: string; mates: unknown[] } }>(
        "select guest_table_info($1,$2,$3) info",
        [wedding, g1, event],
      )
    ).rows[0].info.mates,
  ).toHaveLength(1);
  await db.query(
    "update guest_event_responses set attending='no' where guest_id=$1 and event_id=$2",
    [g2, event],
  );
  expect(
    (
      await db.query<{ info: { mates: unknown[] } }>(
        "select guest_table_info($1,$2,$3) info",
        [wedding, g1, event],
      )
    ).rows[0].info.mates,
  ).toHaveLength(0);
  await db.exec("savepoint publish_attempt");
  await expect(
    db.query("select publish_seating($1,$2,true)", [wedding, event]),
  ).rejects.toThrow(/declined/);
  await db.exec("rollback to publish_attempt");
  await db.query("select publish_seating($1,$2,false)", [wedding, event]);
  expect(
    (
      await db.query<{ info: unknown }>(
        "select guest_table_info($1,$2,$3) info",
        [wedding, g1, event],
      )
    ).rows[0].info,
  ).toBeNull();
});
it("rejects publishing historical overcapacity even if it predates the write guard", async () => {
  await db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [
    wedding,
    event,
    table,
    [g1, g2],
  ]);
  await db.exec(
    "alter table seating_tables disable trigger enforce_seating_table",
  );
  await db.query("update seating_tables set capacity=1 where id=$1", [table]);
  await db.exec(
    "alter table seating_tables enable trigger enforce_seating_table;savepoint publish_attempt",
  );
  await expect(
    db.query("select publish_seating($1,$2,true)", [wedding, event]),
  ).rejects.toThrow(/over capacity/);
  await db.exec("rollback to publish_attempt");
});

it("does not reveal an assignment outside the requested wedding", async () => {
  await db.query("select assign_seating_group($1,$2,$3,$4::uuid[])", [
    wedding,
    event,
    table,
    [g1],
  ]);
  await db.query("select publish_seating($1,$2,true)", [wedding, event]);
  const foreign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expect(
    (
      await db.query<{ info: unknown }>(
        "select guest_table_info($1,$2,$3) info",
        [foreign, g1, event],
      )
    ).rows[0].info,
  ).toBeNull();
  await db.exec("savepoint foreign_publish");
  await expect(
    db.query("select publish_seating($1,$2,true)", [foreign, event]),
  ).rejects.toThrow("Event not found");
  await db.exec("rollback to foreign_publish");
});
