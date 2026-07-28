import type { ParsedSubmission } from "./sheet";
import type { Locale, RsvpStatus } from "@/lib/types";

/**
 * Turning a matched submission into a household update.
 *
 * Two rules govern everything here:
 *
 * 1. **Source precedence** (`admin` > `save_the_date` > `csv`). A guest typed
 *    their own address, so it beats a value that came from the master
 *    spreadsheet — the master's contact columns were near-empty and what little
 *    they held was placeholder junk. It never beats a hand edit, and it never
 *    beats *another guest's* response: two members of one household submitting
 *    different addresses is a human decision, not a merge conflict to resolve
 *    by timestamp.
 *
 *    Only `mailing_address` carries a `source`, so only it can be overwritten.
 *    `email`/`phone` are plain columns with no provenance, so they stay
 *    fill-blank-only — we cannot tell an admin's correction from an import.
 *
 * 2. **Everything written is recorded** in `applied`, with the value it
 *    replaced, so undo restores rather than guesses.
 */

export type AddressValue = Record<string, string>;

export type ApplyTarget = {
  email: string | null;
  phone: string | null;
  mailing_address: AddressValue | null;
  preferred_locale: Locale;
  internal_notes: string | null;
  rsvp_status: RsvpStatus;
};

export type HouseholdPatch = Partial<{
  email: string | null;
  phone: string | null;
  mailing_address: AddressValue | null;
  preferred_locale: Locale;
  internal_notes: string | null;
  rsvp_status: RsvpStatus;
}>;

export type AppliedRecord = Record<string, { from: unknown; to: unknown }>;

export type ApplyResult = {
  patch: HouseholdPatch;
  applied: AppliedRecord;
  /** Plain-language notes about what was deliberately left alone, shown in review. */
  skipped: string[];
};

const noteLine = (s: ParsedSubmission): string => `[Save the Date ${s.receivedAt}] ${s.notes}`;

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function resolveHouseholdPatch(target: ApplyTarget, s: ParsedSubmission): ApplyResult {
  const patch: HouseholdPatch = {};
  const applied: AppliedRecord = {};
  const skipped: string[] = [];

  const write = <K extends keyof HouseholdPatch>(field: K, value: HouseholdPatch[K], from: unknown) => {
    patch[field] = value;
    applied[field as string] = { from: from ?? null, to: value ?? null };
  };

  // Contact columns carry no provenance — fill only when empty.
  if (s.email && !target.email) write("email", s.email, target.email);
  if (s.phone && !target.phone) write("phone", s.phone, target.phone);

  // The address does carry provenance, so precedence applies.
  if (s.address) {
    const next: AddressValue = { raw: s.address, source: "save_the_date" };
    const current = target.mailing_address;
    const currentSource = current?.source;
    if (!current) {
      write("mailing_address", next, null);
    } else if (currentSource === "csv") {
      write("mailing_address", next, current);
    } else if (currentSource === "admin") {
      skipped.push("Kept the address you edited by hand.");
    } else {
      skipped.push("Kept the address from another response — two people in this household sent different ones.");
    }
  }

  // Only ever an upgrade away from the default; a chosen language is not overridden.
  if (s.language !== "en" && target.preferred_locale === "en") {
    write("preferred_locale", s.language, target.preferred_locale);
  }

  // Notes accumulate with their timestamp. Free text carries plus-one requests
  // and opt-outs, so merging would lose meaning.
  if (s.notes) {
    const line = noteLine(s);
    if (!(target.internal_notes ?? "").includes(line)) {
      write("internal_notes", target.internal_notes ? `${target.internal_notes}\n${line}` : line, target.internal_notes);
    }
  }

  // An opt-out is honoured immediately, but never overrides a real reply.
  if (s.optOut && target.rsvp_status === "pending") {
    write("rsvp_status", "declined", target.rsvp_status);
  }

  return { patch, applied, skipped };
}

/**
 * Undo restores the recorded prior values — unless the field moved since, in
 * which case it declines and says so rather than clobbering the newer value.
 */
export function resolveUndo(
  target: ApplyTarget,
  applied: AppliedRecord,
): { patch: HouseholdPatch } | { declined: string } {
  const patch: HouseholdPatch = {};
  for (const [field, change] of Object.entries(applied ?? {})) {
    const current = (target as unknown as Record<string, unknown>)[field];
    if (!sameValue(current, change.to)) {
      return {
        declined: `The ${field.replace(/_/g, " ")} has changed since this was applied, so undoing would overwrite the newer value.`,
      };
    }
    (patch as Record<string, unknown>)[field] = change.from ?? null;
  }
  return { patch };
}
