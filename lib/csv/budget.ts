/**
 * The budget spreadsheet parser: one CSV of interleaved category and item rows
 * in, one fully-resolved seed plan out.
 *
 * The source sheet is not a normalised export. It is a working document a human
 * has been editing for months, and it has the shape that implies:
 *
 * - **Category rows are interleaved with item rows.** A category row carries a
 *   name and two totals but no per-item detail; the rows beneath it, until the
 *   next category row, are its items. There is no `Category` column to group on.
 * - **Its own arithmetic does not always add up.** Six categories disagree with
 *   the sum of their own children, and the grand-total row disagrees with the
 *   category rows on both money columns. Every one of those gaps is either
 *   carried into a visible reconciliation row or reported as an anomaly. None is
 *   silently averaged away — a budget tool that quietly "fixes" a number the
 *   owner can still see in her spreadsheet has destroyed her trust in every
 *   other number on the page.
 * - **Blank, `-` and `0` are three different claims.** Blank is "not broken
 *   out", `-` is "not applicable", `0` is "priced it, it is free". They are
 *   stored as `null`, `null`-plus-a-note, and `0`. Collapsing any pair of them
 *   distorts every delta the budget screens draw.
 *
 * Nothing here touches the network, the clock or the filesystem, so all of it is
 * unit-tested against the real rows in `budget.test.ts`. The seed script under
 * `scripts/` is a thin shell over `buildBudgetSeedPlan`: parsing money twice, in
 * two languages, is how a $321 error shipped into the sheet this file reads.
 *
 * The reference wedding's real name never appears here. It arrives as
 * `benchmarkLabel`, read from `weddings.budget_benchmark_label`, exactly as
 * `formatDelta` takes it — the couple can rename it, and no other couple's copy
 * of this product should carry a stranger's name in its source.
 *
 * Pattern-mates: `lib/csv/detect.ts` (header aliasing), `lib/format/money.ts`
 * (every cents conversion in the app).
 */

import Papa from "papaparse";
import { MoneyParseError, formatMoney, parseMoneyInput } from "@/lib/format/money";

/** Gaps at or under one dollar are the sheet's whole-dollar display rounding. */
export const ROUNDING_TOLERANCE_CENTS = 100;

/** A category whose header is *above* its rows has money it has not broken out. */
export const RECONCILIATION_UNDER_ITEMIZED = "Not yet itemized";

/** A category whose header is *below* its rows has a stale total formula. */
export const RECONCILIATION_OVER_ITEMIZED = "Spreadsheet reconciliation";

/** Appended to an item whose money cell was an explicit dash rather than blank. */
export const NOT_APPLICABLE_NOTE =
  'Marked "—" (not applicable) in the source spreadsheet.';

/** What a money cell actually said, before it became `number | null`. */
export type MoneyCellSource = "blank" | "not-applicable" | "value";

/** What a row turned out to be. `blank` rows are dropped without comment. */
export type BudgetRowKind = "grand-total" | "category" | "item" | "blank";

/** The five cells `classifyBudgetRow` needs, already trimmed. */
export type BudgetRowCells = {
  item: string;
  qty: string;
  each: string;
  benchmark: string;
  estimated: string;
};

/** One seeded `budget_items` row, in the column names the script writes. */
export type BudgetSeedItem = {
  /** 1-based line in the source file. `null` for rows this module synthesised. */
  line: number | null;
  name: string;
  /** Verbatim text — the sheet says `100 liters (abundant)` on one row. */
  qty: string | null;
  unitPriceCents: number | null;
  benchmarkCents: number | null;
  estimatedCents: number | null;
  notes: string | null;
  isReconciliation: boolean;
  /** 1-based within its category, in sheet order; reconciliation rows last. */
  sortOrder: number;
};

/** One category, with its printed header figures kept beside the resolved ones. */
export type BudgetSeedCategory = {
  line: number | null;
  name: string;
  /** Stable machine key; matches `budget_categories.slug`. */
  slug: string;
  sortOrder: number;
  /** Exactly what the category row printed. Provenance, never a total. */
  headerBenchmarkCents: number | null;
  headerEstimatedCents: number | null;
  /** The sum of `items` after corrections and reconciliation. */
  benchmarkCents: number;
  estimatedCents: number;
  items: BudgetSeedItem[];
};

/** Something about the source that a human has to decide, not this module. */
export type BudgetAnomaly = {
  /** Short stable code so the report, the tests and the client email agree. */
  code: string;
  line: number | null;
  category: string | null;
  item: string | null;
  /** What the sheet says. */
  message: string;
  /** What this module did about it, in the same breath. */
  resolution: string;
};

/** The printed grand-total row against what the category rows actually add to. */
export type BudgetVariance = {
  code: string;
  column: "benchmark" | "estimated";
  /** What the grand-total row prints. */
  printedCents: number | null;
  /** What the ten category rows add to. */
  headerCents: number;
  /** What the seeded items add to — the only figure the app uses. */
  computedCents: number;
  differenceCents: number;
  explanation: string;
};

export type BudgetSeedPlan = {
  categories: BudgetSeedCategory[];
  totals: {
    benchmarkCents: number;
    estimatedCents: number;
    categoryCount: number;
    itemCount: number;
    reconciliationItemCount: number;
  };
  /** Line 2 of the sheet, parsed but never trusted. */
  printedGrandTotal: {
    line: number | null;
    benchmarkCents: number | null;
    estimatedCents: number | null;
  };
  variances: BudgetVariance[];
  anomalies: BudgetAnomaly[];
};

export type BuildBudgetSeedPlanOptions = {
  /**
   * How to name the benchmark wedding in generated notes. Never defaulted to a
   * real person: binding decision 2 keeps that name in the database.
   */
  benchmarkLabel?: string;
};

/**
 * `"Music + Photography"` → `"music-and-photography"`.
 *
 * The slug is the only stable key a category has. Its name is Juliet's and she
 * may rename it at any time; re-running the seed after a rename must find the
 * same row rather than creating a second one. `+` becomes `and` because that is
 * how the migration's seeded slugs read, and a slug that disagrees with the
 * seeded rows would silently fork the taxonomy in two.
 */
export function slugifyCategory(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, " and ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Category row, item row, the grand total, or nothing at all.
 *
 * This is the one inference the whole parse rests on, so it is a named, pure,
 * separately-tested function rather than a condition buried in a loop.
 *
 * The rule is structural, not a list of known names: **a category row names
 * something, quantifies nothing, and carries both totals.** An item row always
 * fails at least one of those — the un-costed "maybe" rows (`Photobooth
 * Rental`, `Band`, `Mom Flight`) have an empty benchmark, the DIY rows (`Card
 * Box`, `Wedding Arch`) have an empty estimate, and every priced row that could
 * pass on money alone carries a quantity.
 *
 * A name-list rule was the alternative and is worse: it cannot see a category
 * the client adds next month, and it would classify her `Other Vendors` *item*
 * as a category purely because a category of that name exists in the database.
 * That specific mistake is already in this project's migration.
 */
export function classifyBudgetRow(cells: BudgetRowCells): BudgetRowKind {
  const name = cells.item.trim();
  if (name === "") return "blank";
  if (/^total(\s+cost)?$/i.test(name)) return "grand-total";

  const quantified = cells.qty.trim() !== "" || cells.each.trim() !== "";
  const bothTotals = cells.benchmark.trim() !== "" && cells.estimated.trim() !== "";
  return !quantified && bothTotals ? "category" : "item";
}

/**
 * The generic wedding-budget vocabulary, folded into the client's own categories.
 *
 * Her ten groups are the app's category list and the standard list is *not*
 * seeded over the top of them: her sheet compares her numbers with the benchmark
 * wedding's in the same ten buckets, and re-bucketing either side would destroy
 * the only comparison this module exists to make. "Music + Photography" is one
 * decision to her; splitting it into Photography / Videography / Entertainment
 * would make the app disagree with her spreadsheet on day one.
 *
 * The standard names survive as suggestions, so that "Add a category →
 * Photography" offers to file it under the category she already has instead of
 * quietly creating a duplicate.
 */
export const STANDARD_CATEGORY_CROSSWALK: Readonly<Record<string, string>> = Object.freeze({
  venue: "Venue",
  rentals: "Venue",
  catering: "Food and Beverage",
  bar: "Food and Beverage",
  "cake and dessert": "Food and Beverage",
  "rehearsal dinner": "Food and Beverage",
  "welcome party": "Food and Beverage",
  "farewell brunch": "Food and Beverage",
  photography: "Music + Photography",
  videography: "Music + Photography",
  entertainment: "Music + Photography",
  "wedding attire": "Attire + Beauty",
  "hair and makeup": "Attire + Beauty",
  florals: "Flowers + Decor",
  decor: "Flowers + Decor",
  "invitations and stationery": "Printing",
  gifts: "Gifts",
  transportation: "Misc",
  "marriage license": "Misc",
  accommodations: "Hotels",
  miscellaneous: "Misc",
  contingency: "Contingency",
});

/**
 * Which of the client's categories a standard name belongs in, or `null` when it
 * is genuinely new and the UI should offer to create it.
 *
 * Matching is on the slug, so `"  Hair & Makeup "`, `"hair and makeup"` and
 * `"Hair + Makeup"` are the same question.
 */
export function suggestCategory(standardName: string): string | null {
  return STANDARD_CATEGORY_CROSSWALK[slugifyCategory(standardName).replace(/-/g, " ")] ?? null;
}

/**
 * Cells this module overrides, with the evidence for each.
 *
 * A correction is not a guess and it is not general logic — it is a specific
 * disagreement inside the source that the client's own totals already resolve.
 * Each one is matched on line, name *and* printed value: if the client sends a
 * revised sheet where any of those has moved, the correction is skipped and an
 * anomaly says so, rather than silently rewriting a different row.
 */
const DOCUMENTED_CORRECTIONS: ReadonlyArray<{
  code: string;
  line: number;
  itemName: string;
  column: "benchmark" | "estimated";
  printedCents: number;
  correctedCents: number;
  evidence: string;
}> = Object.freeze([
  {
    code: "F1",
    line: 15,
    itemName: "Flan",
    column: "benchmark",
    printedCents: 40000,
    correctedCents: 7900,
    // 7426 + 2138 + 204 + 86 + 79 = 9933, the printed category total, and the
    // same 79 is inside the printed grand total. Two of the sheet's three
    // figures agree on 79; only this cell says 400.
    evidence: "Both its own category total and the grand total were calculated with",
  },
]);

/** Column indices, resolved from the header row rather than assumed. */
type ColumnIndex = {
  item: number;
  qty: number;
  each: number;
  benchmark: number;
  estimated: number;
};

/**
 * Find the six columns by meaning, never by position and never by anyone's name.
 *
 * The two "actual cost" columns are told apart by order: this sheet reads
 * benchmark, then estimate, then the couple's own actual, so the first actual
 * column is the benchmark and the last is theirs. That ordering is asserted
 * below, so a re-ordered sheet fails loudly instead of importing the wrong
 * money into the benchmark column, which is the single most damaging thing this
 * parser could do quietly.
 */
function resolveColumns(header: string[]): ColumnIndex {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (test: (h: string) => boolean) => norm.findIndex(test);
  const findAll = (test: (h: string) => boolean) =>
    norm.map((h, i) => (test(h) ? i : -1)).filter((i) => i >= 0);

  const item = find((h) => /^(item|description|line item)\b/.test(h));
  const qty = find((h) => /^(qty|quantity)\b/.test(h));
  const each = find((h) => /^(each|unit)\b/.test(h));
  const actuals = findAll((h) => /actual/.test(h));
  const estimates = findAll((h) => /estimat|budget/.test(h));

  if (item < 0) throw new BudgetCsvError("No 'Item' column in the header row.");
  if (qty < 0) throw new BudgetCsvError("No 'Qty' column in the header row.");
  if (each < 0) throw new BudgetCsvError("No 'Each' column in the header row.");
  if (actuals.length < 2) {
    throw new BudgetCsvError(
      "Expected two 'actual cost' columns (the reference wedding's and the couple's).",
    );
  }
  if (estimates.length !== 1) {
    throw new BudgetCsvError("Expected exactly one estimate column in the header row.");
  }

  const benchmark = actuals[0];
  const estimated = estimates[0];
  if (!(benchmark < estimated && estimated < actuals[actuals.length - 1])) {
    throw new BudgetCsvError(
      "Columns are not in the expected benchmark → estimate → actual order; refusing to guess which actual column is the benchmark.",
    );
  }
  return { item, qty, each, benchmark, estimated };
}

/** Thrown for anything the parser will not coerce. Always names the line. */
export class BudgetCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetCsvError";
  }
}

/**
 * A money cell, keeping *why* it is empty.
 *
 * `parseMoneyInput` returns `null` for both a blank and a dash, which is right
 * for storage and wrong for provenance: blank means "not broken out" and a dash
 * means "does not apply to this wedding", and the client can tell them apart in
 * her own sheet. The distinction survives as a note on the item.
 */
function readMoneyCell(
  raw: string,
  line: number,
  column: string,
): { cents: number | null; source: MoneyCellSource } {
  const trimmed = raw.trim();
  if (trimmed === "") return { cents: null, source: "blank" };
  if (/^[-–—]$/.test(trimmed)) return { cents: null, source: "not-applicable" };
  try {
    return { cents: parseMoneyInput(trimmed), source: "value" };
  } catch (error) {
    const detail = error instanceof MoneyParseError ? error.message : String(error);
    throw new BudgetCsvError(`Line ${line}, ${column}: cannot read ${JSON.stringify(raw)} — ${detail}`);
  }
}

/** `null` unless the text is nothing but digits — `100 liters` is not a count. */
function numericQty(qty: string | null): number | null {
  if (qty === null || !/^\d+$/.test(qty.trim())) return null;
  return Number(qty.trim());
}

/** Sum treating `null` as absent, never as zero. Zero is a real, different claim. */
function sumKnown(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function joinNotes(parts: Array<string | null>): string | null {
  const kept = parts.filter((p): p is string => p !== null && p.trim() !== "");
  return kept.length === 0 ? null : kept.join(" ");
}

/**
 * Parse the sheet and resolve every disagreement it has with itself.
 *
 * The returned plan is complete: the seed script chooses no numbers of its own,
 * so what the tests assert here is exactly what reaches the database.
 */
export function buildBudgetSeedPlan(
  text: string,
  options: BuildBudgetSeedPlanOptions = {},
): BudgetSeedPlan {
  const benchmarkLabel = options.benchmarkLabel ?? "the reference wedding";

  // `header: false` on purpose. The row index *is* the line number the client
  // sees in her spreadsheet, and every anomaly this module reports is only
  // actionable if it names a line she can open and look at.
  const parsed = Papa.parse<string[]>(text.replace(/\r\n?/g, "\n").replace(/\n+$/, ""), {
    header: false,
    skipEmptyLines: false,
  });
  const rows = parsed.data ?? [];
  if (rows.length < 2) throw new BudgetCsvError("The file has no rows beneath its header.");

  const columns = resolveColumns(rows[0] ?? []);
  const cellAt = (row: string[], index: number) => (row[index] ?? "").trim();

  const anomalies: BudgetAnomaly[] = [];
  const categories: BudgetSeedCategory[] = [];
  const printedGrandTotal: BudgetSeedPlan["printedGrandTotal"] = {
    line: null,
    benchmarkCents: null,
    estimatedCents: null,
  };

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const line = index + 1;
    const cells: BudgetRowCells = {
      item: cellAt(row, columns.item),
      qty: cellAt(row, columns.qty),
      each: cellAt(row, columns.each),
      benchmark: cellAt(row, columns.benchmark),
      estimated: cellAt(row, columns.estimated),
    };
    const kind = classifyBudgetRow(cells);
    if (kind === "blank") continue;

    if (kind === "grand-total") {
      if (printedGrandTotal.line !== null) {
        throw new BudgetCsvError(
          `Line ${line}: a second grand-total row. One sheet cannot have two totals.`,
        );
      }
      printedGrandTotal.line = line;
      printedGrandTotal.benchmarkCents = readMoneyCell(cells.benchmark, line, "total benchmark").cents;
      printedGrandTotal.estimatedCents = readMoneyCell(cells.estimated, line, "total estimate").cents;
      continue;
    }

    if (kind === "category") {
      const name = cells.item.trim();
      const slug = slugifyCategory(name);
      if (categories.some((c) => c.slug === slug)) {
        throw new BudgetCsvError(`Line ${line}: category ${JSON.stringify(name)} appears twice.`);
      }
      categories.push({
        line,
        name,
        slug,
        sortOrder: categories.length + 1,
        headerBenchmarkCents: readMoneyCell(cells.benchmark, line, "category benchmark").cents,
        headerEstimatedCents: readMoneyCell(cells.estimated, line, "category estimate").cents,
        benchmarkCents: 0,
        estimatedCents: 0,
        items: [],
      });
      continue;
    }

    const category = categories[categories.length - 1];
    if (!category) {
      throw new BudgetCsvError(
        `Line ${line}: item ${JSON.stringify(cells.item)} appears before any category row.`,
      );
    }

    const name = cells.item.trim();
    if (category.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      throw new BudgetCsvError(
        `Line ${line}: ${JSON.stringify(name)} appears twice in ${JSON.stringify(category.name)}; a re-run could not tell the two rows apart.`,
      );
    }

    const qty = cells.qty === "" ? null : cells.qty;
    const each = readMoneyCell(cells.each, line, "each");
    const benchmark = readMoneyCell(cells.benchmark, line, "benchmark");
    const estimated = readMoneyCell(cells.estimated, line, "estimate");

    let benchmarkCents = benchmark.cents;
    let correctionNote: string | null = null;

    const correction = DOCUMENTED_CORRECTIONS.find((c) => c.line === line);
    if (correction) {
      const printed = correction.column === "benchmark" ? benchmark.cents : estimated.cents;
      if (name === correction.itemName && printed === correction.printedCents) {
        benchmarkCents = correction.correctedCents;
        correctionNote =
          `The spreadsheet row prints ${formatMoney(correction.printedCents)}. ` +
          `${correction.evidence} ${formatMoney(correction.correctedCents)}, ` +
          `so the app uses ${formatMoney(correction.correctedCents)} and agrees with the sheet's own totals. ` +
          `Confirm which is right.`;
        anomalies.push({
          code: correction.code,
          line,
          category: category.name,
          item: name,
          message: `${name} prints ${formatMoney(correction.printedCents)}, but the category total and the grand total were both calculated with ${formatMoney(correction.correctedCents)}.`,
          resolution: `Seeded at ${formatMoney(correction.correctedCents)}; the printed ${formatMoney(correction.printedCents)} is preserved in the item's notes. Open question for the client.`,
        });
      } else {
        anomalies.push({
          code: `${correction.code}-stale`,
          line,
          category: category.name,
          item: name,
          message: `A documented correction for line ${line} expected ${JSON.stringify(correction.itemName)} at ${formatMoney(correction.printedCents)} and found ${JSON.stringify(name)} at ${formatMoney(printed)}.`,
          resolution: "Correction NOT applied — the sheet has changed. Re-confirm it before trusting this category's totals.",
        });
      }
    }

    const notApplicable =
      benchmark.source === "not-applicable" || estimated.source === "not-applicable";

    // Qty x Each against the recorded cost. The cost column is authoritative
    // always: on this sheet the two disagree on ten priced rows, worst by
    // $168, and multiplying would overwrite receipts with arithmetic.
    const count = numericQty(qty);
    if (count !== null && each.cents !== null && benchmarkCents !== null) {
      const computed = count * each.cents;
      const gap = computed - benchmarkCents;
      if (Math.abs(gap) >= ROUNDING_TOLERANCE_CENTS) {
        anomalies.push({
          code: "E2",
          line,
          category: category.name,
          item: name,
          message: `${count} × ${formatMoney(each.cents)} is ${formatMoney(computed)}, but the row records ${formatMoney(benchmarkCents)}.`,
          resolution:
            "Recorded cost wins. Qty and Each are seeded as provenance and are never multiplied into a total.",
        });
      } else if (gap !== 0) {
        anomalies.push({
          code: "E3",
          line,
          category: category.name,
          item: name,
          message: `${count} × ${formatMoney(each.cents)} is ${formatMoney(computed)} against a recorded ${formatMoney(benchmarkCents)} — under a dollar apart.`,
          resolution: "Rounding in a whole-dollar display. Recorded cost wins; nothing changed.",
        });
      }
    }

    // A count in the name that disagrees with the Qty cell. Both are stored
    // verbatim; which one is right is not something a parser can know.
    const named = /\((\d+)\)\s*$/.exec(name);
    if (named && count !== null && Number(named[1]) !== count) {
      anomalies.push({
        code: "Q1",
        line,
        category: category.name,
        item: name,
        message: `The name says ${named[1]} and the quantity says ${count}.`,
        resolution: "Both stored verbatim. Open question for the client.",
      });
    }

    category.items.push({
      line,
      name,
      qty,
      unitPriceCents: each.cents,
      benchmarkCents,
      estimatedCents: estimated.cents,
      notes: joinNotes([notApplicable ? NOT_APPLICABLE_NOTE : null, correctionNote]),
      isReconciliation: false,
      sortOrder: category.items.length + 1,
    });
  }

  if (categories.length === 0) throw new BudgetCsvError("No category rows found.");

  for (const category of categories) {
    reconcileCategory(category, benchmarkLabel, anomalies);
    category.benchmarkCents = sumKnown(category.items.map((i) => i.benchmarkCents));
    category.estimatedCents = sumKnown(category.items.map((i) => i.estimatedCents));
  }

  const totals = {
    benchmarkCents: categories.reduce((t, c) => t + c.benchmarkCents, 0),
    estimatedCents: categories.reduce((t, c) => t + c.estimatedCents, 0),
    categoryCount: categories.length,
    itemCount: categories.reduce((t, c) => t + c.items.length, 0),
    reconciliationItemCount: categories.reduce(
      (t, c) => t + c.items.filter((i) => i.isReconciliation).length,
      0,
    ),
  };

  const variances: BudgetVariance[] = [];
  const headerSum = (pick: (c: BudgetSeedCategory) => number | null) =>
    sumKnown(categories.map(pick));

  variances.push(
    grandTotalVariance(
      "G1",
      "benchmark",
      printedGrandTotal.benchmarkCents,
      headerSum((c) => c.headerBenchmarkCents),
      totals.benchmarkCents,
    ),
    grandTotalVariance(
      "G2",
      "estimated",
      printedGrandTotal.estimatedCents,
      headerSum((c) => c.headerEstimatedCents),
      totals.estimatedCents,
    ),
  );

  for (const variance of variances) {
    // Reported when the printed total disagrees with *either* the category rows
    // or the seeded items. On this sheet the benchmark's two disagreements
    // cancel — the categories are a dollar light and the seeded rows a dollar
    // heavy — and saying nothing would hide the fact that a dollar moved.
    if (variance.differenceCents === 0 && variance.headerCents === variance.printedCents) continue;
    anomalies.push({
      code: variance.code,
      line: printedGrandTotal.line,
      category: null,
      item: null,
      message: variance.explanation,
      resolution: `Seeding the computed ${formatMoney(variance.computedCents)}. The printed total is reported, never used.`,
    });
  }

  return { categories, totals, printedGrandTotal, variances, anomalies };
}

function grandTotalVariance(
  code: string,
  column: "benchmark" | "estimated",
  printedCents: number | null,
  headerCents: number,
  computedCents: number,
): BudgetVariance {
  const differenceCents = printedCents === null ? 0 : computedCents - printedCents;
  return {
    code,
    column,
    printedCents,
    headerCents,
    computedCents,
    differenceCents,
    explanation:
      `The grand-total row prints ${formatMoney(printedCents)}. ` +
      `The category rows add to ${formatMoney(headerCents)} and the seeded items add to ${formatMoney(computedCents)}, ` +
      `a difference of ${formatMoney(differenceCents)}.`,
  };
}

/**
 * Carry a category's disagreement with its own children into a visible row.
 *
 * Three outcomes, and which one applies is arithmetic, not judgement:
 *
 * - **R1, header above its rows** — real money budgeted and not broken out.
 *   Dropping it would under-forecast the wedding, which is precisely the failure
 *   every commercial budget tool is criticised for. One `Not yet itemized` row
 *   carries the difference and says so on its face.
 * - **R2, header below its rows** — a total formula that stopped being
 *   recalculated while rows kept being added. One `Spreadsheet reconciliation`
 *   row carries the negative difference so the category still matches the number
 *   the client can see in her own sheet, and the anomaly asks whether the
 *   category should simply be larger.
 * - **R3, within a dollar** — her figures are displayed to the whole dollar, so
 *   a sub-dollar gap is the display, not a mistake. The item sum wins, no row is
 *   invented, and the anomaly records it. Inventing a −$1 phantom line would
 *   look like a real purchase forever.
 *
 * At most one reconciliation row per category, carrying whichever columns are
 * out, so a category can never sprout two contradictory correction lines.
 */
function reconcileCategory(
  category: BudgetSeedCategory,
  benchmarkLabel: string,
  anomalies: BudgetAnomaly[],
): void {
  const itemBenchmark = sumKnown(category.items.map((i) => i.benchmarkCents));
  const itemEstimate = sumKnown(category.items.map((i) => i.estimatedCents));

  const gap = (header: number | null, items: number) =>
    header === null ? 0 : header - items;
  const benchmarkGap = gap(category.headerBenchmarkCents, itemBenchmark);
  const estimateGap = gap(category.headerEstimatedCents, itemEstimate);

  const rounding = (
    column: "benchmark" | "estimate",
    difference: number,
    header: number | null,
    items: number,
  ) => {
    if (difference === 0 || Math.abs(difference) > ROUNDING_TOLERANCE_CENTS) return;
    anomalies.push({
      code: "P1",
      line: category.line,
      category: category.name,
      item: null,
      message: `${category.name} prints a ${column} total of ${formatMoney(header)} but its rows add to ${formatMoney(items)}.`,
      resolution: `Within a dollar — whole-dollar display rounding. Seeding the row sum, ${formatMoney(items)}; no reconciliation row.`,
    });
  };
  rounding("benchmark", benchmarkGap, category.headerBenchmarkCents, itemBenchmark);
  rounding("estimate", estimateGap, category.headerEstimatedCents, itemEstimate);

  const carryBenchmark = Math.abs(benchmarkGap) > ROUNDING_TOLERANCE_CENTS ? benchmarkGap : 0;
  const carryEstimate = Math.abs(estimateGap) > ROUNDING_TOLERANCE_CENTS ? estimateGap : 0;
  if (carryBenchmark === 0 && carryEstimate === 0) return;

  const leading = carryEstimate !== 0 ? carryEstimate : carryBenchmark;
  const underItemized = leading > 0;
  const name = underItemized ? RECONCILIATION_UNDER_ITEMIZED : RECONCILIATION_OVER_ITEMIZED;

  const notes: string[] = [];
  if (carryEstimate > 0) {
    notes.push(
      `${formatMoney(category.headerEstimatedCents)} is budgeted for ${category.name} but only ${formatMoney(itemEstimate)} is broken out. This row holds the remaining ${formatMoney(carryEstimate)} so the category matches the spreadsheet.`,
    );
  } else if (carryEstimate < 0) {
    notes.push(
      `The ${category.name} total reads ${formatMoney(category.headerEstimatedCents)}, but its rows add to ${formatMoney(itemEstimate)} — the total was last calculated before some rows were added. This row holds the ${formatMoney(carryEstimate)} so the category matches the spreadsheet. Ask whether the category should be ${formatMoney(itemEstimate)}.`,
    );
  }
  // Phrased "Misc at <label>" rather than "<label>'s Misc" so the sentence
  // survives a label that is already possessive, which the real one is.
  if (carryBenchmark > 0) {
    notes.push(
      `${category.name} at ${benchmarkLabel} totals ${formatMoney(category.headerBenchmarkCents)} but only ${formatMoney(itemBenchmark)} is broken out. ${formatMoney(carryBenchmark)} of that spend has no line item.`,
    );
  } else if (carryBenchmark < 0) {
    notes.push(
      `${category.name} at ${benchmarkLabel} totals ${formatMoney(category.headerBenchmarkCents)} but its rows add to ${formatMoney(itemBenchmark)}. This row holds the ${formatMoney(carryBenchmark)}.`,
    );
  }

  category.items.push({
    line: null,
    name,
    qty: null,
    unitPriceCents: null,
    benchmarkCents: carryBenchmark === 0 ? null : carryBenchmark,
    estimatedCents: carryEstimate === 0 ? null : carryEstimate,
    notes: notes.join(" "),
    isReconciliation: true,
    sortOrder: category.items.length + 1,
  });

  anomalies.push({
    code: underItemized ? "R1" : "R2",
    line: category.line,
    category: category.name,
    item: name,
    message: underItemized
      ? `${category.name} totals more than its own rows.`
      : `${category.name} totals less than its own rows.`,
    resolution: `Added one visible ${JSON.stringify(name)} row carrying ${[
      carryBenchmark !== 0 ? `${formatMoney(carryBenchmark)} benchmark` : null,
      carryEstimate !== 0 ? `${formatMoney(carryEstimate)} estimate` : null,
    ]
      .filter(Boolean)
      .join(" and ")}, so the category matches the spreadsheet.`,
  });
}
