import { expect, it } from "vitest";
import Papa from "papaparse";
import { toCsv } from "./csv";
it("neutralizes formulas and safely escapes header commas, quotes and CR", () => {
  const csv = toCsv([{ 'Reception, Dinner': '=1+1', Notes: 'a\rb', Cost: -20 }]);
  const parsed = Papa.parse(csv, { header: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data[0]).toEqual({ 'Reception, Dinner': "'=1+1", Notes: 'a\rb', Cost: '-20' });
});
it("protects formula text preceded by whitespace", () => {
  expect(toCsv([{ Guest: '\t @SUM(1)' }])).toContain("'\t @SUM(1)");
});
