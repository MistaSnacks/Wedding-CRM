import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";
import { isTruthy } from "./normalize";

describe("isTruthy", () => {
  it("accepts common affirmative spellings", () => {
    for (const v of ["yes", "Y", "true", "1", "x", "Plus One", "plus-one", "+1"]) {
      expect(isTruthy(v)).toBe(true);
    }
  });

  it("rejects blanks and negatives", () => {
    for (const v of ["", "  ", "no", "false", "0", "Primary"]) {
      expect(isTruthy(v)).toBe(false);
    }
  });
});

describe("plus-one origin", () => {
  it("marks a named plus-one row without consuming a slot", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann & Guest,Ann,One,Primary
Group A,Ann & Guest,Guest,Person,Plus One
`,
    );
    const v = validateCsv(rows, { ...detectMapping(headers), isPlusOne: "Category" });
    const h = v.households[0];
    expect(h.guests).toHaveLength(2);
    expect(h.guests.find((g) => g.firstName === "Ann")!.origin).toBe("named");
    expect(h.guests.find((g) => g.firstName === "Guest")!.origin).toBe("plus_one");
    expect(h.plusOneSlots).toBe(0);
    expect(h.maxPartySize).toBe(2);
  });

  it("leaves origin undefined when no plus-one column is mapped", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].guests[0].origin).toBeUndefined();
  });
});
