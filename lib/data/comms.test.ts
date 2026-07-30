import { describe, it, expect, beforeEach } from "vitest";
import type { WeddingScope } from "./scope";
import { create, markByMessageId, setRecipientMessageId } from "./comms";

/**
 * Communications are the one data-layer module that both sends to real people
 * and accepts input from a webhook. Two ways a missing `wedding_id` filter
 * hurts: a household id from another wedding, pasted into a send, becomes a
 * recipient row with a stranger's address in it; and a Resend webhook for
 * another wedding's message quietly marks a row here as delivered.
 *
 * Small in-memory stand-in for the PostgREST builder — a filter the module
 * forgets is a filter this fake does not apply either.
 */

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;
type Op = "select" | "insert" | "update" | "delete";

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
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  gte() { return this; }
  single() { this.shape = "single"; return this; }
  maybeSingle() { this.shape = "maybe"; return this; }

  private rows(): Row[] {
    this.store[this.table] ??= [];
    return this.store[this.table];
  }

  private exec(): { data: unknown; error: { message: string } | null } {
    const matching = () => this.rows().filter((r) => this.filters.every((f) => f(r)));
    let affected: Row[] = [];

    if (this.op === "select") {
      affected = matching();
    } else if (this.op === "insert") {
      for (const row of (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) as Row[]) {
        const created = { id: `${this.table}-${this.rows().length + 1}`, ...row };
        this.rows().push(created);
        affected.push(created);
      }
    } else if (this.op === "update") {
      affected = matching();
      for (const row of affected) Object.assign(row, this.payload);
    } else {
      affected = matching();
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

beforeEach(() => {
  store = {
    households: [
      { id: "hh-ours", wedding_id: OURS, email: "ours@example.com" },
      { id: "hh-theirs", wedding_id: THEIRS, email: "stranger@example.com" },
    ],
    communications: [],
    communication_recipients: [],
    activity_log: [],
  };
  scope = { weddingId: OURS, db: fakeDb(store) as unknown as WeddingScope["db"] };
});

describe("create", () => {
  it("only ever addresses households in this wedding", async () => {
    await create(scope, {
      type: "invitation",
      channel: "email",
      householdIds: ["hh-ours", "hh-theirs"],
    });
    expect(store.communication_recipients).toHaveLength(1);
    expect(store.communication_recipients[0]).toMatchObject({
      household_id: "hh-ours",
      email: "ours@example.com",
      wedding_id: OURS,
    });
  });
});

describe("markByMessageId", () => {
  beforeEach(() => {
    store.communication_recipients = [
      { id: "rec-ours", wedding_id: OURS, resend_message_id: "msg-ours", status: "sent" },
      { id: "rec-theirs", wedding_id: THEIRS, resend_message_id: "msg-theirs", status: "sent" },
    ];
  });

  it("advances a recipient in this wedding", async () => {
    expect(await markByMessageId(scope, "msg-ours", "delivered")).toBe(true);
    expect(store.communication_recipients[0].status).toBe("delivered");
  });

  it("reports another wedding's message as not ours and writes nothing", async () => {
    expect(await markByMessageId(scope, "msg-theirs", "bounced")).toBe(false);
    expect(store.communication_recipients[1].status).toBe("sent");
  });

  it("never downgrades a status it has already passed", async () => {
    await markByMessageId(scope, "msg-ours", "opened");
    expect(await markByMessageId(scope, "msg-ours", "delivered")).toBe(true);
    expect(store.communication_recipients[0].status).toBe("opened");
  });
});

describe("setRecipientMessageId", () => {
  it("stamps only this wedding's recipient row", async () => {
    store.communication_recipients = [
      { id: "rec-ours", wedding_id: OURS, communication_id: "comm-1", household_id: "hh-1", status: "queued" },
      { id: "rec-theirs", wedding_id: THEIRS, communication_id: "comm-1", household_id: "hh-1", status: "queued" },
    ];
    await setRecipientMessageId(scope, "comm-1", "hh-1", "msg-1");
    expect(store.communication_recipients[0]).toMatchObject({ resend_message_id: "msg-1", status: "sent" });
    expect(store.communication_recipients[1].status).toBe("queued");
    expect(store.communication_recipients[1].resend_message_id).toBeUndefined();
  });
});
