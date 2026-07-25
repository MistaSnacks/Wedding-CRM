import type { ImportHouseholdInput } from "@/lib/data/imports";
import type { CsvMapping, CsvValidation, RowError } from "./types";
import { normalizeAge } from "./normalize";
import { groupKey } from "./group";

/**
 * Groups rows into households (by the Household column, else by last name +
 * email) and validates. Dry-run output: households ready to commit + row
 * errors with 1-based line numbers (line 1 = header).
 */
export function validateCsv(rows: Record<string, string>[], mapping: CsvMapping): CsvValidation {
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

  const groups = new Map<string, { rows: Array<{ row: Record<string, string>; line: number }> }>();

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const first = (row[mapping.firstName] ?? "").trim();
    const last = (row[mapping.lastName] ?? "").trim();
    if (!first && !last) {
      warnings.push({ line, message: "Empty name — row skipped." });
      return;
    }
    if (!first || !last) {
      errors.push({ line, message: `Missing ${!first ? "first" : "last"} name.` });
      return;
    }
    const key = groupKey(row, mapping);
    if (!groups.has(key)) groups.set(key, { rows: [] });
    groups.get(key)!.rows.push({ row, line });
  });

  const households: ImportHouseholdInput[] = [];
  for (const [, group] of groups) {
    const first = group.rows[0];
    const displayName =
      mapping.household && first.row[mapping.household]?.trim()
        ? first.row[mapping.household].trim()
        : group.rows.length > 1
          ? `The ${first.row[mapping.lastName].trim()} Family`
          : `${first.row[mapping.firstName].trim()} ${first.row[mapping.lastName].trim()}`;

    const email = mapping.email ? first.row[mapping.email]?.trim() || undefined : undefined;
    if (email && !email.includes("@")) {
      errors.push({ line: first.line, message: `"${email}" doesn't look like an email.` });
    }

    const plusOneSlots = mapping.plusOneSlots ? parseInt(first.row[mapping.plusOneSlots] ?? "0", 10) || 0 : 0;
    const declaredMax = mapping.maxPartySize ? parseInt(first.row[mapping.maxPartySize] ?? "", 10) : NaN;
    const maxPartySize = Number.isFinite(declaredMax) && declaredMax > 0
      ? declaredMax
      : group.rows.length + plusOneSlots;

    if (maxPartySize < group.rows.length) {
      errors.push({
        line: first.line,
        message: `"${displayName}": max party size ${maxPartySize} is smaller than its ${group.rows.length} guests.`,
      });
    }

    const locale = mapping.locale ? (first.row[mapping.locale] ?? "").trim().toLowerCase() : "";

    households.push({
      displayName,
      primaryContactName: `${first.row[mapping.firstName].trim()} ${first.row[mapping.lastName].trim()}`,
      email,
      phone: mapping.phone ? first.row[mapping.phone]?.trim() || undefined : undefined,
      maxPartySize,
      plusOneSlots,
      preferredLocale: ["es", "vi"].includes(locale) ? locale : "en",
      guests: group.rows.map(({ row }) => ({
        firstName: row[mapping.firstName].trim(),
        lastName: row[mapping.lastName].trim(),
        ageType: normalizeAge(mapping.ageType ? row[mapping.ageType] : undefined),
        relationship: mapping.relationship ? row[mapping.relationship]?.trim() || undefined : undefined,
      })),
    });
  }

  return { ok: errors.length === 0, households, errors, warnings };
}
