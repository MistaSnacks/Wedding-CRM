import type { CsvMapping, RowError } from "./types";
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

export type Group = {
  rows: Array<{ row: Record<string, string>; line: number }>;
  blankRows: number;
};

/**
 * Buckets rows into households by groupKey (1-based line numbers, header is
 * line 1). A row with both names blank becomes a plus-one slot on its
 * group's `blankRows` count — unless it has no grouping value at all (the
 * `auto:|` key), in which case it's a stray line, not a seat, and is
 * dropped with a warning instead. A row missing exactly one of the two
 * names is a genuine error and is dropped.
 */
export function groupRows(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  errors: RowError[],
  warnings: RowError[],
): Map<string, Group> {
  const groups = new Map<string, Group>();

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

  return groups;
}
