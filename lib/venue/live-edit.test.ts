import { describe, expect, it } from "vitest";
import { addTableOfKind, draftFromVenue, duplicateTable, freeSpot, stageTables } from "./live-edit";
import { sampleVenue } from "./live-data";

const env = (t: { width: number; depth: number }) => Math.hypot(t.width, t.depth) / 2 + 0.55;

describe("live layout editing", () => {
  const draft = draftFromVenue(sampleVenue());

  it("starts from the venue tables with real guest ids", () => {
    expect(draft.tables).toHaveLength(16);
    expect(draft.tables[1].guestIds).toHaveLength(4);
    expect(stageTables(draft)[1].guests[0]).toMatch(/\w+ \w+/);
  });

  it.each(["round", "long", "head"] as const)("adds a %s table without overlap", (kind) => {
    const { tables, added } = addTableOfKind(draft.tables, kind);
    expect(tables).toHaveLength(17);
    for (const o of draft.tables) expect(Math.hypot(o.x - added.x, o.z - added.z)).toBeGreaterThanOrEqual(env(o) + env(added) - 1e-9);
    if (kind === "head") expect(added.name).toMatch(/^Head table/);
    if (kind === "long") expect(added.capacity).toBe(10);
  });

  it("duplicates a table with no guests, next to a free spot", () => {
    const { tables, added } = duplicateTable(draft.tables, "table-5");
    expect(tables).toHaveLength(17);
    expect(added.guestIds).toEqual([]);
    expect(added.capacity).toBe(draft.tables[4].capacity);
  });

  it("finds a free spot off the dance floor", () => {
    const s = freeSpot(draft.tables, { ...draft.tables[3], id: "x" });
    expect(s.found).toBe(true);
    expect(Math.abs(s.x) < 5.4 && Math.abs(s.z) < 2.9).toBe(false);
  });
});
