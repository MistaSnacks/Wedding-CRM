import type { ImportHouseholdInput } from "@/lib/data/imports";
import type { CsvMapping, CsvValidation, ImportContext, RowError } from "./types";
import { groupRows } from "./group";
import { buildHousehold, buildGuest } from "./fields";

const EMPTY_CONTEXT: ImportContext = { events: [], mealOptions: [] };

/**
 * Groups rows into households (see groupRows for the column fallback order)
 * and validates. Dry-run output: households ready to commit + row errors
 * with 1-based line numbers (line 1 = header).
 */
export function validateCsv(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  context: ImportContext = EMPTY_CONTEXT,
): CsvValidation {
  const errors: RowError[] = [];
  const warnings: RowError[] = [];

  if (!mapping.firstName || !mapping.lastName) {
    return {
      ok: false,
      households: [],
      errors: [{ line: 1, message: "Map both a First name and a Last name column." }],
      warnings,
    };
  }

  const groups = groupRows(rows, mapping, errors, warnings);

  const households: ImportHouseholdInput[] = [];
  for (const [key, group] of groups) {
    if (group.rows.length === 0) {
      warnings.push({ line: 1, message: `Group "${key}" has only unnamed rows — skipped.` });
      continue;
    }
    const { household, notInvited } = buildHousehold(group, mapping, errors, warnings);
    households.push({
      ...household,
      guests: group.rows.map(({ row, line }) => buildGuest(row, line, mapping, context, notInvited, warnings)),
    });
  }

  return { ok: errors.length === 0, households, errors, warnings };
}
