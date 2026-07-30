import { describe, expect, it } from "vitest";
import {
  BudgetCsvError,
  NOT_APPLICABLE_NOTE,
  RECONCILIATION_OVER_ITEMIZED,
  RECONCILIATION_UNDER_ITEMIZED,
  buildBudgetSeedPlan,
  classifyBudgetRow,
  slugifyCategory,
  suggestCategory,
  type BudgetSeedCategory,
  type BudgetSeedItem,
  type BudgetSeedPlan,
} from "./budget";

/**
 * The real spreadsheet, verbatim, as an inline fixture.
 *
 * It lives here rather than being read from disk because the source file sits
 * outside the repo (in the client's Downloads folder) and CI will never have it.
 * Every number asserted below was taken from the client's own sheet, so a
 * regression in the parser shows up as a disagreement with her, not with us.
 */
const SHEET = `Item,Qty,Each,Alisons Wedding Actual Cost,Juliet Estimated Cost,Juliet Actual Cost,Notes
Total Cost,,,"$40,962","$60,170",,
Venue,,,"$8,079","$15,370",,
Venue Rental,1,,"$6,750","$15,370",,
Linen Rental,1,,"$1,277",-,-,
Shot Glasses,1,,$21,-,-,
Banquet Permit (x2),2,$10,$20,-,-,
Masks,1,,$11,-,-,
Photobooth Rental,,,,,,
Food and Beverage,,,"$9,933","$16,500",,
Ceremony Dinner,180,,"$7,426","$9,400",,
"Alcohol, Ice, Non-Alcoholic Drinks (BevMo)",100 liters (abundant),,"$2,138","$4,000",,
Cakes,1,,$204,$200,,
Oranges/Grapefruits/Limes (Costco),1,,$86,$100,,
Flan ,180,,$400,$300,,
Pho Food Truck - late night,,,,$500,,
Taco Food Truck - late night,,,,$500,,
Wedding Party Rehearsal dinner,,,,"$1,500",,
Music + Photography,,,"$6,984","$8,300",,
Photographer/Videographer,1,,"$5,634","$5,000",,
DJ,1,,"$1,350","$1,300",,
Harp - ceremony,,,,$500,,
Band,,,,"$1,500",,
Other Vendors,,,,$500,,
Lion Dance,1,,,$500,,
Attire + Beauty,,,"$4,093","$5,200",,
Juliet Dress 1 - Ceremony,1,,"$1,118","$1,500",,
Juliet Dress 2 - Ao Dai Reception,1,,$448,$800,,
Juliet Dress 3 - Dancing,1,,-,$500,,
Groom's Outfit,1,,"$1,033","$1,000",,
Wedding Bands,1,,$546,"$1,000",,
Alterations ,1,,$436,$0,,
Bride Hair,1,,$253,$200,,
Mani/Pedi,1,,$150,$100,,
Shoes,1,,$65,$100,,
Veil (Etsy),1,,$44,$0,,
Gifts,,,"$4,261","$2,000",,
Groomsmen Gifts,9,,"$1,350",,,
Bridesmaid Gifts,9,,"$1,050",,,
Attendee Party Favor,200,$4.00,$800,,,
Bridesmaids Hair,1,,$670,$0,,
Dad's/Brother's Ties/Socks,2,$40,$145,$0,,
Bach Gift ,13,$9.70,$126,,,
"Flower Girl, Ring Boy Gifts (Outfits + Accessories)",1,$150,$120,,,
Flowers + Decor,,,"$1,722","$5,000",,
Flowers for Centerpieces,25,$25,$625,,,
Flowers for Ceremony Isle/Chairs,,,$0,,,
Bridesmaids Bouqets (10),8,$31,$250,,,
SIGN 1: Welcome sign + easel,1,$200,$200,,,
Flower petals + holder,1,,$137,,,
Eucalyptus,1,,$107,,,
Bride Bouqet (1),1,$75,$75,,,
"Corsages (2 Moms, 1 Grandma, 1 Sister)",4,$19,$75,,,
Guestbook book items,1,$75,$75,,,
Disposable Cameras,5,$14,$68,,,
Vases for Centerpieces,23,$8.70,$32,,,
PRINT: Menus,200,$0.10,$26,,,
Lighters + Candles,1,,$20,,,
SIGN 3: Seating chart sign,1,$40,$20,,,
PRINT: Name tags,100,$0.10,$12,,,
SIGN 2: Drink signs,1,$0,0,,,
FRAME: Guestbook sign,1,$0,0,,,
Card Box,,,0,,,
Wedding Arch,,,0,,,
Wedding Arch Flowers,,,0,,,
"Boutonnieres (1 Groom, 8 Groomsmen + 2 Dads + 1 brother)",,,0,,,
Table numbers,,,0,,,
Printing,,,$355,$300,,
Postage,200,,$116,,,
Save the Dates,100,$1.50,$107,,,
Card Stock,2,$36.38,$73,,,
Thank you notes,1,,$38,,,
Envelopes,1,,$12,,,
Invites,120,,$10,,,
Misc,,,"$2,101","$4,000",,
Wedding Planner,1,,$0,"$3,500",,
Transportation/Shuttle Service,1,,$660,$500,,
Marriage License,1,$71,$71,$0,,
Day of Food (Sandwiches & Breakfast),1,,$70,$0,,
Hotels,,,"$3,433","$3,000",,
Le Family Airbnb (3 nights),1,,"$2,536",,,
J+J Hotel Nights (5),2,,$567,"$1,500",,
Jauregui/Boyd Family Airbnb,1,,$330,,,
Flights,,,$0,"$2,800",,
Mom Flight,,,,$700,,
Dad Flight?,,,,$700,,
Juliet + Juan Flight,,,,"$1,400",,`;

const LABEL = "Alison's wedding";
const plan = buildBudgetSeedPlan(SHEET, { benchmarkLabel: LABEL });

const category = (name: string): BudgetSeedCategory => {
  const found = plan.categories.find((c) => c.name === name);
  if (!found) throw new Error(`no category ${name} in the plan`);
  return found;
};

const itemAtLine = (line: number): BudgetSeedItem => {
  const found = plan.categories.flatMap((c) => c.items).find((i) => i.line === line);
  if (!found) throw new Error(`no item parsed from line ${line}`);
  return found;
};

const codes = (plan_: BudgetSeedPlan, code: string) =>
  plan_.anomalies.filter((a) => a.code === code);

describe("classifyBudgetRow", () => {
  const row = (over: Partial<Parameters<typeof classifyBudgetRow>[0]>) =>
    classifyBudgetRow({ item: "", qty: "", each: "", benchmark: "", estimated: "", ...over });

  it("calls a named row with both totals and no quantity a category", () => {
    expect(row({ item: "Venue", benchmark: "$8,079", estimated: "$15,370" })).toBe("category");
  });

  it("calls a quantified row an item even when it carries both totals", () => {
    // Line 4: the same two money columns as its category header, one row down.
    expect(row({ item: "Venue Rental", qty: "1", benchmark: "$6,750", estimated: "$15,370" })).toBe(
      "item",
    );
  });

  it("calls an unquantified row with only one total an item", () => {
    expect(row({ item: "Band", estimated: "$1,500" })).toBe("item");
    expect(row({ item: "Card Box", benchmark: "0" })).toBe("item");
  });

  it("calls a row with a name and nothing else an item, not a category", () => {
    // Line 9, Photobooth Rental — a live "maybe" that must survive the import.
    expect(row({ item: "Photobooth Rental" })).toBe("item");
  });

  it("recognises the grand-total row by name", () => {
    expect(row({ item: "Total Cost", benchmark: "$40,962", estimated: "$60,170" })).toBe(
      "grand-total",
    );
    expect(row({ item: "total", benchmark: "$1", estimated: "$1" })).toBe("grand-total");
  });

  it("drops a row with no name", () => {
    expect(row({ benchmark: "$5" })).toBe("blank");
  });
});

describe("slugifyCategory", () => {
  it("matches the slugs already seeded in budget_categories", () => {
    expect(slugifyCategory("Venue")).toBe("venue");
    expect(slugifyCategory("Food and Beverage")).toBe("food-and-beverage");
    expect(slugifyCategory("Music + Photography")).toBe("music-and-photography");
    expect(slugifyCategory("Attire + Beauty")).toBe("attire-and-beauty");
    expect(slugifyCategory("Flowers + Decor")).toBe("flowers-and-decor");
    expect(slugifyCategory("Misc")).toBe("misc");
    expect(slugifyCategory("Contingency")).toBe("contingency");
  });

  it("is stable across the punctuation and spacing a rename might introduce", () => {
    expect(slugifyCategory("  flowers  &  decor ")).toBe("flowers-and-decor");
    expect(slugifyCategory("Flowers + Decor!")).toBe("flowers-and-decor");
  });
});

describe("suggestCategory", () => {
  it("folds standard names into the client's own categories", () => {
    expect(suggestCategory("Photography")).toBe("Music + Photography");
    expect(suggestCategory("Videography")).toBe("Music + Photography");
    expect(suggestCategory("Entertainment")).toBe("Music + Photography");
    expect(suggestCategory("Bar")).toBe("Food and Beverage");
    expect(suggestCategory("Catering")).toBe("Food and Beverage");
    expect(suggestCategory("Accommodations")).toBe("Hotels");
    expect(suggestCategory("Rentals")).toBe("Venue");
    expect(suggestCategory("Invitations & Stationery")).toBe("Printing");
    expect(suggestCategory("Contingency")).toBe("Contingency");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(suggestCategory("  hair & makeup ")).toBe("Attire + Beauty");
    expect(suggestCategory("HAIR AND MAKEUP")).toBe("Attire + Beauty");
  });

  it("returns null for a genuinely new name rather than guessing", () => {
    expect(suggestCategory("Fireworks")).toBeNull();
    expect(suggestCategory("Dog handler")).toBeNull();
  });

  it("only ever suggests a category the sheet actually seeds", () => {
    const seeded = new Set([...plan.categories.map((c) => c.name), "Contingency"]);
    const standard = [
      "Venue",
      "Rentals",
      "Catering",
      "Bar",
      "Cake & Dessert",
      "Rehearsal Dinner",
      "Welcome Party",
      "Farewell Brunch",
      "Photography",
      "Videography",
      "Entertainment",
      "Wedding Attire",
      "Hair & Makeup",
      "Florals",
      "Decor",
      "Invitations & Stationery",
      "Gifts",
      "Transportation",
      "Marriage License",
      "Accommodations",
      "Miscellaneous",
      "Contingency",
    ];
    for (const name of standard) {
      const target = suggestCategory(name);
      expect(target, name).not.toBeNull();
      expect(seeded.has(target as string), `${name} -> ${target}`).toBe(true);
    }
  });

  it("leaves Flights and Misc reachable but untargeted by the standard list", () => {
    const targets = new Set(
      ["Venue", "Catering", "Photography", "Florals", "Gifts", "Accommodations"].map((n) =>
        suggestCategory(n),
      ),
    );
    expect(targets.has("Flights")).toBe(false);
    expect(category("Flights").items).toHaveLength(3);
  });
});

describe("buildBudgetSeedPlan — shape", () => {
  it("emits the client's ten categories in sheet order", () => {
    expect(plan.categories.map((c) => c.name)).toEqual([
      "Venue",
      "Food and Beverage",
      "Music + Photography",
      "Attire + Beauty",
      "Gifts",
      "Flowers + Decor",
      "Printing",
      "Misc",
      "Hotels",
      "Flights",
    ]);
    expect(plan.categories.map((c) => c.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("emits 81 items — 75 from the sheet plus 6 reconciliation rows", () => {
    expect(plan.totals.itemCount).toBe(81);
    expect(plan.totals.reconciliationItemCount).toBe(6);
    const fromSheet = plan.categories.flatMap((c) => c.items).filter((i) => i.line !== null);
    expect(fromSheet).toHaveLength(75);
  });

  it("does not emit the grand-total row as a category or an item", () => {
    expect(plan.categories.some((c) => /total/i.test(c.name))).toBe(false);
    expect(plan.categories.flatMap((c) => c.items).some((i) => i.line === 2)).toBe(false);
    expect(plan.printedGrandTotal).toEqual({
      line: 2,
      benchmarkCents: 4096200,
      estimatedCents: 6017000,
    });
  });

  it("numbers items from 1 within each category, reconciliation last", () => {
    for (const c of plan.categories) {
      expect(c.items.map((i) => i.sortOrder)).toEqual(c.items.map((_, index) => index + 1));
      const reconciliation = c.items.filter((i) => i.isReconciliation);
      if (reconciliation.length > 0) {
        expect(c.items[c.items.length - 1].isReconciliation).toBe(true);
      }
    }
  });

  it("parses the same text twice to the same plan", () => {
    expect(buildBudgetSeedPlan(SHEET, { benchmarkLabel: LABEL })).toEqual(plan);
  });
});

describe("buildBudgetSeedPlan — totals", () => {
  it("lands the benchmark on the client's own $40,962", () => {
    expect(plan.totals.benchmarkCents).toBe(4096200);
  });

  it("computes the forecast rather than trusting the sheet's $60,170", () => {
    expect(plan.totals.estimatedCents).toBe(6247000);
    expect(plan.printedGrandTotal.estimatedCents).toBe(6017000);
  });

  it("adds each category's items to the category's own total", () => {
    for (const c of plan.categories) {
      const bench = c.items.reduce((t, i) => t + (i.benchmarkCents ?? 0), 0);
      const est = c.items.reduce((t, i) => t + (i.estimatedCents ?? 0), 0);
      expect(c.benchmarkCents, c.name).toBe(bench);
      expect(c.estimatedCents, c.name).toBe(est);
    }
    expect(plan.categories.reduce((t, c) => t + c.benchmarkCents, 0)).toBe(4096200);
    expect(plan.categories.reduce((t, c) => t + c.estimatedCents, 0)).toBe(6247000);
  });

  // One expect per category, and each also pins the difference from the printed
  // header, so a regression cannot hide inside a total that still adds up.
  const expected: Array<[string, number, number, number, number]> = [
    // name, benchmark, estimate, benchmark drift from header, estimate drift
    ["Venue", 807900, 1537000, 0, 0],
    ["Food and Beverage", 993300, 1650000, 0, 0],
    ["Music + Photography", 698400, 830000, 0, 0],
    ["Attire + Beauty", 409300, 520000, 0, 0],
    ["Gifts", 426100, 200000, 0, 0],
    ["Flowers + Decor", 172200, 500000, 0, 0],
    ["Printing", 35600, 30000, 100, 0],
    ["Misc", 210100, 400000, 0, 0],
    ["Hotels", 343300, 300000, 0, 0],
    ["Flights", 0, 280000, 0, 0],
  ];

  for (const [name, bench, est, benchDrift, estDrift] of expected) {
    it(`${name} totals ${bench} / ${est}`, () => {
      const c = category(name);
      expect(c.benchmarkCents).toBe(bench);
      expect(c.estimatedCents).toBe(est);
      expect(c.benchmarkCents - (c.headerBenchmarkCents ?? 0)).toBe(benchDrift);
      expect(c.estimatedCents - (c.headerEstimatedCents ?? 0)).toBe(estDrift);
    });
  }
});

describe("buildBudgetSeedPlan — money cells", () => {
  it('reads "$1,277" as 127700', () => {
    expect(itemAtLine(5).benchmarkCents).toBe(127700);
  });

  it('reads "$8.70" to the cent, not the dollar', () => {
    expect(itemAtLine(56).unitPriceCents).toBe(870);
    expect(itemAtLine(70).unitPriceCents).toBe(150);
    expect(itemAtLine(71).unitPriceCents).toBe(3638);
    expect(itemAtLine(57).unitPriceCents).toBe(10);
    expect(itemAtLine(40).unitPriceCents).toBe(400);
  });

  it('reads "-" as null and says so on the item', () => {
    const dress = itemAtLine(29);
    expect(dress.benchmarkCents).toBeNull();
    expect(dress.notes).toContain("not applicable");
    for (const line of [5, 6, 7, 8]) {
      expect(itemAtLine(line).estimatedCents, `line ${line}`).toBeNull();
      expect(itemAtLine(line).notes, `line ${line}`).toContain(NOT_APPLICABLE_NOTE);
    }
  });

  it("reads a blank cell as null with no note — blank and a dash are different claims", () => {
    const photobooth = itemAtLine(9);
    expect(photobooth.benchmarkCents).toBeNull();
    expect(photobooth.estimatedCents).toBeNull();
    expect(photobooth.qty).toBeNull();
    expect(photobooth.unitPriceCents).toBeNull();
    expect(photobooth.notes).toBeNull();
  });

  it("keeps zero distinct from null", () => {
    for (const line of [61, 62, 63, 64, 65, 66, 67]) {
      expect(itemAtLine(line).benchmarkCents, `line ${line}`).toBe(0);
    }
    expect(itemAtLine(47).benchmarkCents).toBe(0);
    expect(itemAtLine(76).benchmarkCents).toBe(0);
    for (const line of [38, 39, 40, 43, 44]) {
      expect(itemAtLine(line).estimatedCents, `line ${line}`).toBeNull();
    }
    expect(itemAtLine(41).estimatedCents).toBe(0);
    expect(itemAtLine(32).estimatedCents).toBe(0);
  });

  it('keeps qty as text, so "100 liters (abundant)" survives', () => {
    expect(itemAtLine(12).qty).toBe("100 liters (abundant)");
    expect(itemAtLine(12).benchmarkCents).toBe(213800);
    expect(itemAtLine(11).qty).toBe("180");
  });

  it("trims names and changes nothing else about them", () => {
    expect(itemAtLine(15).name).toBe("Flan");
    expect(itemAtLine(32).name).toBe("Alterations");
    expect(itemAtLine(43).name).toBe("Bach Gift");
    expect(itemAtLine(48).name).toBe("Bridesmaids Bouqets (10)");
    expect(itemAtLine(12).name).toBe("Alcohol, Ice, Non-Alcoholic Drinks (BevMo)");
  });

  it("throws with the line number on an unreadable cell", () => {
    const broken = SHEET.replace("Cakes,1,,$204", "Cakes,1,,$2o4");
    expect(() => buildBudgetSeedPlan(broken)).toThrow(BudgetCsvError);
    expect(() => buildBudgetSeedPlan(broken)).toThrow(/Line 13/);
  });

  it("refuses a sheet whose columns are not in benchmark → estimate → actual order", () => {
    const swapped = SHEET.replace(
      "Alisons Wedding Actual Cost,Juliet Estimated Cost",
      "Juliet Estimated Cost,Alisons Wedding Actual Cost",
    );
    expect(() => buildBudgetSeedPlan(swapped)).toThrow(/benchmark/);
  });
});

describe("buildBudgetSeedPlan — the sheet's own arithmetic", () => {
  it("F1: seeds Flan at the figure both of the sheet's totals were built from", () => {
    const flan = itemAtLine(15);
    expect(flan.benchmarkCents).toBe(7900);
    expect(flan.notes).toContain("$400");
    expect(flan.notes).toContain("$79");
    const [f1] = codes(plan, "F1");
    expect(f1.line).toBe(15);
    expect(f1.resolution).toContain("$79");
  });

  it("F1: skips the correction and says so if the sheet has changed", () => {
    const revised = buildBudgetSeedPlan(SHEET.replace("Flan ,180,,$400", "Flan ,180,,$79"));
    expect(codes(revised, "F1")).toHaveLength(0);
    expect(codes(revised, "F1-stale")).toHaveLength(1);
    expect(codes(revised, "F1-stale")[0].resolution).toContain("NOT applied");
  });

  it("P1: leaves a sub-dollar category gap alone rather than inventing a row", () => {
    const [p1] = codes(plan, "P1");
    expect(p1.category).toBe("Printing");
    expect(category("Printing").items.filter((i) => i.isReconciliation)).toHaveLength(1);
    expect(
      category("Printing").items.find((i) => i.isReconciliation)?.benchmarkCents,
    ).toBeNull();
  });

  it("R1: carries un-itemized budget into one visible row per category", () => {
    const under = plan.categories
      .flatMap((c) => c.items.map((i) => ({ c, i })))
      .filter(({ i }) => i.name === RECONCILIATION_UNDER_ITEMIZED);
    expect(under.map(({ c }) => c.name)).toEqual([
      "Gifts",
      "Flowers + Decor",
      "Printing",
      "Misc",
      "Hotels",
    ]);
    expect(under.map(({ i }) => i.estimatedCents)).toEqual([200000, 500000, 30000, null, 150000]);
    expect(under.map(({ i }) => i.benchmarkCents)).toEqual([null, null, null, 130000, null]);
    for (const { i } of under) expect(i.isReconciliation).toBe(true);
  });

  it("R2: carries a stale total into one negative row", () => {
    const music = category("Music + Photography");
    const row = music.items[music.items.length - 1];
    expect(row.name).toBe(RECONCILIATION_OVER_ITEMIZED);
    expect(row.estimatedCents).toBe(-100000);
    expect(row.benchmarkCents).toBeNull();
    expect(row.notes).toContain("$8,300");
    expect(row.notes).toContain("$9,300");
  });

  it("names the benchmark from data, never from a constant", () => {
    const misc = category("Misc").items.find((i) => i.isReconciliation);
    expect(misc?.notes).toContain(LABEL);
    const anonymous = buildBudgetSeedPlan(SHEET);
    const same = anonymous.categories
      .find((c) => c.name === "Misc")
      ?.items.find((i) => i.isReconciliation);
    expect(same?.notes).toContain("the reference wedding");
    expect(same?.notes).not.toContain(LABEL);
  });

  it("creates exactly six reconciliation rows and no others", () => {
    const rows = plan.categories.flatMap((c) => c.items).filter((i) => i.isReconciliation);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.line === null)).toBe(true);
    expect(rows.reduce((t, r) => t + (r.benchmarkCents ?? 0), 0)).toBe(130000);
    expect(rows.reduce((t, r) => t + (r.estimatedCents ?? 0), 0)).toBe(780000);
  });

  it("E2: flags every row where qty × each disagrees with the recorded cost by a dollar or more", () => {
    expect(codes(plan, "E2").map((a) => a.line)).toEqual([42, 44, 48, 53, 55, 56, 57, 59, 60, 70]);
    const vases = codes(plan, "E2").find((a) => a.line === 56);
    expect(vases?.message).toContain("$200.10");
    expect(vases?.message).toContain("$32");
    expect(vases?.resolution).toContain("Recorded cost wins");
    // Never multiplied into the stored figure.
    expect(itemAtLine(56).benchmarkCents).toBe(3200);
    expect(itemAtLine(70).benchmarkCents).toBe(10700);
  });

  it("E3: separates sub-dollar rounding from a real disagreement", () => {
    expect(codes(plan, "E3").map((a) => a.line)).toEqual([43, 71]);
  });

  it("Q1: flags a count in the name that disagrees with the quantity", () => {
    expect(codes(plan, "Q1").map((a) => a.line)).toEqual([48, 82]);
    expect(itemAtLine(48).qty).toBe("8");
    expect(itemAtLine(48).name).toContain("(10)");
  });

  it("G1/G2: reports the grand-total row against both the categories and the items", () => {
    const [g1] = plan.variances.filter((v) => v.code === "G1");
    expect(g1).toMatchObject({
      column: "benchmark",
      printedCents: 4096200,
      headerCents: 4096100,
      computedCents: 4096200,
      differenceCents: 0,
    });
    const [g2] = plan.variances.filter((v) => v.code === "G2");
    expect(g2).toMatchObject({
      column: "estimated",
      printedCents: 6017000,
      headerCents: 6247000,
      computedCents: 6247000,
      differenceCents: 230000,
    });
    expect(codes(plan, "G2")).toHaveLength(1);
    expect(codes(plan, "G1")).toHaveLength(1); // categories are a dollar light
  });

  it("reports every anomaly it acted on, each with a resolution", () => {
    for (const a of plan.anomalies) {
      expect(a.message.length, a.code).toBeGreaterThan(0);
      expect(a.resolution.length, a.code).toBeGreaterThan(0);
    }
    expect(new Set(plan.anomalies.map((a) => a.code))).toEqual(
      new Set(["F1", "P1", "E2", "E3", "Q1", "R1", "R2", "G1", "G2"]),
    );
  });
});

describe("buildBudgetSeedPlan — synthetic sheets", () => {
  const synthetic = (rows: string) =>
    `Item,Qty,Each,Reference Actual Cost,Estimated Cost,Our Actual Cost,Notes\n${rows}`;

  it("turns a header below its rows into a negative reconciliation", () => {
    const built = buildBudgetSeedPlan(
      synthetic(["Cake,,,$100,$100,,", "Layer one,1,,$60,$60,,", "Layer two,1,,$60,$60,,"].join("\n")),
    );
    const cake = built.categories[0];
    expect(cake.items).toHaveLength(3);
    const last = cake.items[2];
    expect(last.name).toBe(RECONCILIATION_OVER_ITEMIZED);
    expect(last.estimatedCents).toBe(-2000);
    expect(last.benchmarkCents).toBe(-2000);
    expect(cake.benchmarkCents).toBe(10000);
    expect(cake.estimatedCents).toBe(10000);
  });

  it("turns a header above its rows into a positive reconciliation", () => {
    const built = buildBudgetSeedPlan(
      synthetic(["Cake,,,$100,$100,,", "Layer one,1,,$40,$40,,"].join("\n")),
    );
    const last = built.categories[0].items[1];
    expect(last.name).toBe(RECONCILIATION_UNDER_ITEMIZED);
    expect(last.benchmarkCents).toBe(6000);
    expect(last.estimatedCents).toBe(6000);
  });

  it("refuses an item that appears before any category", () => {
    expect(() => buildBudgetSeedPlan(synthetic("Layer one,1,,$60,$60,,"))).toThrow(
      /before any category/,
    );
  });

  it("refuses two categories with the same name", () => {
    expect(() =>
      buildBudgetSeedPlan(synthetic(["Cake,,,$100,$100,,", "Cake,,,$100,$100,,"].join("\n"))),
    ).toThrow(/appears twice/);
  });

  it("refuses two items with the same name in one category, which a re-run could not tell apart", () => {
    expect(() =>
      buildBudgetSeedPlan(
        synthetic(["Cake,,,$100,$100,,", "Layer,1,,$50,$50,,", "layer,1,,$50,$50,,"].join("\n")),
      ),
    ).toThrow(/appears twice/);
  });

  it("refuses a second grand-total row", () => {
    expect(() =>
      buildBudgetSeedPlan(
        synthetic(["Total,,,$100,$100,,", "Total Cost,,,$100,$100,,", "Cake,,,$100,$100,,"].join("\n")),
      ),
    ).toThrow(/second grand-total/);
  });
});
