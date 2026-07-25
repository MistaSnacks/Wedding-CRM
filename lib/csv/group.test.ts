import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

const NESTED = `Household,Envelope Name,First Name,Last Name
Family Group A,Alpha One,Alpha,One
Family Group A,Beta Two & Gamma Three,Beta,Two
Family Group A,Beta Two & Gamma Three,Gamma,Three
Family Group A,Delta Four,Delta,Four
`;

describe("envelope grouping", () => {
  it("auto-detects an envelope column", () => {
    const { headers } = parseCsv(NESTED);
    expect(detectMapping(headers).envelope).toBe("Envelope Name");
  });

  it("splits one household value into per-envelope households", () => {
    const { headers, rows } = parseCsv(NESTED);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(3);
    expect(v.households.map((h) => h.displayName).sort()).toEqual([
      "Alpha One",
      "Beta Two & Gamma Three",
      "Delta Four",
    ]);
    const pair = v.households.find((h) => h.displayName === "Beta Two & Gamma Three")!;
    expect(pair.guests).toHaveLength(2);
    expect(pair.maxPartySize).toBe(2);
  });

  it("normalizes whitespace and case so variants do not split households", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group X ,Same  Envelope,Ann,One
group x,SAME Envelope,Ben,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(1);
    expect(v.households[0].guests).toHaveLength(2);
  });

  it("merges rows sharing an envelope even when their household values differ", () => {
    // One family, inconsistently labelled in the household column. The envelope
    // line is what gets mailed, so these three rows are one invitation — two
    // identically addressed envelopes to one doorstep would be a bug.
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group P,Ann One & Ben Two,Ann,One
Group P,Ann One & Ben Two,Ben,Two
Group Q,Ann One & Ben Two,Cara,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.households[0].displayName).toBe("Ann One & Ben Two");
    expect(v.households[0].guests.map((g) => g.firstName).sort()).toEqual(["Ann", "Ben", "Cara"]);
  });

  it("control: one household value across several envelopes still splits", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group R,Ann One,Ann,One
Group R,Ben Two,Ben,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(2);
    expect(v.households.map((h) => h.displayName).sort()).toEqual(["Ann One", "Ben Two"]);
  });

  it("falls back to the household column when envelope is blank", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group Y,,Ann,One
Group Y,,Ben,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(1);
    expect(v.households[0].displayName).toBe("Group Y");
  });
});
