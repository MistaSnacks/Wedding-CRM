import Papa from "papaparse";
import type { ImportHouseholdInput } from "@/lib/data/imports";

export type CsvMapping = {
  firstName: string;
  lastName: string;
  household?: string;
  email?: string;
  phone?: string;
  ageType?: string;
  relationship?: string;
  maxPartySize?: string;
  plusOneSlots?: string;
  locale?: string;
};

export type RowError = { line: number; message: string };

export type CsvValidation = {
  ok: boolean;
  households: ImportHouseholdInput[];
  errors: RowError[];
  warnings: RowError[];
};

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return { headers: result.meta.fields ?? [], rows: result.data };
}

/** Auto-detect column mapping from common header names. */
export function detectMapping(headers: string[]): CsvMapping {
  const find = (...cands: string[]) =>
    headers.find((h) => cands.some((c) => h.toLowerCase().replace(/[\s_-]/g, "") === c)) ?? "";
  return {
    firstName: find("firstname", "first", "givenname", "nombre"),
    lastName: find("lastname", "last", "surname", "familyname", "apellido"),
    household: find("household", "party", "group", "family") || undefined,
    email: find("email", "emailaddress", "correo") || undefined,
    phone: find("phone", "phonenumber", "tel", "telefono") || undefined,
    ageType: find("agetype", "age", "type") || undefined,
    relationship: find("relationship", "relation") || undefined,
    maxPartySize: find("maxpartysize", "maxparty", "partysize") || undefined,
    plusOneSlots: find("plusoneslots", "plusones", "plusone") || undefined,
    locale: find("locale", "language", "lang", "idioma") || undefined,
  };
}

function normalizeAge(v: string | undefined): "adult" | "child" | "infant" {
  const s = (v ?? "").toLowerCase();
  if (s.startsWith("child") || s === "kid" || s === "niño") return "child";
  if (s.startsWith("infant") || s === "baby" || s === "bebé") return "infant";
  return "adult";
}

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
    const key = mapping.household && row[mapping.household]?.trim()
      ? `hh:${row[mapping.household].trim().toLowerCase()}`
      : `auto:${last.toLowerCase()}|${(mapping.email ? row[mapping.email] ?? "" : "").trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { rows: [] });
    groups.get(key)!.rows.push({ row, line });
  });

  const households: ImportHouseholdInput[] = [];
  for (const [key, group] of groups) {
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
    void key;
  }

  return { ok: errors.length === 0, households, errors, warnings };
}
