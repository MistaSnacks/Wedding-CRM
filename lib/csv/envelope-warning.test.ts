import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";
import { countEnvelopeNames } from "./normalize";

describe("countEnvelopeNames", () => {
  it("counts ampersand and comma separated names", () => {
    expect(countEnvelopeNames("Ann One")).toBe(1);
    expect(countEnvelopeNames("Ann One & Bob Two")).toBe(2);
    expect(countEnvelopeNames("Ann, Bob, Cal & Dee")).toBe(4);
    expect(countEnvelopeNames("Ann One and Bob Two")).toBe(2);
  });

  it("ignores a dangling separator", () => {
    expect(countEnvelopeNames("Ann One &")).toBe(1);
    expect(countEnvelopeNames("Ann One & ")).toBe(1);
  });

  it("returns zero for blanks", () => {
    expect(countEnvelopeNames("")).toBe(0);
    expect(countEnvelopeNames("   ")).toBe(0);
  });
});

describe("under-populated envelope warning", () => {
  it("warns when an envelope names more people than it has seats", () => {
    // Four names, three seats — the third person has no row.
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group A,"Ann, Bob, Cal & Dee",Ann,One
Group A,"Ann, Bob, Cal & Dee",Bob,One
Group A,"Ann, Bob, Cal & Dee",Dee,One
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.warnings.some((w) => w.message.includes("names 4") && w.message.includes("3"))).toBe(true);
  });

  it("counts plus-one slots as seats", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group B,Ann One & Guest,Ann,One
Group B,Ann One & Guest,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.warnings.filter((w) => w.message.includes("names"))).toHaveLength(0);
  });

  it("does not warn when the counts agree", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group C,Ann One & Bob Two,Ann,One
Group C,Ann One & Bob Two,Bob,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.warnings.filter((w) => w.message.includes("names"))).toHaveLength(0);
  });

  it("never warns when no envelope column is mapped", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.warnings.filter((w) => w.message.includes("names"))).toHaveLength(0);
  });
});
