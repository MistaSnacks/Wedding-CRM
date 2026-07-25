import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

const CSV = `First Name,Last Name,Household,Email,Age Type,Plus Ones
John,Smith,The Smith Family,sarah@example.com,adult,0
Sarah,Smith,The Smith Family,sarah@example.com,adult,0
Emma,Smith,The Smith Family,sarah@example.com,child,0
Jane,Doe,,jane@example.com,adult,1
`;

describe("csv import", () => {
  it("parses and auto-detects mapping", () => {
    const { headers, rows } = parseCsv(CSV);
    expect(rows).toHaveLength(4);
    const m = detectMapping(headers);
    expect(m.firstName).toBe("First Name");
    expect(m.lastName).toBe("Last Name");
    expect(m.household).toBe("Household");
    expect(m.email).toBe("Email");
    expect(m.plusOneSlots).toBe("Plus Ones");
  });

  it("groups by household column and auto-groups singles", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(2);
    const smiths = v.households.find((h) => h.displayName === "The Smith Family")!;
    expect(smiths.guests).toHaveLength(3);
    expect(smiths.guests[2].ageType).toBe("child");
    expect(smiths.maxPartySize).toBe(3);
    const jane = v.households.find((h) => h.displayName === "Jane Doe")!;
    expect(jane.plusOneSlots).toBe(1);
    expect(jane.maxPartySize).toBe(2); // 1 guest + 1 plus-one slot
  });

  it("reports missing-name rows with line numbers", () => {
    const { headers, rows } = parseCsv("First Name,Last Name\nJohn,\n,Smith\n");
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(false);
    expect(v.errors).toHaveLength(2);
    expect(v.errors[0].line).toBe(2);
    expect(v.errors[1].line).toBe(3);
  });

  it("fails without a name mapping", () => {
    const v = validateCsv([], { firstName: "", lastName: "" });
    expect(v.ok).toBe(false);
    expect(v.errors[0].message).toContain("First name");
  });

  it("flags bad emails and undersized parties", () => {
    const { headers, rows } = parseCsv(
      "First Name,Last Name,Email,Max Party Size\nJohn,Smith,not-an-email,0\n",
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.message.includes("email"))).toBe(true);
  });
});
