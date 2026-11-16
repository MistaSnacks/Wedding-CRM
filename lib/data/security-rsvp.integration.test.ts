import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "@/lib/testing/database";
let db: PGlite;
const w = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  h = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  g = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  e1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  e2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
async function status() {
  return (
    await db.query<{ rsvp_status: string }>(
      "select rsvp_status from households where id=$1",
      [h],
    )
  ).rows[0].rsvp_status;
}
async function submit(payload: unknown) {
  return db.query("select submit_rsvp($1,$2::jsonb) result", [
    h,
    JSON.stringify(payload),
  ]);
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(
    `insert into auth.users(id,email) values('${owner}','owner@example.invalid');insert into weddings(id,slug,couple_names) values('${w}','test-security','Test');insert into wedding_members values('${owner}','${w}','owner',now());insert into events(id,wedding_id,name) values('${e1}','${w}','Reception'),('${e2}','${w}','Rehearsal');insert into households(id,wedding_id,display_name,invite_code,access_token,max_party_size,plus_one_slots) values('${h}','${w}','Test party','TEST','secret-test',2,1);insert into guests(id,wedding_id,household_id,first_name,last_name) values('${g}','${w}','${h}','Test','Guest');insert into household_event_invites values('${h}','${e1}','${w}'),('${h}','${e2}','${w}');`,
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("actual migrated PostgreSQL security and RSVP transactions", () => {
  it("rejects self-reinvite demotion and keeps the owner", async () => {
    await expect(
      db.query("select manage_wedding_member($1,$2,$3,$2,false)", [
        w,
        owner,
        "editor",
      ]),
    ).rejects.toThrow("at least one owner");
    expect(
      (
        await db.query("select role from wedding_members where wedding_id=$1", [
          w,
        ])
      ).rows,
    ).toEqual([{ role: "owner" }]);
  });
  it("creates expected placeholders and rejects incomplete final atomically", async () => {
    expect(
      (
        await db.query(
          "select * from guest_event_responses where guest_id=$1",
          [g],
        )
      ).rows,
    ).toHaveLength(2);
    await expect(
      submit({
        via: "guest",
        complete: true,
        responses: [{ guest_id: g, event_id: e1, attending: "yes" }],
      }),
    ).rejects.toThrow("incomplete_rsvp");
    expect(await status()).toBe("pending");
  });
  it("supports different answers and preserves completion after an admin correction", async () => {
    await submit({
      via: "guest",
      complete: true,
      responses: [
        { guest_id: g, event_id: e1, attending: "yes" },
        { guest_id: g, event_id: e2, attending: "no" },
      ],
    });
    expect(await status()).toBe("completed");
    await submit({
      via: "admin",
      complete: false,
      responses: [{ guest_id: g, event_id: e2, attending: "yes" }],
    });
    expect(await status()).toBe("completed");
  });
  it("stable plus-one IDs survive replay and rename; explicit removal frees slot", async () => {
    const client = "99999999-9999-4999-8999-999999999999";
    const p = {
      client_id: client,
      first_name: "Plus",
      last_name: "One",
      responses: [
        { event_id: e1, attending: "yes" },
        { event_id: e2, attending: "no" },
      ],
    };
    await submit({
      via: "guest",
      complete: false,
      responses: [],
      new_plus_ones: [p],
    });
    await submit({
      via: "guest",
      complete: false,
      responses: [],
      new_plus_ones: [{ ...p, first_name: "Renamed" }],
    });
    const rows = (
      await db.query<{ id: string; first_name: string }>(
        "select id,first_name from guests where household_id=$1 and origin=$2",
        [h, "plus_one"],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].first_name).toBe("Renamed");
    await expect(
      submit({
        via: "guest",
        complete: false,
        responses: [],
        new_plus_ones: [
          { ...p, client_id: "88888888-8888-4888-8888-888888888888" },
        ],
      }),
    ).rejects.toThrow("no_plus_one_slot");
    await submit({
      via: "guest",
      complete: false,
      responses: [],
      remove_plus_one_ids: [rows[0].id],
    });
    expect(
      (await db.query("select id from guests where household_id=$1", [h])).rows,
    ).toHaveLength(1);
  });
  it("disabled requirements stop blocking and no longer accept guest edits", async () => {
    await submit({
      via: "admin",
      responses: [{ guest_id: g, event_id: e2, attending: "pending" }],
      complete: false,
    });
    expect(await status()).toBe("started");
    await db.query("update events set rsvp_enabled=false where id=$1", [e2]);
    expect(await status()).toBe("completed");
    await submit({
      via: "guest",
      responses: [{ guest_id: g, event_id: e2, attending: "yes" }],
      complete: true,
    });
    expect(
      (
        await db.query(
          "select attending from guest_event_responses where guest_id=$1 and event_id=$2",
          [g, e2],
        )
      ).rows[0],
    ).toEqual({ attending: "pending" });
  });
  it("rejects an incompatible event meal", async () => {
    const meal = "77777777-7777-4777-8777-777777777777";
    await db.query(
      "insert into meal_options(id,wedding_id,event_id,name) values($1,$2,$3,$4)",
      [meal, w, e2, "Rehearsal meal"],
    );
    await expect(
      submit({
        via: "guest",
        complete: false,
        responses: [
          { guest_id: g, event_id: e1, attending: "yes", meal_option_id: meal },
        ],
      }),
    ).rejects.toThrow("invalid_meal");
  });
  it("guest creation is atomic/idempotent and reopens the required status", async () => {
    const op = "66666666-6666-4666-8666-666666666666";
    const input = { householdId: h, firstName: "Another", lastName: "Guest" };
    await db.query("select create_guest_atomic($1,$2,$3,$4)", [
      w,
      JSON.stringify(input),
      owner,
      op,
    ]);
    await db.query("select create_guest_atomic($1,$2,$3,$4)", [
      w,
      JSON.stringify(input),
      owner,
      op,
    ]);
    expect(
      (await db.query("select id from guests where household_id=$1", [h])).rows,
    ).toHaveLength(2);
    expect(await status()).toBe("started");
  });
  it("commits confirmation outbox with the response and deduplicates an unchanged retry", async () => {
    const gs = (
      await db.query<{ id: string }>(
        "select id from guests where household_id=$1",
        [h],
      )
    ).rows;
    const payload = {
      via: "guest",
      complete: true,
      responses: gs.map((g) => ({
        guest_id: g.id,
        event_id: e1,
        attending: "yes",
      })),
      confirmation: {
        recipient: "guest@example.invalid",
        subject: "Received",
        html: "<p>Received</p>",
      },
    };
    const result = await submit(payload);
    await submit(payload);
    expect(
      (await db.query("select id from email_outbox where household_id=$1", [h]))
        .rows,
    ).toHaveLength(1);
    const returned = (result.rows[0] as { result: { guests: unknown[] } })
      .result;
    expect(returned.guests).toHaveLength(2);
    expect(JSON.stringify(returned)).not.toContain("internal_notes");
  });
  it("creates households transactionally with response placeholders and replay protection", async () => {
    const op = "55555555-5555-4555-8555-555555555555";
    const input = {
      displayName: "Created household",
      guests: [{ firstName: "New", lastName: "Guest" }],
    };
    const result = await db.query<{ id: string }>(
      "select create_household_atomic($1,$2,$3,$4) id",
      [w, JSON.stringify(input), owner, op],
    );
    const hid = result.rows[0].id;
    expect(
      (
        await db.query<{ id: string }>(
          "select create_household_atomic($1,$2,$3,$4) id",
          [w, JSON.stringify(input), owner, op],
        )
      ).rows[0].id,
    ).toBe(hid);
    expect(
      (
        await db.query(
          "select r.* from guest_event_responses r join guests g on r.guest_id=g.id where g.household_id=$1",
          [hid],
        )
      ).rows,
    ).toHaveLength(2);
    const bad = {
      displayName: "Rollback household",
      guests: [
        { firstName: "Good", lastName: "One" },
        { firstName: "", lastName: "Bad" },
      ],
    };
    await expect(
      db.query("select create_household_atomic($1,$2,$3,$4)", [
        w,
        JSON.stringify(bad),
        owner,
        "44444444-4444-4444-8444-444444444444",
      ]),
    ).rejects.toThrow("first name");
    expect(
      (
        await db.query(
          "select id from households where display_name='Rollback household'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("moves guests without losing responses and permits an idempotent split retry", async () => {
    const prior = (
      await db.query(
        "select event_id,attending from guest_event_responses where guest_id=$1 order by event_id",
        [g],
      )
    ).rows;
    const op = "33333333-3333-4333-8333-333333333333";
    const args = [w, h, null, [g], "Split household", owner, op];
    const result = (
      await db.query<{ id: string }>(
        "select transfer_household_guests($1,$2,$3,$4,$5,$6,$7) id",
        args,
      )
    ).rows[0].id;
    expect(
      (
        await db.query(
          "select event_id,attending from guest_event_responses where guest_id=$1 order by event_id",
          [g],
        )
      ).rows,
    ).toEqual(prior);
    expect(
      (
        await db.query<{ id: string }>(
          "select transfer_household_guests($1,$2,$3,$4,$5,$6,$7) id",
          args,
        )
      ).rows[0].id,
    ).toBe(result);
    expect(
      (
        await db.query<{ household_id: string }>(
          "select household_id from guests where id=$1",
          [g],
        )
      ).rows[0].household_id,
    ).toBe(result);
  });
  it("refuses guest writes to an archived invitation", async () => {
    await db.query("update households set archived_at=now() where id=$1", [h]);
    await expect(
      submit({ via: "guest", responses: [], complete: false }),
    ).rejects.toThrow("not_found");
    await db.query("update households set archived_at=null where id=$1", [h]);
  });
  it("SQL functions are not callable by anon/authenticated", async () => {
    const rows = (
      await db.query<{ allowed: boolean }>(
        "select has_function_privilege('anon','submit_rsvp(uuid,jsonb)','execute') allowed union all select has_function_privilege('authenticated','manage_wedding_member(uuid,uuid,text,uuid,boolean)','execute') allowed",
      )
    ).rows;
    expect(rows.every((r) => !r.allowed)).toBe(true);
  });
});
