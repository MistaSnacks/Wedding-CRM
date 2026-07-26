import type { MailingAddress } from "@/lib/csv/types";

/**
 * Addresses are shown and edited as plain text and stored verbatim — never
 * parsed. International addresses defeat parsers, and a wrong parse silently
 * corrupts a mailing label.
 */
export function formatMailingAddress(a: MailingAddress | null | undefined): string {
  if (!a) return "";
  if (a.raw) return a.raw;
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [a.street, cityLine, a.country].filter(Boolean).join("\n");
}

export function provenanceLabel(a: MailingAddress | null | undefined): string | null {
  if (!a) return null;
  switch (a.source) {
    case "save_the_date":
      return "from the Save-the-Date form";
    case "csv":
      return "from your spreadsheet import";
    case "admin":
      return "edited by you";
    default:
      return null;
  }
}

/**
 * Decide what a submitted address textarea means:
 * `undefined` — unchanged, skip the write; `null` — cleared; otherwise the
 * new admin-sourced value, text preserved verbatim.
 */
export function resolveAddressUpdate(
  prev: MailingAddress | null | undefined,
  submitted: string,
): MailingAddress | null | undefined {
  const next = submitted.trim();
  const current = formatMailingAddress(prev).trim();
  if (next === current) return undefined;
  if (!next) return null;
  return { raw: submitted.trim(), source: "admin" };
}
