import type { ImportHouseholdInput } from "@/lib/data/imports";
import type { CsvMapping, ImportContext, MailingAddress, RowError } from "./types";
import { cleanValue, norm, normalizeAge, isTruthy, countEnvelopeNames } from "./normalize";
import type { Group } from "./group";

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
 * Per-guest attendance for the events this household *is* invited to.
 *
 * `notInvited` is a household-level union (one envelope, one invite code), so
 * an event that survives the filter cannot legitimately read "not invited" on
 * any row. The residual mapping to "pending" is a belt-and-braces guard: the
 * return type is the same union `guest_event_responses.attending` accepts
 * (`check (attending in ('pending','yes','no'))`), so the compiler — not a
 * cast — is what keeps an illegal value out of the commit payload.
 */
function buildAttending(
  row: Record<string, string>,
  events: NonNullable<CsvMapping["events"]>,
  notInvited: string[],
): Record<string, "pending" | "yes" | "no"> {
  const out: Record<string, "pending" | "yes" | "no"> = {};
  for (const spec of events) {
    if (notInvited.includes(spec.eventId)) continue;
    const attending = toAttending(row[spec.column]);
    out[spec.eventId] = attending === "not_invited" ? "pending" : attending;
  }
  return out;
}

type ImportGuestInput = ImportHouseholdInput["guests"][number];

/**
 * Turns one group of rows into the household side of an ImportHouseholdInput
 * (everything except `guests`): display name, contact, email validation,
 * address, tags, notes, locale, slot arithmetic, party-size checks, the
 * envelope warning, and the not-invited set.
 *
 * Returns `notInvited` alongside the household because callers need it again
 * to build each guest's `attendingByEventId` (see buildAttending above) —
 * recomputing it per guest would repeat the same household-wide scan.
 */
/**
 * Precondition: `group.rows` must be non-empty — the caller is responsible for
 * filtering groups that contain only blank-name rows (see validateCsv, which
 * warns and skips them). This dereferences `group.rows[0]` directly, and
 * `noUncheckedIndexedAccess` is off, so an empty group throws here rather than
 * being caught by the type system.
 */
export function buildHousehold(
  group: Group,
  mapping: CsvMapping,
  errors: RowError[],
  warnings: RowError[],
): { household: Omit<ImportHouseholdInput, "guests">; notInvited: string[] } {
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

  const slotsCell = mapping.plusOneSlots ? (first.row[mapping.plusOneSlots] ?? "").trim() : "";
  const declaredSlots = parseInt(slotsCell, 10) || 0;
  if (declaredSlots < 0) {
    warnings.push({
      line: first.line,
      message: `"${displayName}": plus-one slots "${slotsCell}" is negative — treated as 0.`,
    });
  }
  // Clamped: households.plus_one_slots carries `check (plus_one_slots >= 0)`,
  // and a negative cell would otherwise abort the whole import transaction.
  const explicitSlots = Math.max(0, declaredSlots);
  // A named plus-one row is an *occupied* slot, not an absent one. The RSVP
  // engine reads plus_one_slots as the grant and existing origin='plus_one'
  // guests as consumers (lib/domain/invitation-rules.ts, and the submit_rsvp
  // backstop in 0001_init.sql), so a household with a named plus-one and zero
  // slots can never RSVP at all — every submission trips `existing > slots`.
  const namedPlusOnes = mapping.isPlusOne
    ? group.rows.filter(({ row }) => isTruthy(row[mapping.isPlusOne!])).length
    : 0;
  const plusOneSlots = explicitSlots + group.blankLines.length + namedPlusOnes;
  const declaredMax = mapping.maxPartySize ? parseInt(first.row[mapping.maxPartySize] ?? "", 10) : NaN;
  // maxPartySize deliberately excludes namedPlusOnes: those people already
  // have rows in group.rows, so counting them again would inflate the cap.
  const maxPartySize = Number.isFinite(declaredMax) && declaredMax > 0
    ? declaredMax
    : group.rows.length + explicitSlots + group.blankLines.length;

  if (maxPartySize < group.rows.length) {
    errors.push({
      line: first.line,
      message: `"${displayName}": max party size ${maxPartySize} is smaller than its ${group.rows.length} guests.`,
    });
  }

  if (mapping.envelope) {
    const named = countEnvelopeNames(first.row[mapping.envelope]);
    const seats = group.rows.length + group.blankLines.length;
    if (named > seats) {
      warnings.push({
        line: first.line,
        message: `"${displayName}" names ${named} people but has only ${seats} row${seats === 1 ? "" : "s"} — someone may be missing.`,
      });
    }
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

  // Invitations are an envelope-level concept — one household, one invite
  // code — so "not invited" anywhere in the group excludes the whole
  // household. Reading only the first row would leave later rows holding a
  // "not_invited" attendance value that no CHECK constraint accepts.
  const notInvited: string[] = [];
  for (const spec of mapping.events ?? []) {
    if (group.rows.some(({ row }) => toAttending(row[spec.column]) === "not_invited")) {
      notInvited.push(spec.eventId);
    }
  }

  const household: Omit<ImportHouseholdInput, "guests"> = {
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
  };

  return { household, notInvited };
}

/**
 * Turns one row into a single guest: names, age type, relationship, origin,
 * dietary, meal, and per-event attendance. `notInvited` comes from
 * buildHousehold's return value for this same group (see buildAttending).
 */
export function buildGuest(
  row: Record<string, string>,
  line: number,
  mapping: CsvMapping,
  context: ImportContext,
  notInvited: string[],
  warnings: RowError[],
): ImportGuestInput {
  return {
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
    attendingByEventId: mapping.events ? buildAttending(row, mapping.events, notInvited) : undefined,
  };
}
