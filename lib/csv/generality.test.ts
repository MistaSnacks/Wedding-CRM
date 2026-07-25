import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parseCsv, detectMapping, validateCsv } from "./index";

// Genuinely client-specific values pulled from the one wedding spreadsheet this
// importer was originally built against. These must never leak into the
// generic importer source — the importer is a product feature every wedding
// onboards through, not a migration script for one client's data.
//
// NOTE: "Baby" and "Plus One" are deliberately NOT on this list. Both are
// generic wedding-spreadsheet vocabulary the importer legitimately recognizes
// (lib/csv/normalize.ts: `s === "baby"` in normalizeAge, and
// `s.includes("plus one")` in isTruthy) and were explicitly authorized in
// Tasks 1 and 5 respectively. They are not client-specific literals.
const FORBIDDEN = ["Le 1", "Envelope Name", "A List", "Wedding RSVP", "Juliet", "Juan"];

/**
 * Strip line (`//`) and block (`/* ... *\/`) comments from TypeScript source
 * before scanning for forbidden literals.
 *
 * Why: matching is case-insensitive so a lowercase client literal can't slip
 * through the way `"baby"` would under case-sensitive matching. But
 * case-insensitive matching on "A List" also matches ordinary English prose
 * in comments (e.g. a docblock describing "groups rows into a list of
 * households"). The constraint this test enforces is about *code* — actual
 * hardcoded values — not about what words appear in explanatory comments.
 * Stripping comments first targets exactly that: it lets doc prose use
 * ordinary English freely while still catching any literal or identifier
 * checked into the executable source.
 *
 * This is a simplification (it does not attempt to preserve `//` or `/* `
 * that appear inside string/regex literals) but is safe for this purpose:
 * it can only make the scan *more* lenient in contrived edge cases, never
 * hide a real forbidden literal sitting in live code outside a comment.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, "");
}

describe("tenant agnosticism", () => {
  it("contains no wedding-specific literals in importer source", () => {
    const dir = path.resolve(__dirname);
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(dir, f));
    sources.push(path.resolve(__dirname, "../data/imports.ts"));

    const offenders: string[] = [];
    for (const file of sources) {
      const raw = readFileSync(file, "utf8");
      const text = stripComments(raw).toLowerCase();
      for (const literal of FORBIDDEN) {
        if (text.includes(literal.toLowerCase())) offenders.push(`${path.basename(file)}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports a CSV with entirely unrelated column names", () => {
    const csv = `Party,Mail To,Guest,Surname,Segment,Meal
Table Group 1,Smith Residence,Ana,Silva,VIP,Steak
Table Group 1,Smith Residence,Bruno,Silva,VIP,Salmon
Table Group 1,Smith Residence,,,,
`;
    const { headers, rows } = parseCsv(csv);
    const mapping = {
      firstName: "Guest",
      lastName: "Surname",
      household: "Party",
      envelope: "Mail To",
      meal: "Meal",
      tags: [{ column: "Segment" }],
    };
    const context = {
      events: [],
      mealOptions: [{ id: "m1", name: "Steak" }, { id: "m2", name: "Salmon" }],
    };
    const v = validateCsv(rows, mapping, context);
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.households[0].displayName).toBe("Smith Residence");
    expect(v.households[0].guests).toHaveLength(2);
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(3);
    expect(v.households[0].tags).toEqual(["VIP"]);
    expect(v.households[0].guests[0].mealOptionId).toBe("m1");
    expect(headers).toContain("Segment");
    expect(detectMapping(headers).firstName).toBe("");
  });

  it("still imports a bare first/last-name CSV with no optional mappings", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\nBob,Two\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(2);
  });
});
