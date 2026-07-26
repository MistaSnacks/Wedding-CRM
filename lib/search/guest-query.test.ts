import { describe, expect, it } from "vitest";
import { matchesGuestQuery, normalizeQuery, type SearchableHousehold } from "./guest-query";

const household = (over: Partial<SearchableHousehold> = {}): SearchableHousehold => ({
  display_name: "Alison Aw-Irwin & Bryan Irwin",
  email: "yalisonaw@gmail.com",
  phone: "(425) 890-1026",
  guests: [
    { first_name: "Alison", last_name: "Aw-Irwin" },
    { first_name: "Bryan", last_name: "Irwin" },
    { first_name: "Millie", last_name: "Irwin" },
  ],
  ...over,
});

describe("normalizeQuery", () => {
  it("strips diacritics and case", () => {
    expect(normalizeQuery("Huyền NGUYEN")).toBe("huyen nguyen");
  });
});

describe("matchesGuestQuery", () => {
  it("matches a guest name ignoring diacritics", () => {
    const h = household({
      display_name: "Cau Tuan Huyen",
      guests: [{ first_name: "Cau Tuan", last_name: "Huyền" }],
    });
    expect(matchesGuestQuery("huyen", h)).toBe(true);
  });

  it("matches partial first and last names", () => {
    expect(matchesGuestQuery("mill", household())).toBe(true);
    expect(matchesGuestQuery("irw", household())).toBe(true);
  });

  it("matches the household display name", () => {
    expect(matchesGuestQuery("aw-irwin", household())).toBe(true);
  });

  it("matches email substrings", () => {
    expect(matchesGuestQuery("yalisonaw", household())).toBe(true);
  });

  it("matches phone digit runs across formatting", () => {
    expect(matchesGuestQuery("4258901", household())).toBe(true);
  });

  it("requires every token to match somewhere", () => {
    expect(matchesGuestQuery("ali irwin", household())).toBe(true);
    expect(matchesGuestQuery("ali smith", household())).toBe(false);
  });

  it("matches everything on a blank query", () => {
    expect(matchesGuestQuery("", household())).toBe(true);
    expect(matchesGuestQuery("   ", household())).toBe(true);
  });

  it("handles null contact fields", () => {
    const h = household({ email: null, phone: null });
    expect(matchesGuestQuery("alison", h)).toBe(true);
    expect(matchesGuestQuery("gmail", h)).toBe(false);
  });
});
