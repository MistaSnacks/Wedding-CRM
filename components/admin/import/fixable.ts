import type { CsvMapping, ImportProblem } from "@/lib/csv";

export type FixField = "firstName" | "lastName";

/**
 * Everything needed to write one cell: which sheet row, which column, and
 * which of the two name fields it is (for the label and the placeholder).
 */
export type RowFix = {
  line: number;
  field: FixField;
  /** The mapped header — the very key `validateCsv` reads for this field. */
  column: string;
  /** What the row already holds for that cell (normally empty; never trusted). */
  current: string;
};

/**
 * The engine's two repairable errors, matched on the exact string it emits
 * (`lib/csv/group.ts`). Matching exactly rather than loosely is the point: a
 * message we do not recognise is a message whose cell we cannot name.
 */
const REPAIRABLE: Record<string, FixField> = {
  "Missing first name.": "firstName",
  "Missing last name.": "lastName",
};

/**
 * Decides whether a problem can be corrected in place, and returns the exact
 * cell to write if it can.
 *
 * A fix is offered only when all four hold:
 *   1. it is an error (warnings block nothing, so there is nothing to repair),
 *   2. the message is one of the two the engine emits for a half-empty name,
 *   3. that name column is actually mapped, so the column is known and not inferred,
 *   4. the line resolves to a real parsed row (`rows[line - 2]`; line 1 is the header).
 *
 * Anything else — a malformed email, a negative party size, "map both a First
 * name and a Last name column" (reported at the header line, belonging to no
 * row at all) — returns null and stays read-only. We never guess at a cell:
 * writing to the wrong column would silently corrupt a guest's record, which
 * is worse than the row simply not importing.
 */
export function resolveFix(
  problem: ImportProblem,
  rows: Record<string, string>[],
  mapping: CsvMapping,
): RowFix | null {
  if (problem.kind !== "error") return null;

  const field = REPAIRABLE[problem.message];
  if (!field) return null;

  const column = mapping[field];
  if (!column) return null;

  const index = problem.line - 2;
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null;

  const row = rows[index];
  if (!row) return null;

  return { line: problem.line, field, column, current: (row[column] ?? "").trim() };
}

export const FIX_LABEL: Record<FixField, string> = {
  firstName: "First name",
  lastName: "Last name",
};

/** One repair already written into the rows, recorded so it can be shown back. */
export type AppliedFix = {
  line: number;
  field: FixField;
  /** The column it was written into, captured at the time of the write. */
  column: string;
};

/**
 * A repair as it should read back to her: the half that was already on the
 * sheet, printed beside a still-open input holding the half she typed.
 */
export type ResolvedFix = {
  line: number;
  /** The name half already in the file — static text either side of the input. */
  kept: string;
  /** The cell she filled in, re-openable with her own value already in it. */
  fix: RowFix;
};

/**
 * Turns the record of what she repaired back into editable rows.
 *
 * This is what makes an applied fix reversible: the value lives in `rows`, so
 * reading it out again is always the current truth rather than a copy that can
 * drift. A repair is dropped from the read-back only when it can no longer be
 * shown honestly — the row is gone, the column is no longer the mapped one, or
 * the cell is somehow empty again — because an entry she cannot act on is worse
 * than no entry at all.
 */
export function resolveApplied(
  applied: AppliedFix[],
  rows: Record<string, string>[],
  mapping: CsvMapping,
): ResolvedFix[] {
  const out: ResolvedFix[] = [];

  for (const a of applied) {
    const index = a.line - 2; // line 1 is the header
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) continue;

    const row = rows[index];
    if (!row) continue;

    // A remap already clears the tally; this is the belt to that braces.
    const column = mapping[a.field];
    if (!column || column !== a.column) continue;

    const value = (row[column] ?? "").trim();
    if (!value) continue;

    const otherColumn = mapping[a.field === "firstName" ? "lastName" : "firstName"];
    const kept = otherColumn ? (row[otherColumn] ?? "").trim() : "";

    out.push({ line: a.line, kept, fix: { line: a.line, field: a.field, column, current: value } });
  }

  // Sheet order, not the order she happened to type them in: the row numbers
  // beside them are her only bridge back to the spreadsheet, and they should
  // count upwards.
  return out.sort((x, y) => x.line - y.line);
}
