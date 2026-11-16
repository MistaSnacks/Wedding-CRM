import { describe, expect, it } from "vitest";
import { readAll } from "./query";
describe("complete collection reads", () => {
  it("reads beyond both UI and API page ceilings", async () => {
    const all = Array.from({ length: 1203 }, (_, id) => ({ id }));
    const rows = await readAll(() => ({ range: async (a, b) => ({ data: all.slice(a, b + 1), error: null }) }));
    expect(rows).toEqual(all);
  });
  it("does not return partial results after a later page fails", async () => {
    await expect(readAll(() => ({ range: async (a) => a === 0
      ? { data: [{ id: 1 }], error: null }
      : { data: null, error: { message: "connection lost" } } }), 1)).rejects.toThrow("connection lost");
  });
});
