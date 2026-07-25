import type { ImportHouseholdInput } from "@/lib/data/imports";
import type { CsvMapping, CsvValidation, ImportContext, MailingAddress, RowError } from "./types";
import { cleanValue, norm, normalizeAge, isTruthy } from "./normalize";
import { groupKey } from "./group";

const NO_RESTRICTION = new Set(["none", "n/a", "na", "no", "-"]);
const NOT_INVITED = new Set(["not invited", "notinvited", "n/a", "excluded"]);

/** Translates a mapped RSVP cell into a generic four-state attendance value. No column or event name is hardcoded — the vocabulary here is generic RSVP language, not this wedding's own. */
function toAttending(value: string | undefined): "pending" | "yes" | "no" | "not_invited" {
  const s = norm(value);
  if (!s) return "pending";
  if (NOT_INVITED.has(s)) return "not_invited";
  if (s === "attending" || s === "yes" || s === "y" || s === "accepted") return "yes";
  if (s === "declined" || s === "no" || s === "n" || s === "regrets") return "no";
  return "pending";
}

/** Matches a meal cell against this wedding's own meal options — no alias table, no hardcoded names. */
function resolveMeal(
  value: string | undefined,
  context: ImportContext,
  line: number,
  warnings: RowError[],
): string | undefined {
  const wanted = norm(value);
  if (!wanted) return undefined;
  const hit = context.mealOptions.find((m) => norm(m.name) === wanted);
  if (hit) return hit.id;
  warnings.push({ line, message: `Meal "${value!.trim()}" doesn't match any meal option — left unset.` });
  return undefined;
}

/**
 * First row in the group with any non-empty address field wins (whole-row,
 * not merged across rows). Free text lands in `raw` verbatim — never parsed.
 */
function buildAddress(
  rows: Array<{ row: Record<string, string> }>,
  mapping: CsvMapping,
): MailingAddress | undefined {
  const fields = [
    ["raw", mapping.address],
    ["street", mapping.street],
    ["city", mapping.city],
    ["state", mapping.state],
    ["zip", mapping.zip],
    ["country", mapping.country],
  ] as const;
  for (const { row } of rows) {
    const built: Record<string, string> = {};
    for (const [key, column] of fields) {
      if (!column) continue;
      const value = cleanValue(row[column]);
      if (value) built[key] = value;
    }
    if (Object.keys(built).length > 0) return { ...built, source: "csv" };
  }
  return undefined;
}

/**
 * Groups rows into households (see groupKey for the column fallback order)
 * and validates. Dry-run output: households ready to commit + row errors
 * with 1-based line numbers (line 1 = header).
 */
const EMPTY_CONTEXT: ImportContext = { events: [], mealOptions: [] };

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

  const groups = new Map<
    string,
    { rows: Array<{ row: Record<string, string>; line: number }>; blankRows: number }
  >();

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const first = (row[mapping.firstName] ?? "").trim();
    const last = (row[mapping.lastName] ?? "").trim();
    if (!first && !last) {
      const key = groupKey(row, mapping);
      // A blank row with no grouping value is a stray line, not a seat.
      if (key.startsWith("auto:|")) {
        warnings.push({ line, message: "Empty name — row skipped." });
        return;
      }
      if (!groups.has(key)) groups.set(key, { rows: [], blankRows: 0 });
      groups.get(key)!.blankRows += 1;
      return;
    }
    if (!first || !last) {
      errors.push({ line, message: `Missing ${!first ? "first" : "last"} name.` });
      return;
    }
    const key = groupKey(row, mapping);
    if (!groups.has(key)) groups.set(key, { rows: [], blankRows: 0 });
    groups.get(key)!.rows.push({ row, line });
  });

  const households: ImportHouseholdInput[] = [];
  for (const [key, group] of groups) {
    if (group.rows.length === 0) {
      warnings.push({ line: 1, message: `Group "${key}" has only unnamed rows — skipped.` });
      continue;
    }
    const first = group.rows[0];
    const envelopeName = mapping.envelope ? first.row[mapping.envelope]?.trim() : "";
    const householdName = mapping.household ? first.row[mapping.household]?.trim() : "";
    const displayName =
      envelopeName ||
      householdName ||
      (group.rows.length > 1
        ? `The ${first.row[mapping.lastName].trim()} Family`
        : `${first.row[mapping.firstName].trim()} ${first.row[mapping.lastName].trim()}`);

    const email = mapping.email ? first.row[mapping.email]?.trim() || undefined : undefined;
    if (email && !email.includes("@")) {
      errors.push({ line: first.line, message: `"${email}" doesn't look like an email.` });
    }

    const plusOneSlots =
      (mapping.plusOneSlots ? parseInt(first.row[mapping.plusOneSlots] ?? "0", 10) || 0 : 0) +
      group.blankRows;
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

    const tagSet = new Set<string>();
    for (const spec of mapping.tags ?? []) {
      for (const { row } of group.rows) {
        const raw = (row[spec.column] ?? "").trim();
        if (raw) tagSet.add(`${spec.prefix ?? ""}${raw}`);
      }
    }

    const noteSet = new Set<string>();
    if (mapping.notes) {
      for (const { row } of group.rows) {
        const n = cleanValue(row[mapping.notes]);
        if (n) noteSet.add(n);
      }
    }

    const notInvited: string[] = [];
    for (const spec of mapping.events ?? []) {
      if (toAttending(first.row[spec.column]) === "not_invited") notInvited.push(spec.eventId);
    }

    households.push({
      displayName,
      primaryContactName: `${first.row[mapping.firstName].trim()} ${first.row[mapping.lastName].trim()}`,
      email,
      phone: mapping.phone ? first.row[mapping.phone]?.trim() || undefined : undefined,
      maxPartySize,
      plusOneSlots,
      preferredLocale: ["es", "vi"].includes(locale) ? locale : "en",
      tags: tagSet.size > 0 ? [...tagSet] : undefined,
      mailingAddress: buildAddress(group.rows, mapping),
      internalNotes: noteSet.size > 0 ? [...noteSet].join("\n") : undefined,
      notInvitedEventIds: mapping.events ? notInvited : undefined,
      guests: group.rows.map(({ row, line }) => ({
        firstName: row[mapping.firstName].trim(),
        lastName: row[mapping.lastName].trim(),
        ageType: normalizeAge(mapping.ageType ? row[mapping.ageType] : undefined),
        relationship: mapping.relationship ? row[mapping.relationship]?.trim() || undefined : undefined,
        origin: mapping.isPlusOne
          ? isTruthy(row[mapping.isPlusOne])
            ? "plus_one"
            : "named"
          : undefined,
        dietaryRestrictions: (() => {
          const d = cleanValue(mapping.dietary ? row[mapping.dietary] : undefined);
          return d && !NO_RESTRICTION.has(norm(d)) ? d : undefined;
        })(),
        mealOptionId: mapping.meal ? resolveMeal(row[mapping.meal], context, line, warnings) : undefined,
        attendingByEventId: mapping.events
          ? Object.fromEntries(
              mapping.events
                .filter((spec) => !notInvited.includes(spec.eventId))
                .map((spec) => [spec.eventId, toAttending(row[spec.column]) as "pending" | "yes" | "no"]),
            )
          : undefined,
      })),
    });
  }

  return { ok: errors.length === 0, households, errors, warnings };
}
