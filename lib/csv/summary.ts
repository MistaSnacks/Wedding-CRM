import type { CsvMapping, CsvValidation, RowError } from "./types";
import { cleanValue } from "./normalize";

export type ImportProblem = {
  kind: "error" | "warning";
  line: number;
  who: string; // "Miguel" or "The Smith Family" — never empty
  household: string;
  message: string; // plain language, no jargon
};

export type ImportSummary = {
  invitations: number;
  namedGuests: number;
  unnamedSeats: number;
  extras: Array<{ label: string; count: number }>; // only non-zero entries
  problems: { errors: ImportProblem[]; warnings: ImportProblem[] }; // complete, never truncated
  preview: Array<{ displayName: string; guests: string[]; seats: number; unnamed: number }>;
};

/** Used only when nothing else — no row, no household column, no decodable
 * group key — is recoverable. Rare in practice: every other branch below
 * finds something real to say first. */
const UNNAMED_PLACEHOLDER = "Unnamed guest";

/** Line numbers are 1-based with the header as line 1, so the originating
 * row is `rows[line - 2]`. Household-level problems (negative slot counts,
 * the "group has no named rows" warning) are reported at line 1 or at a
 * group's first row — guard the index either way. */
function rowForLine(rows: Record<string, string>[], line: number): Record<string, string> | undefined {
  const index = line - 2;
  return index >= 0 && index < rows.length ? rows[index] : undefined;
}

function cellName(row: Record<string, string> | undefined, mapping: CsvMapping): string | undefined {
  if (!row) return undefined;
  const first = mapping.firstName ? cleanValue(row[mapping.firstName]) : undefined;
  const last = mapping.lastName ? cleanValue(row[mapping.lastName]) : undefined;
  if (first && last) return `${first} ${last}`;
  return first ?? last;
}

function rowHouseholdLabel(row: Record<string, string> | undefined, mapping: CsvMapping): string | undefined {
  if (!row) return undefined;
  const envelope = mapping.envelope ? cleanValue(row[mapping.envelope]) : undefined;
  const household = mapping.household ? cleanValue(row[mapping.household]) : undefined;
  return envelope ?? household;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Matches the engine's "Group "<key>" has only unnamed rows — skipped." warning
// (lib/csv/validate.ts). The key is one of groupRows' internal formats:
// "env:<envelope>", "hh:<household>", or "auto:<lastname>|<email>"
// (lib/csv/group.ts groupKey).
const GROUP_SKIP = /^Group "(.+)" has only unnamed rows — skipped\.$/;

/**
 * Decodes the engine's internal grouping key back into something a person
 * can read. The key is built entirely from the sheet's own normalized column
 * values (lib/csv/group.ts groupKey) — real information, just not fit for a
 * human to see verbatim (`hh:group a` leaks the internal prefix and
 * lowercases everything).
 */
function decodeGroupKey(key: string): string | undefined {
  let body = key;
  if (body.startsWith("env:")) {
    body = body.slice(4);
  } else if (body.startsWith("hh:")) {
    body = body.slice(3);
  } else if (body.startsWith("auto:")) {
    body = body.slice(5).split("|")[0] ?? "";
  }
  const picked = body.trim();
  return picked ? titleCase(picked) : undefined;
}

function resolveProblem(
  raw: RowError,
  kind: "error" | "warning",
  rows: Record<string, string>[],
  mapping: CsvMapping,
): ImportProblem {
  const row = rowForLine(rows, raw.line);
  const name = cellName(row, mapping);
  const rowHousehold = rowHouseholdLabel(row, mapping);

  const groupSkipMatch = raw.message.match(GROUP_SKIP);
  const decodedGroup = groupSkipMatch ? decodeGroupKey(groupSkipMatch[1]) : undefined;

  const who = name ?? rowHousehold ?? decodedGroup ?? UNNAMED_PLACEHOLDER;
  const household = rowHousehold ?? decodedGroup ?? who;
  const message = decodedGroup ? `"${decodedGroup}" has only unnamed rows, so it was skipped.` : raw.message;

  return { kind, line: raw.line, who, household, message };
}

/**
 * Turns a `CsvValidation` into the plain-language shape the review screen
 * renders: counts, what-else-was-found, and per-person problem descriptions.
 * Pure — no I/O, no React, no dates, no randomness — so it can be unit
 * tested independently of the wizard UI.
 */
export function summarize(v: CsvValidation, rows: Record<string, string>[], mapping: CsvMapping): ImportSummary {
  let namedGuests = 0;
  let unnamedSeats = 0;
  let mailingAddresses = 0;
  let emailAddresses = 0;
  let mealChoices = 0;
  let dietaryNotes = 0;
  let notesCount = 0;

  const preview = v.households.map((h) => {
    namedGuests += h.guests.length;
    const namedPlusOnes = h.guests.filter((g) => g.origin === "plus_one").length;
    const unnamed = Math.max(0, h.plusOneSlots - namedPlusOnes);
    unnamedSeats += unnamed;

    if (h.mailingAddress) mailingAddresses += 1;
    if (h.email) emailAddresses += 1;
    if (h.internalNotes) notesCount += 1;
    for (const guest of h.guests) {
      if (guest.mealOptionId) mealChoices += 1;
      if (guest.dietaryRestrictions) dietaryNotes += 1;
    }

    return {
      displayName: h.displayName,
      guests: h.guests.map((guest) => `${guest.firstName} ${guest.lastName}`.trim()),
      seats: h.maxPartySize,
      unnamed,
    };
  });

  const extras = (
    [
      { label: "mailing addresses", count: mailingAddresses },
      { label: "email addresses", count: emailAddresses },
      { label: "meal choices", count: mealChoices },
      { label: "dietary notes", count: dietaryNotes },
      { label: "notes", count: notesCount },
    ] as Array<{ label: string; count: number }>
  ).filter((e) => e.count > 0);

  return {
    invitations: v.households.length,
    namedGuests,
    unnamedSeats,
    extras,
    problems: {
      errors: v.errors.map((e) => resolveProblem(e, "error", rows, mapping)),
      warnings: v.warnings.map((w) => resolveProblem(w, "warning", rows, mapping)),
    },
    preview,
  };
}
