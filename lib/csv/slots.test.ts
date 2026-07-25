import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

describe("blank-name rows", () => {
  it("becomes a plus-one slot on its envelope's household", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann One,Ann,One,Primary
Group A,Ann One,,,Companion
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.households[0].guests).toHaveLength(1);
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(2);
  });

  it("does not depend on any category value", () => {
    // The blank row's category matches the named row's — a slot is still created.
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group B,Ben Two &,Ben,Two,Relatives
Group B,Ben Two &,,,Relatives
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(2);
  });

  it("counts multiple blank rows as multiple slots", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name
Group C,Cara,Three
Group C,,
Group C,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(2);
    expect(v.households[0].maxPartySize).toBe(3);
  });

  it("still warns and skips a row with no name and no grouping value", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name,Email\n,,\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(0);
    expect(v.warnings.some((w) => w.message.includes("Empty name"))).toBe(true);
  });

  it("adds slots on top of an explicit plus-one-slots column", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Plus Ones
Group D,Dana,Four,1
Group D,,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(2);
  });
});
