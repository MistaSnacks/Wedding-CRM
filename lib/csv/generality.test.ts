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
 * before scanning for forbidden literals — WITHOUT touching the contents of
 * string literals.
 *
 * Why this must be a stateful scanner and not a plain regex: a naive
 * `/\/\/.*$/` strips everything from the first `//` to end-of-line with no
 * awareness of whether that `//` is a real comment or just sits inside a
 * string. A hardcoded wedding-website URL is exactly this shape —
 * `const homepage = "https://wedding.example.com/Juan-and-Juliet";` — and a
 * regex-only stripper deletes `Juan-and-Juliet` along with the fake
 * "comment", hiding the exact class of client literal this test exists to
 * catch (an earlier version of this file had precisely this bug). String
 * contents are exactly where a hardcoded literal would live, so they must
 * remain scannable; only comments outside of strings should be removed.
 * This walks the text once, tracking whether we're inside a `'`, `"`, or
 * `` ` `` literal (honouring backslash escapes) and only treats `//`/`/*` as
 * a comment start when we are not.
 */
function stripComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        // Escaped char: emit it too and skip past both without inspecting it.
        if (i + 1 < text.length) out += text[++i];
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      i--; // let the loop's i++ re-consume the newline (or end) normally
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
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
