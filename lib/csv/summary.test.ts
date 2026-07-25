import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";
import { summarize } from "./summary";
import type { CsvValidation, CsvMapping, RowError } from "./types";
import type { ImportHouseholdInput } from "@/lib/data/imports";

type Guest = ImportHouseholdInput["guests"][number];

function g(firstName: string, lastName: string, extra: Partial<Guest> = {}): Guest {
  return { firstName, lastName, ...extra };
}

function household(
  partial: Partial<ImportHouseholdInput> & { displayName: string; guests: Guest[] },
): ImportHouseholdInput {
  return {
    maxPartySize: partial.guests.length,
    plusOneSlots: 0,
    ...partial,
  };
}

const NO_MAPPING: CsvMapping = { firstName: "First Name", lastName: "Last Name" };

describe("summarize", () => {
  it("counts invitations, named guests, and unnamed seats", () => {
    const v: CsvValidation = {
      ok: true,
      errors: [],
      warnings: [],
      households: [
        household({
          displayName: "A",
          maxPartySize: 3,
          guests: [g("Ann", "One"), g("Bob", "Two"), g("Cal", "Three")],
        }),
        household({
          displayName: "B",
          maxPartySize: 2,
          plusOneSlots: 1,
          guests: [g("Dee", "Four")],
        }),
        household({
          displayName: "C",
          maxPartySize: 4,
          plusOneSlots: 1,
          guests: [g("Eve", "Five"), g("Fay", "Six"), g("Gil", "Seven")],
        }),
      ],
    };
    const s = summarize(v, [], NO_MAPPING);
    expect(s.invitations).toBe(3);
    expect(s.namedGuests).toBe(7);
    expect(s.unnamedSeats).toBe(2);
  });

  it("returns every error and warning, never truncated (12 errors + 20 warnings)", () => {
    const errors: RowError[] = Array.from({ length: 12 }, (_, i) => ({
      line: i + 2,
      message: "Missing last name.",
    }));
    const warnings: RowError[] = Array.from({ length: 20 }, (_, i) => ({
      line: i + 100,
      message: `"Household ${i}" names 2 people but has only 1 row — someone may be missing.`,
    }));
    const v: CsvValidation = { ok: false, households: [], errors, warnings };
    const s = summarize(v, [], NO_MAPPING);
    expect(s.problems.errors.length).toBe(12);
    expect(s.problems.warnings.length).toBe(20);
  });

  it("extras is [] when nothing extra was found", () => {
    const v: CsvValidation = {
      ok: true,
      errors: [],
      warnings: [],
      households: [household({ displayName: "A", guests: [g("Ann", "One")] })],
    };
    expect(summarize(v, [], NO_MAPPING).extras).toEqual([]);
  });

  it("extras includes only non-zero categories, with human labels", () => {
    const v: CsvValidation = {
      ok: true,
      errors: [],
      warnings: [],
      households: [
        household({
          displayName: "A",
          guests: [g("Ann", "One")],
          mailingAddress: { raw: "1 Main St", source: "csv" },
        }),
        household({
          displayName: "B",
          guests: [g("Bob", "Two")],
          mailingAddress: { raw: "2 Main St", source: "csv" },
        }),
        household({ displayName: "C", guests: [g("Cal", "Three")] }),
      ],
    };
    expect(summarize(v, [], NO_MAPPING).extras).toEqual([{ label: "mailing addresses", count: 2 }]);
  });

  it("who is the guest's first name when only the last name is missing, and household comes from the row", () => {
    const { headers, rows } = parseCsv("First Name,Last Name,Household\nMiguel,,Miguel Household\n");
    const mapping = detectMapping(headers);
    const v = validateCsv(rows, mapping);
    const s = summarize(v, rows, mapping);
    expect(s.problems.errors).toHaveLength(1);
    const problem = s.problems.errors[0];
    expect(problem.who).toBe("Miguel");
    expect(problem.household).toBe("Miguel Household");
    expect(problem.message).toBe("Missing last name.");
  });

  it("who is never empty and falls back to a decoded, jargon-free group name when no row or name is recoverable", () => {
    const { headers, rows } = parseCsv(
      "First Name,Last Name,Household\n,,Group A\n,,Group A\nAnn,One,Group B\n",
    );
    const mapping = detectMapping(headers);
    const v = validateCsv(rows, mapping);
    const s = summarize(v, rows, mapping);
    const warning = s.problems.warnings.find((w) => w.message.toLowerCase().includes("skipped"));
    expect(warning).toBeDefined();
    expect(warning!.who).not.toBe("");
    expect(warning!.who.toLowerCase()).toContain("group a");
    expect(warning!.household.toLowerCase()).toContain("group a");
    // The engine's internal grouping key must not leak into the user-facing message.
    expect(warning!.message).not.toMatch(/hh:|env:|auto:|\|/);
  });

  it("who and household are never empty even for a whole-import error with no row at all", () => {
    const v = validateCsv([], { firstName: "", lastName: "" });
    const s = summarize(v, [], { firstName: "", lastName: "" });
    expect(s.problems.errors).toHaveLength(1);
    expect(s.problems.errors[0].who).not.toBe("");
    expect(s.problems.errors[0].household).not.toBe("");
  });

  it("preview renders an unnamed seat alongside named guests and seat count", () => {
    const { headers, rows } = parseCsv(
      "First Name,Last Name,Household,Envelope Name\nAnn,One,Group C,Ann One & Guest\n,,Group C,Ann One & Guest\n",
    );
    const mapping = detectMapping(headers);
    const v = validateCsv(rows, mapping);
    const s = summarize(v, rows, mapping);
    const card = s.preview.find((p) => p.displayName === "Ann One & Guest")!;
    expect(card).toBeDefined();
    expect(card.guests).toEqual(["Ann One"]);
    expect(card.seats).toBe(2);
    expect(card.unnamed).toBe(1);
  });
});
