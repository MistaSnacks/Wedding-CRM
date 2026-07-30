import { describe, it, expect, beforeEach } from "vitest";
import type { WeddingScope } from "./scope";
import { cache } from "@/lib/limiter";
import { assign, deleteTable, guestTable, unassign, upsertTable } from "./seating";

/**
 * These tests exist because the seating module is the one place in the admin
 * where ids travel from a drag-and-drop canvas straight into a write. The
 * admin uses the service-role client, so RLS is not watching — if a query
 * here forgets `wedding_id`, a crafted id from another wedding is honoured.
 *
 * The fake below is a tiny in-memory stand-in for the PostgREST builder:
 * enough of `eq/neq/in/select/single/maybeSingle` to let the real module run
 * unmodified against rows from two different weddings at once. Its whole
 * point is that a filter the module forgets to apply is a filter the fake
 * does not apply either, so the foreign row comes back and the test fails.
 */

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;
type Op = "select" | "insert" | "update" | "delete" | "upsert";

/** Rows that make an upsert an update instead of an insert, per table. */
const CONFLICT_KEYS: Record<string, string[]> = {
  seat_assignments: ["guest_id", "event_id"],
};

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private shape: "many" | "single" | "maybe" = "many";

  constructor(
    private table: string,
    private op: Op,
    private payload: Row | Row[] | null,
    private store: Store,
  ) {}

  select() { return this; }
  order() { return this; }
  limit() { return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  neq(col: string, val: unknown) { this.filters.push((r) => r[col] !== val); return this; }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  single() { this.shape = "single"; return this; }
  maybeSingle() { this.shape = "maybe"; return this; }

  private rows(): Row[] {
    this.store[this.table] ??= [];
    return this.store[this.table];
  }

  private matching(): Row[] {
    return this.rows().filter((r) => this.filters.every((f) => f(r)));
  }

  private exec(): { data: unknown; error: { message: string } | null } {
    let affected: Row[] = [];

    if (this.op === "select") {
      affected = this.matching();
    } else if (this.op === "insert" || this.op === "upsert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) as Row[];
      for (const row of incoming) {
        const keys = CONFLICT_KEYS[this.table];
        const clash =
          this.op === "upsert" && keys
            ? this.rows().find((r) => keys.every((k) => r[k] === row[k]))
            : undefined;
        if (clash) {
          Object.assign(clash, row);
          affected.push(clash);
        } else {
          const created = { id: `${this.table}-${this.rows().length + 1}`, ...row };
          this.rows().push(created);
          affected.push(created);
        }
      }
    } else if (this.op === "update") {
      affected = this.matching();
      for (const row of affected) Object.assign(row, this.payload);
    } else {
      affected = this.matching();
      this.store[this.table] = this.rows().filter((r) => !affected.includes(r));
    }

    if (this.shape === "many") return { data: affected, error: null };
    if (affected.length > 0) return { data: affected[0], error: null };
    if (this.shape === "maybe") return { data: null, error: null };
    return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
  }

  then(
    onFulfilled?: (v: { data: unknown; error: { message: string } | null }) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) {
    return Promise.resolve(this.exec()).then(onFulfilled, onRejected);
  }
}

function fakeDb(store: Store) {
  return {
    from(table: string) {
      return {
        select: () => new FakeQuery(table, "select", null, store),
        insert: (payload: Row | Row[]) => new FakeQuery(table, "insert", payload, store),
        upsert: (payload: Row | Row[]) => new FakeQuery(table, "upsert", payload, store),
        update: (payload: Row) => new FakeQuery(table, "update", payload, store),
        delete: () => new FakeQuery(table, "delete", null, store),
      };
    },
  };
}

const OURS = "wedding-ours";
const THEIRS = "wedding-theirs";

let store: Store;
let scope: WeddingScope;

function scopeFor(weddingId: string): WeddingScope {
  return { weddingId, db: fakeDb(store) as unknown as WeddingScope["db"] };
}

beforeEach(() => {
  store = {
    events: [
      { id: "event-ours", wedding_id: OURS, seating_published_at: "2026-08-01T00:00:00Z" },
      { id: "event-ours-2", wedding_id: OURS, seating_published_at: null },
      { id: "event-theirs", wedding_id: THEIRS, seating_published_at: "2026-08-01T00:00:00Z" },
    ],
    seating_tables: [
      { id: "table-ours", wedding_id: OURS, event_id: "event-ours", name: "Table 1", capacity: 8 },
      { id: "table-theirs", wedding_id: THEIRS, event_id: "event-theirs", name: "Head", capacity: 10 },
    ],
    guests: [
      { id: "guest-ours", wedding_id: OURS, household_id: "hh-ours" },
      { id: "guest-theirs", wedding_id: THEIRS, household_id: "hh-theirs" },
    ],
    seat_assignments: [],
    activity_log: [],
  };
  scope = scopeFor(OURS);
});

describe("assign — cross-wedding ids", () => {
  it("refuses a tableId from another wedding instead of seating into their chart", async () => {
    await expect(assign(scope, "guest-ours", "event-theirs", "table-theirs")).rejects.toThrow(
      /table not found in this wedding/i,
    );
    expect(store.seat_assignments).toHaveLength(0);
  });

  it("refuses a table that belongs to a different event than the one being seated", async () => {
    await expect(assign(scope, "guest-ours", "event-ours-2", "table-ours")).rejects.toThrow(
      /does not belong to this event/i,
    );
    expect(store.seat_assignments).toHaveLength(0);
  });

  it("refuses a guestId from another wedding", async () => {
    await expect(assign(scope, "guest-theirs", "event-ours", "table-ours")).rejects.toThrow(
      /guest not found in this wedding/i,
    );
    expect(store.seat_assignments).toHaveLength(0);
  });

  it("seats a guest of this wedding and logs their own household", async () => {
    await assign(scope, "guest-ours", "event-ours", "table-ours", "admin-1");
    expect(store.seat_assignments).toHaveLength(1);
    expect(store.seat_assignments[0]).toMatchObject({
      guest_id: "guest-ours",
      table_id: "table-ours",
      wedding_id: OURS,
    });
    expect(store.activity_log[0]).toMatchObject({ household_id: "hh-ours", action: "table.assigned" });
  });
});

describe("upsertTable — cross-wedding ids", () => {
  it("refuses to edit another wedding's table, leaving its wedding_id alone", async () => {
    await expect(
      upsertTable(scope, { id: "table-theirs", eventId: "event-ours", name: "Stolen", capacity: 2 }),
    ).rejects.toThrow(/table not found in this wedding/i);
    expect(store.seating_tables.find((t) => t.id === "table-theirs")).toMatchObject({
      wedding_id: THEIRS,
      name: "Head",
    });
  });

  it("refuses to attach a new table to another wedding's event", async () => {
    const before = store.seating_tables.length;
    await expect(
      upsertTable(scope, { eventId: "event-theirs", name: "Table 2", capacity: 6 }),
    ).rejects.toThrow(/event not found in this wedding/i);
    expect(store.seating_tables).toHaveLength(before);
  });

  it("creates a table stamped with this wedding", async () => {
    const created = await upsertTable(scope, { eventId: "event-ours", name: "Table 2", capacity: 6 });
    expect(created.name).toBe("Table 2");
    expect(store.seating_tables.find((t) => t.name === "Table 2")).toMatchObject({ wedding_id: OURS });
  });

  it("edits a table this wedding owns", async () => {
    const updated = await upsertTable(scope, {
      id: "table-ours",
      eventId: "event-ours",
      name: "Sweetheart",
      capacity: 2,
    });
    expect(updated.name).toBe("Sweetheart");
    expect(store.seating_tables.find((t) => t.id === "table-ours")).toMatchObject({
      wedding_id: OURS,
      capacity: 2,
    });
  });
});

describe("deleteTable", () => {
  it("cannot delete another wedding's table", async () => {
    await deleteTable(scope, "table-theirs");
    expect(store.seating_tables.some((t) => t.id === "table-theirs")).toBe(true);
  });
});

describe("guestTable — cross-wedding reads", () => {
  it("shows nothing for an event belonging to another wedding, published or not", async () => {
    expect(await guestTable(scope, "guest-ours", "event-theirs")).toBeNull();
  });

  it("never lists a tablemate from another wedding at a colliding table id", async () => {
    store.seat_assignments.push(
      { guest_id: "guest-ours", event_id: "event-ours", table_id: "table-ours", wedding_id: OURS },
      // Same table id, different wedding: only a wedding_id filter keeps this out.
      { guest_id: "guest-theirs", event_id: "event-ours", table_id: "table-ours", wedding_id: THEIRS },
    );
    const result = await guestTable(scope, "guest-ours", "event-ours");
    expect(result).not.toBeNull();
    expect(result?.tableName).toBe("Table 1");
    expect(result?.mates).toHaveLength(0);
  });
});

describe("metrics cache invalidation", () => {
  // The Overview caches its counts for 60s. Every seating write must drop that
  // cache in the data layer, or the dashboard reports pre-edit numbers for up
  // to a minute and the user reasonably concludes their edit did not save.
  async function cachedOverview(): Promise<number> {
    return cache(`metrics:${OURS}:overview`, 60, async () => Date.now() + Math.random());
  }

  it("assign, unassign, upsertTable and deleteTable each clear the wedding's metrics", async () => {
    for (const write of [
      () => assign(scope, "guest-ours", "event-ours", "table-ours"),
      () => unassign(scope, "guest-ours", "event-ours"),
      () => upsertTable(scope, { eventId: "event-ours", name: "Table N", capacity: 4 }),
      () => deleteTable(scope, "table-ours"),
    ]) {
      const before = await cachedOverview();
      expect(await cachedOverview()).toBe(before); // cached, as the Overview expects
      await write();
      expect(await cachedOverview()).not.toBe(before);
    }
  });

  it("leaves another wedding's cached metrics alone", async () => {
    const theirs = await cache(`metrics:${THEIRS}:overview`, 60, async () => "theirs");
    await assign(scope, "guest-ours", "event-ours", "table-ours");
    expect(await cache(`metrics:${THEIRS}:overview`, 60, async () => "recomputed")).toBe(theirs);
  });
});
