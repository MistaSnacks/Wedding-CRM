import { describe, expect, it } from "vitest";
import { CHANGELOG, LATEST_CHANGELOG_ID, unseenEntries } from "./changelog";

describe("changelog list", () => {
  it("has unique ids, since an id is what gets stored as 'read'", () => {
    const ids = CHANGELOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is newest first", () => {
    expect(LATEST_CHANGELOG_ID).toBe(CHANGELOG[0].id);
  });

  it("has something to say in every entry", () => {
    for (const e of CHANGELOG) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.items.length).toBeGreaterThan(0);
    }
  });
});

describe("unseenEntries", () => {
  it("shows everything to someone who has never dismissed one", () => {
    expect(unseenEntries(null)).toEqual(CHANGELOG);
    expect(unseenEntries(undefined)).toEqual(CHANGELOG);
  });

  it("shows nothing to someone already up to date", () => {
    expect(unseenEntries(LATEST_CHANGELOG_ID)).toEqual([]);
  });

  it("shows only what arrived after the entry they last read", () => {
    const second = CHANGELOG[1].id;
    const unseen = unseenEntries(second);
    expect(unseen).toHaveLength(1);
    expect(unseen[0].id).toBe(CHANGELOG[0].id);
  });

  it("stays quiet on an id it doesn't recognise, rather than replaying history", () => {
    expect(unseenEntries("2019-01-01-removed")).toEqual([]);
  });
});
