import { describe, it, expect } from "vitest";
import { normalizeAge } from "./normalize";

describe("normalizeAge", () => {
  it("trims surrounding whitespace before classifying", () => {
    expect(normalizeAge(" baby")).toBe("infant");
    expect(normalizeAge("baby ")).toBe("infant");
    expect(normalizeAge("  Child ")).toBe("child");
    expect(normalizeAge(" adult ")).toBe("adult");
  });
});
