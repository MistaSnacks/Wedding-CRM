import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/lib/testing/database";

/*
 * Regression for migration 0025. A guest insert now creates the household's
 * 'pending' responses by trigger (0015), so the importer must not insert the
 * same rows again. Earlier import tests used a wedding with no events, which
 * is the one shape where the bug cannot show.
 */
let db: Awaited<ReturnType<typeof createTestDatabase>>;
const w = "10000000-0000-0000-0000-000000000001";
const a = "10000000-0000-0000-0000-000000000002";
const h = "10000000-0000-0000-0000-000000000003";
const e = "10000000-0000-0000-0000-000000000004";

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("truncate weddings,auth.users cascade");
  await db.query("insert into auth.users(id,email) values($1,$2)", [a, "admin@example.com"]);
  await db.query("insert into weddings(id,slug,couple_names,timezone) values($1,'test','Test Couple','UTC')", [w]);
  await db.query("insert into events(id,wedding_id,name,visibility) values($1,$2,'Reception','all')", [e, w]);
  await db.query(
    "insert into households(id,wedding_id,display_name,email,invite_code,access_token,max_party_size,plus_one_slots) values($1,$2,'Test Family','family@example.com','TEST-1234','token',4,0)",
    [h, w],
  );
  await db.query("insert into household_event_invites(household_id,event_id,wedding_id) values($1,$2,$3)", [h, e, w]);
});

async function scalar(sql: string, params: unknown[] = []) {
  const r = await db.query<Record<string, unknown>>(sql, params);
  return Object.values(r.rows[0])[0];
}

async function reviewed(guests: Array<Record<string, unknown>>, matched = false) {
  const input = {
    displayName: "Imported Family",
    email: "new@example.com",
    maxPartySize: 2,
    plusOneSlots: 0,
    inviteCode: "IMPORT-1",
    accessToken: "import-token",
    guests,
  };
  const candidate = {
    id: h,
    name: "Test Family",
    expected: { email: "family@example.com", phone: null, mailing_address: null, preferred_locale: "en", internal_notes: null, max_party_size: 4, plus_one_slots: 0 },
    guestIds: [],
    conflicts: [],
  };
  return await scalar(
    "insert into imports(wedding_id,filename,status,actor_id,source_fingerprint,review_snapshot) values($1,'file.csv','validated',$2,'file',$3) returning id",
    [w, a, JSON.stringify({ households: [input], reconciliation: [{ index: 0, name: input.displayName, candidates: matched ? [candidate] : [] }] })],
  );
}

describe("CSV import into a wedding that has an event", () => {
  it("creates a new household whose guests are invited to the event", async () => {
    const run = await reviewed([
      { firstName: "Ana", lastName: "Alvarez", attendingByEventId: { [e]: "yes" } },
      { firstName: "Luis", lastName: "Alvarez" },
    ]);
    const stats = await scalar("select commit_reviewed_import($1,$2,$3,'file')", [w, run, a]);
    expect(stats).toMatchObject({ households: 1, guests: 2 });
    // One answer per guest per event: the trigger's row and the importer's row are the same row.
    expect(await scalar("select count(*) from guest_event_responses where event_id=$1", [e])).toBe(2);
    expect(
      await scalar(
        "select r.attending from guest_event_responses r join guests g on g.id=r.guest_id where g.first_name='Ana'",
      ),
    ).toBe("yes");
    expect(
      await scalar(
        "select r.attending from guest_event_responses r join guests g on g.id=r.guest_id where g.first_name='Luis'",
      ),
    ).toBe("pending");
  });

  it("appends a new guest to an existing invited household", async () => {
    const run = await reviewed([{ firstName: "New", lastName: "Person" }], true);
    const stats = await scalar("select commit_reviewed_import($1,$2,$3,'file',$4)", [
      w,
      run,
      a,
      JSON.stringify([{ index: 0, action: "append", householdId: h }]),
    ]);
    expect(stats).toMatchObject({ households: 0, guests: 1, updated: 1 });
    expect(await scalar("select count(*) from guest_event_responses where event_id=$1", [e])).toBe(1);
    expect(await scalar("select attending from guest_event_responses")).toBe("pending");
  });
});
