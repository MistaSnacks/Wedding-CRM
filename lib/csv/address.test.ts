import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

describe("mailing address", () => {
  it("stores structured columns", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Street Address,City,State,Zip,Country
Ann,One,1 Main St,Springfield,CA,90001,USA
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress).toEqual({
      street: "1 Main St",
      city: "Springfield",
      state: "CA",
      zip: "90001",
      country: "USA",
      source: "csv",
    });
  });

  it("stores free text verbatim without parsing", () => {
    const messy = "114-0024  Japan Tokyo  Kita-ku, Nishigahara 1-46-14";
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Mailing Address\nAnn,One,"${messy}"\n`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress).toEqual({ raw: messy, source: "csv" });
  });

  it("takes the first row in the group that has address data", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Mailing Address
Group A,Ann,One,
Group A,Bob,One,2 Oak Ave
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress?.raw).toBe("2 Oak Ave");
  });

  it("does not top up an earlier row's address with a later row's fields", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,City,State
Group A,Ann,One,Springfield,
Group A,Bob,One,,CA
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress).toEqual({ city: "Springfield", source: "csv" });
  });

  it("omits the field entirely when no address data exists", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress).toBeUndefined();
  });
});
