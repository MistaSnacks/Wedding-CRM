import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";
describe("CSV structure", () => {
  it("rejects unterminated quotes instead of swallowing another guest", () => {
    expect(() => parseCsv('First,Email\nAlice,"alice@example.com\nBeth,beth@example.com')).toThrow(/formatting problem/);
  });
  it("rejects shifted columns", () => {
    expect(() => parseCsv('First,Last\nAlice,A,extra')).toThrow(/columns/);
  });
  it("preserves correctly quoted multiline addresses", () => {
    expect(parseCsv('First,Address\nAlice,"Street\nCity"').rows[0].Address).toBe("Street\nCity");
  });
});
