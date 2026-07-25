import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

const CONTEXT = {
  events: [],
  mealOptions: [
    { id: "meal-1", name: "Chicken" },
    { id: "meal-2", name: "Kids Meal" },
  ],
};

describe("meal, dietary and notes mapping", () => {
  it("resolves a meal name case-insensitively against the wedding's own options", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Meal Choice\nAnn,One,chicken\n`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.households[0].guests[0].mealOptionId).toBe("meal-1");
  });

  it("warns and leaves the meal unset when it does not match", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Meal Choice\nAnn,One,Lobster\n`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.ok).toBe(true);
    expect(v.households[0].guests[0].mealOptionId).toBeUndefined();
    expect(v.warnings.some((w) => w.message.includes("Lobster"))).toBe(true);
  });

  it("treats 'None' dietary values as no restriction", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Dietary Restrictions
Ann,One,None
Bob,Two,Gluten-free
`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    const ann = v.households.find((h) => h.displayName === "Ann One")!;
    const bob = v.households.find((h) => h.displayName === "Bob Two")!;
    expect(ann.guests[0].dietaryRestrictions).toBeUndefined();
    expect(bob.guests[0].dietaryRestrictions).toBe("Gluten-free");
  });

  it("joins distinct notes across a household's rows", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Notes
Group A,Ann,One,Needs parking
Group A,Bob,One,Needs parking
Group A,Cal,One,Arriving late
`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.households[0].internalNotes).toBe("Needs parking\nArriving late");
  });

  it("works with no context supplied", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
  });
});
