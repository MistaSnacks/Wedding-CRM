import { describe, it, expect } from "vitest";
import { foldName, matchHouseholds, type EntryHousehold } from "./entry-match";

const hh = (
  id: string,
  display: string,
  email: string | null,
  guests: [string, string][],
): EntryHousehold => ({
  id,
  display_name: display,
  email,
  guests: guests.map(([first_name, last_name]) => ({ first_name, last_name })),
});

const FIXTURES: EntryHousehold[] = [
  hh("h1", "Linh & Minh Nguyễn", "linh@example.com", [
    ["Linh", "Nguyễn"],
    ["Minh", "Nguyễn"],
  ]),
  hh("h2", "José García", "jose@example.com", [["José", "García"]]),
  hh("h3", "The Smith Family", "sarah@example.com", [
    ["John", "Smith"],
    ["Sarah", "Smith"],
    ["Emma", "Smith"],
  ]),
  hh("h4", "Jane Doe", null, [["Jane", "Doe"]]),
  hh("h5", "The Smyth Household", "smyth@example.com", [["Anna", "Smyth"]]),
];

describe("foldName", () => {
  it("strips accents, case, and extra whitespace", () => {
    expect(foldName("  José   GARCÍA ")).toBe("jose garcia");
  });

  it("folds Vietnamese diacritics including đ", () => {
    expect(foldName("Nguyễn Đình")).toBe("nguyen dinh");
  });
});

describe("matchHouseholds — names", () => {
  it("finds a guest by exact full name", () => {
    const r = matchHouseholds("Sarah Smith", FIXTURES);
    expect(r.status).toBe("matches");
    if (r.status !== "matches") return;
    expect(r.matches[0]).toEqual({ id: "h3", displayName: "The Smith Family", members: ["John", "Sarah", "Emma"] });
  });

  it("is accent-insensitive both ways", () => {
    const typedPlain = matchHouseholds("jose garcia", FIXTURES);
    expect(typedPlain.status).toBe("matches");
    if (typedPlain.status === "matches") expect(typedPlain.matches[0].id).toBe("h2");

    const typedAccented = matchHouseholds("José García", FIXTURES);
    expect(typedAccented.status).toBe("matches");
    if (typedAccented.status === "matches") expect(typedAccented.matches[0].id).toBe("h2");
  });

  it("finds Vietnamese names typed without diacritics", () => {
    const r = matchHouseholds("Linh Nguyen", FIXTURES);
    expect(r.status).toBe("matches");
    if (r.status === "matches") expect(r.matches[0].id).toBe("h1");
  });

  it("tolerates family-name-first order", () => {
    const r = matchHouseholds("Nguyen Linh", FIXTURES);
    expect(r.status).toBe("matches");
    if (r.status === "matches") expect(r.matches[0].id).toBe("h1");
  });

  it("tolerates an extra middle name", () => {
    const r = matchHouseholds("Sarah Anne Smith", FIXTURES);
    expect(r.status).toBe("matches");
    if (r.status === "matches") expect(r.matches[0].id).toBe("h3");
  });

  it("ranks the exact match above lookalikes and caps results", () => {
    const many: EntryHousehold[] = [
      ...FIXTURES,
      hh("h6", "Smithson Party", null, [["Al", "Smithson"]]),
      hh("h7", "The Other Smiths", null, [["Bea", "Smith"]]),
    ];
    const r = matchHouseholds("John Smith", many);
    expect(r.status).toBe("matches");
    if (r.status !== "matches") return;
    expect(r.matches[0].id).toBe("h3");
    expect(r.matches.length).toBeLessThanOrEqual(3);
  });

  it("rejects a single name as too short", () => {
    expect(matchHouseholds("Maria", FIXTURES).status).toBe("too_short");
    expect(matchHouseholds("  a b ", FIXTURES).status).toBe("too_short");
  });

  it("returns none for an unknown name", () => {
    expect(matchHouseholds("Taylor Brown", FIXTURES).status).toBe("none");
  });

  it("never leaks emails, tokens, or last names in results", () => {
    const r = matchHouseholds("Jane Doe", FIXTURES);
    expect(r.status).toBe("matches");
    if (r.status !== "matches") return;
    expect(Object.keys(r.matches[0]).sort()).toEqual(["displayName", "id", "members"]);
    expect(r.matches[0].members).toEqual(["Jane"]);
  });
});

describe("matchHouseholds — email", () => {
  it("matches the household email exactly, case-insensitively", () => {
    const r = matchHouseholds("  SARAH@example.com ", FIXTURES);
    expect(r.status).toBe("matches");
    if (r.status === "matches") expect(r.matches[0].id).toBe("h3");
  });

  it("does not substring-match emails", () => {
    expect(matchHouseholds("sarah@", FIXTURES).status).toBe("none");
    expect(matchHouseholds("x@example.com", FIXTURES).status).toBe("none");
  });
});
