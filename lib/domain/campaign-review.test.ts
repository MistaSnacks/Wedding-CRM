import { describe, expect, it } from "vitest";
import { reviewToken, splitRecipients, tokenMatches } from "./campaign-review";

const h = (name: string, email: string | null) => ({ display_name: name, email });

describe("splitRecipients", () => {
  it("separates households with and without an email", () => {
    const { emailable, skipped } = splitRecipients([
      h("A", "a@x.com"),
      h("B", null),
      h("C", ""),
      h("D", "d@x.com"),
    ]);
    expect(emailable.map((x) => x.display_name)).toEqual(["A", "D"]);
    expect(skipped.map((x) => x.display_name)).toEqual(["B", "C"]);
  });

  it("handles an empty list", () => {
    expect(splitRecipients([])).toEqual({ emailable: [], skipped: [] });
  });
});

describe("review tokens", () => {
  it("round-trips", () => {
    const t = reviewToken(42, "not_responded", "reminder");
    expect(tokenMatches(t, 42, "not_responded", "reminder")).toBe(true);
  });

  it("rejects when the audience count changed since review", () => {
    const t = reviewToken(42, "not_responded", "reminder");
    expect(tokenMatches(t, 41, "not_responded", "reminder")).toBe(false);
  });

  it("rejects when audience or type changed", () => {
    const t = reviewToken(42, "not_responded", "reminder");
    expect(tokenMatches(t, 42, "all", "reminder")).toBe(false);
    expect(tokenMatches(t, 42, "not_responded", "invitation")).toBe(false);
  });

  it("rejects garbage tokens", () => {
    expect(tokenMatches("nonsense", 1, "all", "reminder")).toBe(false);
    expect(tokenMatches("", 1, "all", "reminder")).toBe(false);
  });
});
