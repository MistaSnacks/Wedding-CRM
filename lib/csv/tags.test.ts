import { describe, it, expect } from "vitest";
import { parseCsv, validateCsv, detectMapping } from "./index";

const CSV = `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann One,Ann,One,Friends
Group A,Ann One,Bob,One,Friends
Group B,Cara Two,Cara,Two,Colleagues
`;

describe("tag mapping", () => {
  it("collects mapped column values as tags", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, { ...detectMapping(headers), tags: [{ column: "Category" }] });
    const a = v.households.find((h) => h.displayName === "Ann One")!;
    expect(a.tags).toEqual(["Friends"]);
  });

  it("applies a per-column prefix", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, {
      ...detectMapping(headers),
      tags: [{ column: "Category" }, { column: "Household", prefix: "family:" }],
    });
    const a = v.households.find((h) => h.displayName === "Ann One")!;
    expect(a.tags!.sort()).toEqual(["Friends", "family:Group A"]);
  });

  it("deduplicates across rows and drops blanks", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Category
Group C,Dan,Three,VIP
Group C,Eve,Three,VIP
Group C,Fay,Three,
`,
    );
    const v = validateCsv(rows, { ...detectMapping(headers), tags: [{ column: "Category" }] });
    expect(v.households[0].tags).toEqual(["VIP"]);
  });

  it("omits tags entirely when no tag columns are mapped", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].tags).toBeUndefined();
  });

  it("collects distinct tag values from every row in a household, not just the first", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Category
Group D,Gil,Four,Friends
Group D,Hana,Four,VIP
`,
    );
    const v = validateCsv(rows, { ...detectMapping(headers), tags: [{ column: "Category" }] });
    expect(v.households[0].tags!.sort()).toEqual(["Friends", "VIP"]);
  });
});
