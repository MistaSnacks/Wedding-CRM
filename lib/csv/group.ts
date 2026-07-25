import type { CsvMapping } from "./types";
import { norm } from "./normalize";

/**
 * Fallback order: household+envelope (both present) -> envelope alone ->
 * household alone -> last name + email. An envelope column, when mapped,
 * takes priority over the coarser household column because it identifies
 * the physical invitation (one invite_code / one party-size cap), not just
 * a family cluster.
 */
export function groupKey(row: Record<string, string>, mapping: CsvMapping): string {
  const hh = mapping.household ? norm(row[mapping.household]) : "";
  const env = mapping.envelope ? norm(row[mapping.envelope]) : "";
  if (hh && env) return `hh:${hh}|env:${env}`;
  if (env) return `env:${env}`;
  if (hh) return `hh:${hh}`;
  const last = norm(row[mapping.lastName]);
  const email = mapping.email ? norm(row[mapping.email]) : "";
  return `auto:${last}|${email}`;
}
