import { beforeEach, describe, expect, it } from "vitest";
import type { WeddingScope } from "./scope";
import { PartialSaveError, saveWeddingDetails } from "./wedding-details";

/**
 * The save touches two tables in an order that matters, so the fake keeps a
 * log of every write and can be told to fail the write to `weddings`. A filter
 * the module forgets is a filter this fake does not apply either.
 */

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

const OURS = "wedding-ours";
const THEIRS = "wedding-theirs";
const LA = "America/Los_Angeles";

function fakeDb(store: Store, writes: string[], failWeddingWrite: { on: boolean }) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" | "insert" = "select";
      let payload: Row = {};
      let single = false;
      const query = {
        select: () => query,
        update: (p: Row) => ((op = "update"), (payload = p), query),
        insert: (p: Row) => ((op = "insert"), (payload = p), query),
        eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), query),
        single: () => ((single = true), query),
        then(resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) {
          const rows = (store[table] ??= []);
          if (op === "insert") {
            rows.push(payload);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          const matching = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "update") {
            if (table === "weddings" && failWeddingWrite.on) {
              return Promise.resolve({ data: null, error: { message: "connection reset" } }).then(resolve);
            }
            for (const r of matching) {
              Object.assign(r, payload);
              writes.push(`${table}:${String(r.id)}`);
            }
            return Promise.resolve({ data: matching, error: null }).then(resolve);
          }
          if (single) {
            return Promise.resolve(
              matching.length === 1
                ? { data: matching[0], error: null }
                : { data: null, error: { message: "no rows" } },
            ).then(resolve);
          }
          // Copies, as over the wire: a later write must not change what was read.
          return Promise.resolve({ data: matching.map((r) => ({ ...r })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

let store: Store;
let writes: string[];
let fail: { on: boolean };
let scope: WeddingScope;
const now = new Date("2026-11-16T20:00:00Z");

beforeEach(() => {
  store = {
    weddings: [
      {
        id: OURS,
        wedding_date: "2027-09-18",
        rsvp_deadline: "2027-07-02T06:59:00.000Z",
        timezone: LA,
        theme: { video: "/video/hero-v5.mp4", poster: "/video/hero-v5-poster.jpg" },
      },
      { id: THEIRS, wedding_date: "2027-09-18", rsvp_deadline: null, timezone: LA, theme: {} },
    ],
    events: [
      // 19:00 on the 17th in Los Angeles: the day before, so it stays.
      { id: "welcome", wedding_id: OURS, name: "Welcome Party", starts_at: "2027-09-18T02:00:00.000Z", ends_at: null },
      // 16:00 and 16:30 on the 18th, the reception running past midnight.
      { id: "ceremony", wedding_id: OURS, name: "Ceremony", starts_at: "2027-09-18T23:00:00.000Z", ends_at: null },
      { id: "reception", wedding_id: OURS, name: "Reception", starts_at: "2027-09-18T23:30:00.000Z", ends_at: "2027-09-19T07:00:00.000Z" },
      { id: "theirs", wedding_id: THEIRS, name: "Their Ceremony", starts_at: "2027-09-18T23:00:00.000Z", ends_at: null },
    ],
    activity_log: [],
  };
  writes = [];
  fail = { on: false };
  scope = { weddingId: OURS, db: fakeDb(store, writes, fail) as unknown as WeddingScope["db"] };
});

const event = (id: string) => store.events.find((e) => e.id === id)!;
const wedding = (id = OURS) => store.weddings.find((w) => w.id === id)!;
const input = { weddingDay: "2027-10-02", replyBy: "2027-07-01", locationLine: "Guadalajara, México", confirmPastDay: false };

describe("saveWeddingDetails", () => {
  it("moves the events on the old day to the new day at the same time, then the wedding", async () => {
    const result = await saveWeddingDetails(scope, input, { now, expectedMoves: ["ceremony", "reception"] });

    expect(result).toEqual({ ok: true, moved: ["Ceremony", "Reception"] });
    expect(event("ceremony").starts_at).toBe("2027-10-02T23:00:00.000Z");
    expect(event("reception")).toMatchObject({ starts_at: "2027-10-02T23:30:00.000Z", ends_at: "2027-10-03T07:00:00.000Z" });
    expect(event("welcome").starts_at).toBe("2027-09-18T02:00:00.000Z");
    expect(writes).toEqual(["events:ceremony", "events:reception", `weddings:${OURS}`]);
  });

  it("never touches another wedding", async () => {
    await saveWeddingDetails(scope, input, { now });
    expect(event("theirs").starts_at).toBe("2027-09-18T23:00:00.000Z");
    expect(wedding(THEIRS).wedding_date).toBe("2027-09-18");
  });

  it("keeps the other theme keys when the city changes", async () => {
    await saveWeddingDetails(scope, { ...input, weddingDay: "2027-09-18", locationLine: "Zapopan, México" }, { now });
    expect(wedding().theme).toEqual({
      video: "/video/hero-v5.mp4",
      poster: "/video/hero-v5-poster.jpg",
      location_line: "Zapopan, México",
    });
    expect(writes).toEqual([`weddings:${OURS}`]);
  });

  it("can be retried after the wedding row failed to save", async () => {
    fail.on = true;
    const first = saveWeddingDetails(scope, input, { now, expectedMoves: ["ceremony", "reception"] });
    await expect(first).rejects.toThrow(PartialSaveError);
    await expect(first).rejects.toThrow("Ceremony and Reception moved to the new day, but the rest did not save.");
    expect(wedding().wedding_date).toBe("2027-09-18");

    fail.on = false;
    writes.length = 0;
    const retry = await saveWeddingDetails(scope, input, { now, expectedMoves: ["ceremony", "reception"] });
    expect(retry).toEqual({ ok: true, moved: [] });
    expect(event("ceremony").starts_at).toBe("2027-10-02T23:00:00.000Z");
    expect(wedding().wedding_date).toBe("2027-10-02");
    expect(writes).toEqual([`weddings:${OURS}`]);
  });

  it("leaves an event alone when its time changed in another tab since it was read", async () => {
    // The fake applies the starts_at filter, so a stale read matches no row.
    const original = store.events.find((e) => e.id === "reception")!;
    const realFrom = scope.db.from.bind(scope.db);
    let edited = false;
    scope = {
      ...scope,
      db: {
        from(table: string) {
          if (table === "events" && !edited) {
            const q = realFrom(table) as unknown as { then: (r: (v: unknown) => unknown) => Promise<unknown> };
            const then = q.then.bind(q);
            q.then = (resolve) =>
              then((v) => {
                edited = true;
                original.starts_at = "2027-09-18T23:45:00.000Z";
                return resolve(v);
              });
            return q;
          }
          return realFrom(table);
        },
      } as unknown as WeddingScope["db"],
    };
    const result = await saveWeddingDetails(scope, input, { now });
    expect(result).toEqual({ ok: true, moved: ["Ceremony"] });
    expect(original.starts_at).toBe("2027-09-18T23:45:00.000Z");
  });

  it("stops when an event joined the wedding day after she saw the list", async () => {
    const result = await saveWeddingDetails(scope, input, { now, expectedMoves: ["ceremony"] });
    expect(result).toEqual({ ok: false, unexpectedMoves: ["Reception"] });
    expect(writes).toEqual([]);
  });

  it("writes nothing when a field is wrong", async () => {
    const result = await saveWeddingDetails(scope, { ...input, replyBy: "2027-12-01" }, { now });
    expect(result).toMatchObject({ ok: false, fieldErrors: { replyBy: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("asks before it saves a day in the past", async () => {
    const result = await saveWeddingDetails(scope, { ...input, weddingDay: "2026-06-12", replyBy: "" }, { now });
    expect(result).toEqual({ ok: false, fieldErrors: {}, needsPastConfirm: true });
    expect(writes).toEqual([]);
  });

  it("records what changed", async () => {
    await saveWeddingDetails(scope, input, { now, actorId: "admin-1" });
    expect(store.activity_log).toEqual([
      expect.objectContaining({
        wedding_id: OURS,
        actor_id: "admin-1",
        action: "wedding.details_updated",
        payload: expect.objectContaining({ movedEvents: ["Ceremony", "Reception"] }),
      }),
    ]);
  });
});
