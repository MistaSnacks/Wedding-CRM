import { expect, it } from "vitest";
import {
  addGuest,
  addTable,
  assignDemo,
  clampPosition,
  demoGuests,
  initialDraft,
  initialTables,
  layoutWarnings,
  parseDraft,
  parseSavedDraft,
  removeGuest,
  removeTable,
  setCapacity,
  setShape,
} from "./model";
it("moves a group without duplication and rejects overflow atomically", () => {
  const before = initialTables();
  const moved = assignDemo(before, "table-1", before[1].guestIds);
  expect(moved[0].guestIds).toHaveLength(8);
  expect(moved[1].guestIds).toHaveLength(0);
  expect(() => assignDemo(moved, "table-1", ["demo-80"])).toThrow(/is full/);
  expect(() =>
    assignDemo(before, "table-1", before[1].guestIds.concat("demo-80")),
  ).toThrow(/only has 4 free seats/);
  expect(before[0].guestIds).toHaveLength(4);
});
it("clamps chair envelopes independently of screen pixels", () => {
  const t = { ...initialTables()[0], rotation: 90 };
  expect(clampPosition(t, 100, 100)).toEqual({ x: 12.85, z: 11.75 });
});
it("rejects malformed, duplicate and over-capacity saved drafts", () => {
  expect(parseDraft(initialTables())).toHaveLength(16);
  expect(() => parseDraft([{ ...initialTables()[0], x: NaN }])).toThrow();
  const t = initialTables();
  t[1].guestIds = t[0].guestIds;
  expect(() => parseDraft(t)).toThrow(/assignment/);
});

it("allows dropping a household partly seated at the destination without counting them twice", () => {
  const tables = initialTables();
  tables[0].capacity = 5;
  tables[0].guestIds = ["demo-1", "demo-2", "demo-5"];
  tables[1].guestIds = ["demo-3", "demo-4"];
  const moved = assignDemo(tables, "table-1", [
    "demo-1",
    "demo-2",
    "demo-3",
    "demo-4",
  ]);
  expect(moved[0].guestIds).toEqual([
    "demo-5",
    "demo-1",
    "demo-2",
    "demo-3",
    "demo-4",
  ]);
  expect(moved[1].guestIds).toEqual([]);
  expect(
    assignDemo(moved, "table-1", ["demo-1", "demo-2", "demo-3", "demo-4"]),
  ).toEqual(moved);
});

it("gives sample guests real-looking names grouped in families of four", () => {
  expect(demoGuests).toHaveLength(80);
  expect(demoGuests[0].name).toBe("Ana Ramírez");
  expect(
    demoGuests.slice(0, 4).every((g) => g.household === "Ramírez family"),
  ).toBe(true);
  expect(new Set(demoGuests.map((g) => g.name)).size).toBe(80);
});

it("adds and removes guests that the plan can seat and save", () => {
  const draft = initialDraft();
  const guests = addGuest(draft.guests, "  Aunt   Maria ", "Ramírez family");
  const added = guests.at(-1)!;
  expect(added).toEqual({
    id: "guest-1",
    name: "Aunt Maria",
    household: "Ramírez family",
  });
  expect(addGuest(guests, "Tío Pepe").at(-1)!.household).toBe("Pepe family");
  expect(() => addGuest(guests, "aunt maria")).toThrow(/already on the list/);
  expect(() => addGuest(guests, "   ")).toThrow(/name/);
  expect(() => assignDemo(draft.tables, "table-2", [added.id])).toThrow(
    /no longer/,
  );
  const tables = assignDemo(draft.tables, "table-2", [added.id], guests);
  expect(tables[1].guestIds).toContain(added.id);
  const saved = parseSavedDraft(JSON.parse(JSON.stringify({ tables, guests })));
  expect(saved.guests).toHaveLength(81);
  expect(saved.tables[1].guestIds).toContain(added.id);
  const removed = removeGuest({ tables, guests }, added.id);
  expect(removed.guests).toHaveLength(80);
  expect(removed.tables[1].guestIds).not.toContain(added.id);
});

it("still opens layouts saved before guests were stored", () => {
  const legacy = parseSavedDraft(initialTables());
  expect(legacy.guests).toBe(demoGuests);
  expect(legacy.tables).toHaveLength(16);
  expect(() =>
    parseSavedDraft({ tables: initialTables(), guests: [] }),
  ).toThrow();
});

it("adds a table on open floor away from the dance floor and removes tables", () => {
  const tables = initialTables();
  const more = addTable(tables);
  expect(more).toHaveLength(17);
  const added = more[16];
  expect(added.name).toBe("Table 17");
  expect(added.capacity).toBe(8);
  expect(layoutWarnings(more)).toEqual(layoutWarnings(tables));
  const fewer = removeTable(more, added.id);
  expect(fewer).toHaveLength(16);
  expect(() => removeTable([tables[0]], tables[0].id)).toThrow(/at least one/);
});

it("changes shape and seat count without dropping seated guests", () => {
  const t = initialTables()[1];
  const long = setShape(t, "rect");
  expect(long.shape).toBe("rect");
  expect(long.width).toBe(2.4);
  expect(long.depth).toBe(1);
  expect(setCapacity(long, 12).width).toBe(3.6);
  expect(setCapacity(t, 10).width).toBe(2.1);
  expect(() => setCapacity(t, 3)).toThrow(/already seated/);
  expect(setCapacity(t, 40).capacity).toBe(16);
});
