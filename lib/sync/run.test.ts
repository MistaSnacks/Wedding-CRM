import { describe, expect, it } from "vitest";
import { SheetAccessError } from "./sheet";
import { assertNotSuddenlyEmpty } from "./run";

describe("assertNotSuddenlyEmpty", () => {
  it("raises when a previously-populated sheet reads empty", () => {
    expect(() => assertNotSuddenlyEmpty(0, 72)).toThrow(SheetAccessError);
    expect(() => assertNotSuddenlyEmpty(0, 72)).toThrow(/came back empty/i);
  });

  it("allows a genuinely empty first run", () => {
    expect(() => assertNotSuddenlyEmpty(0, 0)).not.toThrow();
  });

  it("allows a normal read", () => {
    expect(() => assertNotSuddenlyEmpty(72, 72)).not.toThrow();
  });

  it("allows the sheet to shrink, as long as it is not to nothing", () => {
    // Rows can legitimately be deleted by the owner; only total emptiness is
    // treated as an outage.
    expect(() => assertNotSuddenlyEmpty(1, 72)).not.toThrow();
  });
});
