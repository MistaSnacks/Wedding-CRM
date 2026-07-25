import type { CsvMapping } from "./types";
import { norm } from "./normalize";

/** Today's behaviour: household column when present, else last name + email. */
export function groupKey(row: Record<string, string>, mapping: CsvMapping): string {
  if (mapping.household && row[mapping.household]?.trim()) {
    return `hh:${norm(row[mapping.household])}`;
  }
  const last = norm(row[mapping.lastName]);
  const email = mapping.email ? norm(row[mapping.email]) : "";
  return `auto:${last}|${email}`;
}
