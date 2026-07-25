import type { CsvMapping, RowError } from "./types";
import { norm } from "./normalize";

/**
 * Fallback order: envelope -> household -> last name + email.
 *
 * When an envelope column is mapped and the cell is non-empty it is the whole
 * key, and the household column is deliberately ignored. The envelope is the
 * mailing line: two rows carrying identical envelope text always belong on one
 * invitation, because the alternative is posting two identically addressed
 * envelopes to one doorstep. Household values are a coarse family-cluster
 * label, entered by hand and often inconsistent for one family ("Aw-Irwin
 * Household" vs "Irwin Household"), so folding it into the key splits real
 * households apart. It keeps its other roles: the family tag, and the grouping
 * key when no envelope exists.
 */
export function groupKey(row: Record<string, string>, mapping: CsvMapping): string {
  const env = mapping.envelope ? norm(row[mapping.envelope]) : "";
  if (env) return `env:${env}`;
  const hh = mapping.household ? norm(row[mapping.household]) : "";
  if (hh) return `hh:${hh}`;
  const last = norm(row[mapping.lastName]);
  const email = mapping.email ? norm(row[mapping.email]) : "";
  return `auto:${last}|${email}`;
}

export type Group = {
  rows: Array<{ row: Record<string, string>; line: number }>;
  /** Line numbers of the blank-name rows in this group — one plus-one seat each. */
  blankLines: number[];
};

function bucket(groups: Map<string, Group>, key: string): Group {
  let group = groups.get(key);
  if (!group) {
    group = { rows: [], blankLines: [] };
    groups.set(key, group);
  }
  return group;
}

/**
 * Buckets rows into households by groupKey (1-based line numbers, header is
 * line 1). A row with both names blank becomes a plus-one slot on its
 * group's `blankLines` — unless it has no grouping value at all (the
 * `auto:|` key), in which case it's a stray line, not a seat, and is
 * dropped with a warning instead. A row missing exactly one of the two
 * names is a genuine error and is dropped.
 *
 * A blank-name row often carries no envelope either — a bare "plus one" line
 * under the family's household label — so it keys on the household while the
 * guest who was granted that seat keys on their envelope. Those strays are
 * reunited here, after bucketing, by donateStrayBlankRows: seats belong to an
 * invitation, and an invitation only exists once every row has been read.
 */
export function groupRows(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  errors: RowError[],
  warnings: RowError[],
): Map<string, Group> {
  const groups = new Map<string, Group>();
  /** normalized household -> keys of the envelope groups holding its named rows */
  const envelopeGroupsByHousehold = new Map<string, Set<string>>();
  /** key of a household-keyed group -> its normalized household value */
  const householdOfGroup = new Map<string, string>();
  /** normalized household -> the sheet's own spelling of it, for warnings */
  const householdLabels = new Map<string, string>();

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const first = (row[mapping.firstName] ?? "").trim();
    const last = (row[mapping.lastName] ?? "").trim();
    const rawHousehold = mapping.household ? (row[mapping.household] ?? "").trim() : "";
    const household = norm(rawHousehold);
    const envelope = mapping.envelope ? norm(row[mapping.envelope]) : "";
    if (household && !householdLabels.has(household)) householdLabels.set(household, rawHousehold);
    const key = groupKey(row, mapping);

    if (!first && !last) {
      // A blank row with no grouping value is a stray line, not a seat.
      if (key.startsWith("auto:|")) {
        warnings.push({ line, message: "Empty name — row skipped." });
        return;
      }
      if (household && !envelope) householdOfGroup.set(key, household);
      bucket(groups, key).blankLines.push(line);
      return;
    }
    if (!first || !last) {
      errors.push({ line, message: `Missing ${!first ? "first" : "last"} name.` });
      return;
    }
    // Only groups with a named guest can receive a donated seat: a slot handed
    // to a group that is itself skipped for having no names would be lost just
    // the same.
    if (household && envelope) {
      let keys = envelopeGroupsByHousehold.get(household);
      if (!keys) {
        keys = new Set();
        envelopeGroupsByHousehold.set(household, keys);
      }
      keys.add(key);
    }
    bucket(groups, key).rows.push({ row, line });
  });

  donateStrayBlankRows(groups, envelopeGroupsByHousehold, householdOfGroup, householdLabels, warnings);

  return groups;
}

/**
 * Reunites a household-keyed group of nothing but blank rows with the
 * invitation those seats were granted to.
 *
 * Exactly one envelope group under that household: unambiguous, so the seats
 * move there silently — this is the ordinary shape of a granted plus-one and
 * the couple's intent is not in doubt. More than one: the destination is
 * genuinely ambiguous, so the seats are still dropped, but the warning names
 * the household and says why instead of leaking the internal group key. None
 * at all: the blank rows are the entire group, there is nothing to attach them
 * to, and validateCsv's own skip warning stands.
 */
function donateStrayBlankRows(
  groups: Map<string, Group>,
  envelopeGroupsByHousehold: Map<string, Set<string>>,
  householdOfGroup: Map<string, string>,
  householdLabels: Map<string, string>,
  warnings: RowError[],
): void {
  for (const [key, group] of groups) {
    if (group.rows.length > 0 || group.blankLines.length === 0) continue;
    const household = householdOfGroup.get(key);
    if (!household) continue;
    const targets = envelopeGroupsByHousehold.get(household);
    if (!targets || targets.size === 0) continue;

    if (targets.size === 1) {
      const [target] = targets;
      groups.get(target)!.blankLines.push(...group.blankLines);
      groups.delete(key);
      continue;
    }

    const label = householdLabels.get(household) ?? household;
    const seats = group.blankLines.length;
    warnings.push({
      line: group.blankLines[0],
      message:
        `"${label}" is split across ${targets.size} invitations, so ${seats === 1 ? "this unnamed row" : `these ${seats} unnamed rows`} ` +
        `could not be matched to one — the extra ${seats === 1 ? "seat was" : "seats were"} skipped. ` +
        `Fill in the envelope column on ${seats === 1 ? "that row" : "those rows"} to say which invitation ${seats === 1 ? "it belongs" : "they belong"} to.`,
    });
    groups.delete(key);
  }
}
