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
