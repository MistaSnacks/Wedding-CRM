import { describe, expect, it } from "vitest";
import { LAKE, inWater, plantable, stepFront } from "./live-garden";

describe("plantable", () => {
  it("rejects open water, the terraces, the platform and the entrance walk", () => {
    expect(plantable(0, 32)).toBe(false); // open water
    expect(plantable(-11, 28.5)).toBe(false); // the fire bowl spot
    expect(plantable(0, 18)).toBe(false); // stone terraces
    expect(plantable(5, 5)).toBe(false); // pavilion platform
    expect(plantable(0, -30)).toBe(false); // entrance walk
  });
  it("grows the test by a radius", () => {
    expect(plantable(LAKE.x1 + 1, 30)).toBe(true);
    expect(plantable(LAKE.x1 + 1, 30, 2)).toBe(false);
  });
  it("accepts lawn", () => {
    expect(plantable(40, 0)).toBe(true);
    expect(plantable(0, 45)).toBe(true);
  });
});

describe("inWater", () => {
  it("is true past the lowest step and false on it", () => {
    expect(inWater(0, 32)).toBe(true);
    expect(inWater(0, stepFront(3, 0) - 0.5)).toBe(false);
    expect(inWater(0, LAKE.z1 + 1)).toBe(false);
  });
});
