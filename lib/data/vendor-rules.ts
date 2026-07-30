/**
 * Pure rules for the vendor module. No I/O, no React, no `Date.now()` — vitest
 * only covers `lib/**`, so everything worth testing lives here and
 * `lib/data/vendors.ts` stays a thin shell around Supabase.
 *
 * Two things in this file carry more weight than the rest:
 *
 * - `teamRoles` / `teamRollup` — The Knot lifted engagement 88% by showing the
 *   *shape* of the team (categories as slots to fill) before showing a list of
 *   vendors. So the rollup names the roles that are still empty; a bare
 *   "9 of 19" is a score, and a score does not tell you what to do next.
 * - `syncPlan` — a vendor's contract price may flow into a linked budget line,
 *   but never silently over a number a human typed. It classifies; it never
 *   decides to write, and it never proposes writing back to the vendor.
 */

/* ------------------------------------------------------------------ statuses */

export type VendorStatus =
  | "researching"
  | "contacted"
  | "quoted"
  | "booked"
  | "completed"
  | "passed";

/**
 * Lifecycle order. Drives chip order, `statusRank`, and "furthest along".
 *
 * `passed` sits last because it is terminal, not because it is an achievement —
 * every "furthest along" calculation here runs over non-passed vendors only.
 */
export const VENDOR_STATUSES = [
  "researching",
  "contacted",
  "quoted",
  "booked",
  "completed",
  "passed",
] as const satisfies readonly VendorStatus[];

/**
 * Sort weight for the vendor list: the ones needing a decision float up,
 * settled ones sink. Deliberately *not* the lifecycle order — a quote sitting
 * unanswered is the most urgent row on the page, and a completed vendor is the
 * least. Lives here rather than in the badge map so the comparator that uses it
 * is unit-tested.
 */
export const VENDOR_STATUS_ATTENTION_RANK: Record<VendorStatus, number> = {
  quoted: 0,
  contacted: 1,
  researching: 2,
  booked: 3,
  completed: 4,
  passed: 5,
};

/** Lifecycle index, for "furthest along". `researching` is 0, `passed` is 5. */
export function statusRank(status: VendorStatus): number {
  const index = VENDOR_STATUSES.indexOf(status);
  return index === -1 ? VENDOR_STATUSES.length : index;
}

/** How loudly this status should shout for attention. Lower shouts louder. */
export function attentionRank(status: VendorStatus): number {
  return VENDOR_STATUS_ATTENTION_RANK[status] ?? VENDOR_STATUSES.length;
}

/** Booked or completed — someone is actually doing this job. */
export function isSecured(status: VendorStatus): boolean {
  return status === "booked" || status === "completed";
}

/**
 * Still an open thread. Excludes `passed` on purpose: a vendor she ruled out is
 * not work outstanding, and a "Vendors Pending" number that only ever grows is
 * a number she stops reading.
 */
export function isPending(status: VendorStatus): boolean {
  return status === "researching" || status === "contacted" || status === "quoted";
}

/** Narrows arbitrary text (a `FormData` value, a URL param) to a status. */
export function isVendorStatus(value: unknown): value is VendorStatus {
  return typeof value === "string" && (VENDOR_STATUSES as readonly string[]).includes(value);
}

/* --------------------------------------------------------------------- roles */

export type VendorRoleDefault = {
  name: string;
  /** Always visible. The other nine sit behind "+ 9 more roles". */
  essential: boolean;
  /** A hint used to pre-select a budget category. Never enforced. */
  budgetCategory: string;
};

/**
 * The suggested wedding team, in display order: ten essential roles then nine
 * optional ones.
 *
 * These are suggestions, never a schema. `vendors.role` is free text, so a role
 * Juliet invents appears alongside these the moment she uses it — research is
 * explicit that fixed category lists make couples feel pigeon-holed.
 *
 * `budgetCategory` names one of the couple's own eleven budget categories
 * (Venue, Food and Beverage, Music + Photography, Attire + Beauty,
 * Flowers + Decor, Printing, Gifts, Hotels, Misc, Flights, Contingency), so
 * "create a budget line for this vendor" lands in the right bucket without
 * asking her.
 */
export const DEFAULT_VENDOR_ROLES: readonly VendorRoleDefault[] = [
  { name: "Venue", essential: true, budgetCategory: "Venue" },
  { name: "Catering", essential: true, budgetCategory: "Food and Beverage" },
  { name: "Bar & Beverage", essential: true, budgetCategory: "Food and Beverage" },
  { name: "Cake & Desserts", essential: true, budgetCategory: "Food and Beverage" },
  { name: "Photographer", essential: true, budgetCategory: "Music + Photography" },
  { name: "Videographer", essential: true, budgetCategory: "Music + Photography" },
  { name: "DJ", essential: true, budgetCategory: "Music + Photography" },
  { name: "Florist & Decor", essential: true, budgetCategory: "Flowers + Decor" },
  { name: "Hair & Makeup", essential: true, budgetCategory: "Attire + Beauty" },
  { name: "Planner / Coordinator", essential: true, budgetCategory: "Misc" },
  { name: "Live music", essential: false, budgetCategory: "Music + Photography" },
  { name: "Lion dance", essential: false, budgetCategory: "Music + Photography" },
  { name: "Late-night food trucks", essential: false, budgetCategory: "Food and Beverage" },
  { name: "Rentals & Linens", essential: false, budgetCategory: "Venue" },
  { name: "Attire & Alterations", essential: false, budgetCategory: "Attire + Beauty" },
  { name: "Officiant", essential: false, budgetCategory: "Misc" },
  { name: "Transportation & Shuttle", essential: false, budgetCategory: "Misc" },
  { name: "Stationery & Printing", essential: false, budgetCategory: "Printing" },
  { name: "Hotel block", essential: false, budgetCategory: "Hotels" },
];

/** Just the names, so callers can pass a plain `readonly string[]` around. */
export const DEFAULT_VENDOR_ROLE_NAMES: readonly string[] = DEFAULT_VENDOR_ROLES.map(
  (role) => role.name,
);

/** Where a vendor with no role goes. Never a suggested slot — see `teamRoles`. */
const UNASSIGNED_ROLE_LABEL = "Other";

/** Roles match case-insensitively and trimmed: "dj", "DJ " and "Dj" are one slot. */
function roleKey(role: string | null | undefined): string {
  return (role ?? "").trim().toLowerCase();
}

/* --------------------------------------------------------------------- facts */

/**
 * The subset of a `vendors` row every rule here needs. Structural, so a wider
 * row from `lib/data/vendors.ts` passes straight in.
 *
 * `role` is nullable because the column is (`0012_budget_vendors.sql` declares
 * `role text` with no default) — a vendor jotted down before she knows what to
 * call them is normal.
 */
export type VendorFact = {
  id: string;
  name: string;
  role: string | null;
  status: VendorStatus;
  quoted_cents: number | null;
  contracted_cents: number | null;
  contract_signed_at: string | null;
  currency: string;
  sort_order: number;
  /** Present only if the schema grows one; `effectivePrice` falls back to it. */
  estimated_cents?: number | null;
};

/**
 * `VendorFact` plus the free-text fields search reads. All optional, so a bare
 * `VendorFact` is still a legal argument and the shell only pays for what it
 * selects. `searchText` is an escape hatch: anything the shell precomputes
 * (a joined address, a company name) gets searched too.
 */
export type VendorSearchFact = VendorFact & {
  contact_name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  searchText?: string | null;
};

/* -------------------------------------------------------------------- counts */

export type VendorCounts = {
  total: number;
  researching: number;
  contacted: number;
  quoted: number;
  booked: number;
  completed: number;
  passed: number;
  /** booked + completed — the "Vendors Booked" card. */
  secured: number;
  /** researching + contacted + quoted — "Vendors Pending". Excludes passed. */
  pending: number;
  /** booked (not completed) with `contract_signed_at` null — "Contracts Outstanding". */
  contractsOutstanding: number;
  /** Any status, contract on file. The sub-line under "Awaiting contract". */
  contractsSigned: number;
};

/**
 * Every number on the vendor dashboard strip and the filter chips, in one pass.
 *
 * An unknown status string (a hand-edited row, a future value) still lands in
 * `total` but in no bucket, so the buckets can never sum to more than the
 * total and a bad row cannot inflate a card.
 */
export function vendorCounts(vendors: readonly VendorFact[]): VendorCounts {
  const counts: VendorCounts = {
    total: vendors.length,
    researching: 0,
    contacted: 0,
    quoted: 0,
    booked: 0,
    completed: 0,
    passed: 0,
    secured: 0,
    pending: 0,
    contractsOutstanding: 0,
    contractsSigned: 0,
  };

  for (const vendor of vendors) {
    if (isVendorStatus(vendor.status)) counts[vendor.status] += 1;
    if (isSecured(vendor.status)) counts.secured += 1;
    if (isPending(vendor.status)) counts.pending += 1;
    if (isContractOutstanding(vendor)) counts.contractsOutstanding += 1;
    if (vendor.contract_signed_at !== null) counts.contractsSigned += 1;
  }

  return counts;
}

/**
 * Booked, and nothing signed. `completed` is excluded deliberately: chasing a
 * signature for a job that already happened is noise, and the card exists to
 * produce one phone call.
 */
export function isContractOutstanding(vendor: VendorFact): boolean {
  return vendor.status === "booked" && vendor.contract_signed_at === null;
}

/** The vendors behind the "Contracts Outstanding" number, in input order. */
export function contractsOutstanding<T extends VendorFact>(vendors: readonly T[]): T[] {
  return vendors.filter(isContractOutstanding);
}

/**
 * Σ contract price over booked and completed vendors — what the couple has
 * actually committed to. Researching and quoted vendors are excluded: a quote
 * is not a commitment, and adding one to a "committed" total is how a budget
 * screen starts lying.
 */
export function vendorContractedCents(vendors: readonly VendorFact[]): number {
  let total = 0;
  for (const vendor of vendors) {
    if (isSecured(vendor.status) && vendor.contracted_cents !== null) {
      total += vendor.contracted_cents;
    }
  }
  return total;
}

/* --------------------------------------------------------------------- price */

export type VendorPriceStage = "contracted" | "quoted" | "estimated";

/**
 * The one number to show for a vendor, and which column it came from.
 *
 * The stage matters as much as the money: the list prefixes a `quote` or `est.`
 * marker when the figure is not contracted, so a guess never reads as a
 * commitment.
 */
export function effectivePrice(vendor: VendorFact): {
  cents: number | null;
  stage: VendorPriceStage | null;
} {
  if (vendor.contracted_cents !== null && vendor.contracted_cents !== undefined) {
    return { cents: vendor.contracted_cents, stage: "contracted" };
  }
  if (vendor.quoted_cents !== null && vendor.quoted_cents !== undefined) {
    return { cents: vendor.quoted_cents, stage: "quoted" };
  }
  if (vendor.estimated_cents !== null && vendor.estimated_cents !== undefined) {
    return { cents: vendor.estimated_cents, stage: "estimated" };
  }
  return { cents: null, stage: null };
}

/* ---------------------------------------------------------------- team roles */

export type TeamRoleState = "filled" | "deciding" | "empty";

export type TeamRole = {
  /** The vendor's own casing when a vendor uses this role, else the suggested casing. */
  role: string;
  /** At least one vendor booked or completed. */
  filled: boolean;
  /** Vendors in this role that are not passed. Equals `vendorIds.length`. */
  candidateCount: number;
  bookedVendorName: string | null;
  /** The furthest-along status among the candidates. Null when there are none. */
  status: VendorStatus | null;
  /** `filled` | `deciding` (candidates but none secured) | `empty`. */
  state: TeamRoleState;
  /** True when the role came from the suggested list rather than being invented. */
  suggested: boolean;
  /** From `DEFAULT_VENDOR_ROLES`; false for invented roles. */
  essential: boolean;
  /** Budget-category hint from `DEFAULT_VENDOR_ROLES`; null for invented roles. */
  budgetCategory: string | null;
  /** Ids of the non-passed vendors, most-in-need-of-a-decision first. */
  vendorIds: string[];
  /** Vendors she ruled out. Kept visible so a shortlist history is one click away. */
  passedCount: number;
};

/**
 * Every slot on the wedding team, filled or not.
 *
 * The union of the suggested roles and every role actually in use, so a role
 * Juliet invents shows up and a suggested role she has not filled still shows
 * up as an empty slot. That second half is the whole point: The Knot's 88%
 * engagement lift came from presenting categories as slots to fill rather than
 * as a list of what already exists, and a rollup that only reported roles in
 * use could never render an empty slot.
 *
 * Roles match case-insensitively and trimmed. A vendor with no role at all
 * lands in an "Other" bucket that only appears when someone is in it — an
 * always-present "Other" dashed tile would ask her to fill a slot that means
 * nothing.
 *
 * Passed vendors never fill a role and never count as candidates, so a role
 * whose only vendor was ruled out comes back as an empty slot. They are still
 * counted in `passedCount` rather than dropped, because she may go back to them.
 */
export function teamRoles(
  vendors: readonly VendorFact[],
  suggested: readonly string[] = DEFAULT_VENDOR_ROLE_NAMES,
): TeamRole[] {
  const defaults = new Map<string, VendorRoleDefault>(
    DEFAULT_VENDOR_ROLES.map((role) => [roleKey(role.name), role]),
  );

  type Bucket = {
    display: string;
    suggested: boolean;
    order: number;
    vendors: VendorFact[];
  };
  const buckets = new Map<string, Bucket>();

  suggested.forEach((name, index) => {
    const key = roleKey(name);
    if (key.length === 0 || buckets.has(key)) return;
    buckets.set(key, { display: name.trim(), suggested: true, order: index, vendors: [] });
  });

  for (const vendor of vendors) {
    const named = (vendor.role ?? "").trim();
    const key = named.length > 0 ? roleKey(named) : roleKey(UNASSIGNED_ROLE_LABEL);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        display: named.length > 0 ? named : UNASSIGNED_ROLE_LABEL,
        suggested: false,
        order: Number.POSITIVE_INFINITY,
        vendors: [],
      };
      buckets.set(key, bucket);
    } else if (bucket.vendors.length === 0 && named.length > 0) {
      // Her spelling wins over ours, but only the first vendor gets to set it,
      // so the tile does not rename itself as rows are added.
      bucket.display = named;
    }
    bucket.vendors.push(vendor);
  }

  const roles: TeamRole[] = [];
  for (const [key, bucket] of buckets) {
    const candidates = bucket.vendors.filter((vendor) => vendor.status !== "passed");
    const ordered = [...candidates].sort(byAttentionThenName);
    const secured = ordered.filter((vendor) => isSecured(vendor.status));

    const furthest = candidates.reduce<VendorFact | null>(
      (best, vendor) =>
        best === null || statusRank(vendor.status) > statusRank(best.status) ? vendor : best,
      null,
    );
    const booked = secured.reduce<VendorFact | null>(
      (best, vendor) =>
        best === null || statusRank(vendor.status) > statusRank(best.status) ? vendor : best,
      null,
    );

    const meta = defaults.get(key) ?? null;
    roles.push({
      role: bucket.display,
      filled: secured.length > 0,
      candidateCount: candidates.length,
      bookedVendorName: booked?.name ?? null,
      status: furthest?.status ?? null,
      state: secured.length > 0 ? "filled" : candidates.length > 0 ? "deciding" : "empty",
      suggested: bucket.suggested,
      essential: meta?.essential ?? false,
      budgetCategory: meta?.budgetCategory ?? null,
      vendorIds: ordered.map((vendor) => vendor.id),
      passedCount: bucket.vendors.length - candidates.length,
    });
  }

  // Suggested roles keep their given order; roles she invented follow,
  // alphabetically, so the strip does not reshuffle as vendors are added.
  return roles.sort((a, b) => {
    const orderA = a.suggested ? suggestedIndex(suggested, a.role) : Number.POSITIVE_INFINITY;
    const orderB = b.suggested ? suggestedIndex(suggested, b.role) : Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return a.role.localeCompare(b.role, "en", { sensitivity: "base" });
  });
}

function suggestedIndex(suggested: readonly string[], role: string): number {
  const key = roleKey(role);
  const index = suggested.findIndex((name) => roleKey(name) === key);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export type TeamRollup = {
  roles: TeamRole[];
  total: number;
  filled: number;
  deciding: number;
  empty: number;
  /** Names of the roles with nobody booked — the slots still to fill. */
  unfilled: string[];
  /** The unfilled roles that are essential. What the empty state asks for first. */
  unfilledEssential: string[];
  /** filled / total. `0` when there are no roles, never `NaN`. */
  fillFraction: number;
  /** "9 of 19 roles filled" — one string, so the list and the strip cannot drift. */
  label: string;
};

/**
 * The wedding-team summary: the progress bar, the count line, and — the part
 * that matters — the names of the roles still open.
 *
 * A count alone ("9 of 19") is a score. The research finding is that showing
 * the *slots* is what drives the next action, so `unfilled` is a list of names
 * the UI can render as dashed tiles, and `unfilledEssential` is the short list
 * worth nagging about.
 */
export function teamRollup(
  vendors: readonly VendorFact[],
  suggested: readonly string[] = DEFAULT_VENDOR_ROLE_NAMES,
): TeamRollup {
  const roles = teamRoles(vendors, suggested);
  const filled = roles.filter((role) => role.state === "filled");
  const deciding = roles.filter((role) => role.state === "deciding");
  const empty = roles.filter((role) => role.state === "empty");
  const unfilled = roles.filter((role) => !role.filled);

  return {
    roles,
    total: roles.length,
    filled: filled.length,
    deciding: deciding.length,
    empty: empty.length,
    unfilled: unfilled.map((role) => role.role),
    unfilledEssential: unfilled.filter((role) => role.essential).map((role) => role.role),
    fillFraction: roles.length === 0 ? 0 : filled.length / roles.length,
    label: `${filled.length} of ${roles.length} roles filled`,
  };
}

/* ---------------------------------------------------------- filter and sort */

export type VendorFilter = {
  status?: VendorStatus | "all";
  role?: string | "all";
  q?: string;
  /**
   * Only vendors on the "Contracts Outstanding" card: booked, nothing signed.
   * Defined as exactly that predicate so the card's number and the list it
   * links to can never disagree.
   */
  unsignedOnly?: boolean;
};

export type VendorSort = "name" | "status" | "cost_desc" | "role";

/** Fold accents and case so "Sanchez" finds "Sánchez". Mirrors `lib/search/guest-query.ts`. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const digits = (value: string): string => value.replace(/\D/g, "");

/**
 * Live search across everything she might remember about a vendor.
 *
 * Every token must land somewhere (typing two words narrows rather than
 * widens), and an all-digit token also gets to try the phone number with its
 * punctuation stripped, so "5551234" finds "(555) 123-4".
 *
 * A blank query matches everything — the caller does not special-case it.
 */
export function matchesVendorQuery(query: string, vendor: VendorSearchFact): boolean {
  const q = normalize(query ?? "");
  if (q.length === 0) return true;

  const haystacks = [
    normalize(vendor.name ?? ""),
    normalize(vendor.role ?? ""),
    normalize(vendor.contact_name ?? ""),
    normalize(vendor.company ?? ""),
    normalize(vendor.email ?? ""),
    normalize(vendor.website ?? ""),
    normalize(vendor.notes ?? ""),
    normalize(vendor.searchText ?? ""),
  ].filter((hay) => hay.length > 0);

  const phone = digits(vendor.phone ?? "");

  return q.split(" ").every((token) => {
    if (haystacks.some((hay) => hay.includes(token))) return true;
    const tokenDigits = digits(token);
    return tokenDigits.length >= 3 && phone.length > 0 && phone.includes(tokenDigits);
  });
}

/**
 * The one filter both sides use.
 *
 * The server page filters with it for the URL-driven chips and the client list
 * re-runs the identical function while she types, so server and client can
 * never disagree about what "quoted" means. Never mutates its input.
 */
export function filterVendors<T extends VendorSearchFact>(
  vendors: readonly T[],
  filter: VendorFilter = {},
): T[] {
  const wantRole = filter.role && filter.role !== "all" ? roleKey(filter.role) : null;

  return vendors.filter((vendor) => {
    if (filter.status && filter.status !== "all" && vendor.status !== filter.status) return false;
    if (wantRole !== null) {
      const has = (vendor.role ?? "").trim().length > 0;
      const key = has ? roleKey(vendor.role) : roleKey(UNASSIGNED_ROLE_LABEL);
      if (key !== wantRole) return false;
    }
    if (filter.unsignedOnly === true && !isContractOutstanding(vendor)) return false;
    if (filter.q !== undefined && !matchesVendorQuery(filter.q, vendor)) return false;
    return true;
  });
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

/** Total and deterministic: two rows never compare equal unless they are the same row. */
function tieBreak(a: VendorFact, b: VendorFact): number {
  const byName = compareText(a.name, b.name);
  if (byName !== 0) return byName;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id.localeCompare(b.id);
}

function byAttentionThenName(a: VendorFact, b: VendorFact): number {
  const byAttention = attentionRank(a.status) - attentionRank(b.status);
  if (byAttention !== 0) return byAttention;
  return tieBreak(a, b);
}

/**
 * The list's three sort modes, plus a status mode for the compare picker.
 *
 * `passed` vendors sink to the bottom of their group in every mode — she may
 * reconsider them, so they are never hidden, but they never sit above a live
 * decision either.
 *
 * Returns a new array; the caller's rows are untouched.
 */
export function sortVendors<T extends VendorFact>(vendors: readonly T[], sort: VendorSort): T[] {
  const roleOrder = new Map<string, number>(
    DEFAULT_VENDOR_ROLES.map((role, index) => [roleKey(role.name), index]),
  );
  const rank = (vendor: VendorFact): number => {
    const named = (vendor.role ?? "").trim();
    const key = named.length > 0 ? roleKey(named) : roleKey(UNASSIGNED_ROLE_LABEL);
    return roleOrder.get(key) ?? Number.POSITIVE_INFINITY;
  };
  const sunk = (vendor: VendorFact): number => (vendor.status === "passed" ? 1 : 0);

  const rows = [...vendors];

  switch (sort) {
    case "role":
      return rows.sort((a, b) => {
        // Suggested roles in their given order, invented roles after them
        // alphabetically. Compared with `<` rather than subtraction because
        // two invented roles are both `Infinity` and `Infinity - Infinity` is NaN.
        const rankA = rank(a);
        const rankB = rank(b);
        if (rankA !== rankB) return rankA < rankB ? -1 : 1;
        const roleA = (a.role ?? "").trim() || UNASSIGNED_ROLE_LABEL;
        const roleB = (b.role ?? "").trim() || UNASSIGNED_ROLE_LABEL;
        const byRole = compareText(roleA, roleB);
        if (byRole !== 0) return byRole;
        // `passed` carries the highest attention rank, so it sinks within the role.
        return byAttentionThenName(a, b);
      });

    case "cost_desc":
      return rows.sort((a, b) => {
        const bySunk = sunk(a) - sunk(b);
        if (bySunk !== 0) return bySunk;
        const costA = effectivePrice(a).cents;
        const costB = effectivePrice(b).cents;
        if (costA === null && costB === null) return tieBreak(a, b);
        // Nulls last: "no number yet" is not "cheapest".
        if (costA === null) return 1;
        if (costB === null) return -1;
        if (costA !== costB) return costB - costA;
        return tieBreak(a, b);
      });

    case "status":
      return rows.sort(byAttentionThenName);

    case "name":
    default:
      return rows.sort((a, b) => {
        const bySunk = sunk(a) - sunk(b);
        if (bySunk !== 0) return bySunk;
        return tieBreak(a, b);
      });
  }
}

/* ----------------------------------------------------------------- sync plan */

/** The subset of a `budget_items` row the sync decision reads. */
export type SyncItemFact = {
  id: string;
  name: string;
  contracted_cents: number | null;
  /**
   * `budget_items.contracted_source` — who last wrote that number. `"manual"`
   * means a human typed it on the budget side. Optional, because the column may
   * not be selected; when it is missing the plan falls back to comparing
   * against the vendor's previous price and, failing that, calls a conflict.
   */
  contracted_source?: "manual" | "vendor" | null;
};

export type SyncKind =
  /** The budget line had no contract price. Safe to write. */
  | "filled"
  /** The budget line still holds this vendor's previous price. Safe to write. */
  | "resynced"
  /** The budget line already says exactly this. Nothing to write. */
  | "unchanged"
  /** A human typed a different number. Never written; a person decides. */
  | "conflict";

export type SyncChange = {
  itemId: string;
  itemName: string;
  /** What the budget line says now. */
  fromCents: number | null;
  /** What the vendor's contract price says now. */
  toCents: number;
  /** What the vendor's contract price said before this edit. Null when unknown. */
  previousCents: number | null;
  kind: SyncKind;
  /** Why it was classified this way, in plain words the UI can show verbatim. */
  reason: string;
};

/** Why no sync is on the table at all. */
export type SyncSkipReason =
  /** The vendor has no contract price. Clearing one must never blank a budget line. */
  | "no_price"
  /** Nothing is linked to this vendor. */
  | "no_linked_items"
  /** Two or more budget lines are linked; the app cannot know which she meant. */
  | "ambiguous_link";

export type SyncPlan = {
  /** Every linked item, classified. Informational — do not write from this. */
  changes: SyncChange[];
  /**
   * The only list a caller may write. Empty whenever `skipped` is set, so a
   * caller that writes `writes` and reports `changes` can never write silently.
   */
  writes: SyncChange[];
  /** Changes a human must resolve. Never written by anyone but her. */
  conflicts: SyncChange[];
  /** `conflicts.length > 0` — the amber "Out of sync with budget" state. */
  requiresConfirm: boolean;
  /** Non-null when nothing may be written at all, and why. */
  skipped: SyncSkipReason | null;
};

/**
 * What *would* change in the budget if this vendor's contract price were
 * applied — and, just as importantly, what must not change without asking.
 *
 * One direction only: a vendor's price may flow into a linked budget line.
 * Nothing on the budget side ever writes back to the vendor, and no field of
 * the returned plan describes a vendor-side write.
 *
 * Three refusals, each of which would otherwise be a silent data loss:
 *
 * - `contractedCents == null` — clearing the vendor's price does **not** blank
 *   the budget line. Deleting a number by deleting a different number is never
 *   what she meant.
 * - Two or more linked items — nothing is written, because the app cannot know
 *   which line she meant, and guessing puts the wrong number in a total she
 *   trusts.
 * - The budget line holds a number a human typed — returned as a `conflict`,
 *   with both figures, for the UI to put side by side. This is the case the
 *   whole function exists for: the commercial tools either do not link vendors
 *   to the budget at all or overwrite without saying so.
 *
 * `previousContractedCents` is the vendor's price *before* this edit. When the
 * budget line still equals it, nobody has touched that number by hand since the
 * last sync, so replacing it is a resync rather than an overwrite. Omit it and
 * the plan gets stricter, not looser: without it, only a null budget line or an
 * explicit `contracted_source: "vendor"` counts as safe.
 *
 * This function does no I/O and decides nothing about whether to write. It
 * classifies.
 */
export function syncPlan(
  contractedCents: number | null,
  items: readonly SyncItemFact[],
  previousContractedCents?: number | null,
): SyncPlan {
  const previous = previousContractedCents === undefined ? null : previousContractedCents;
  const previousKnown = previousContractedCents !== undefined;

  if (contractedCents === null || contractedCents === undefined) {
    return empty("no_price");
  }
  if (items.length === 0) {
    return empty("no_linked_items");
  }

  const toCents = contractedCents;
  const changes = items.map((item): SyncChange => {
    const base = {
      itemId: item.id,
      itemName: item.name,
      fromCents: item.contracted_cents,
      toCents,
      previousCents: previous,
    };

    if (item.contracted_cents === toCents) {
      return { ...base, kind: "unchanged", reason: "The budget line already says this." };
    }
    if (item.contracted_cents === null || item.contracted_cents === undefined) {
      return { ...base, kind: "filled", reason: "The budget line has no contract price yet." };
    }
    if (previousKnown && previous !== null && item.contracted_cents === previous) {
      return {
        ...base,
        kind: "resynced",
        reason: "The budget line still holds this vendor's previous price.",
      };
    }
    if (item.contracted_source === "vendor") {
      return {
        ...base,
        kind: "resynced",
        reason: "The budget line was last written from this vendor, not by hand.",
      };
    }
    return {
      ...base,
      kind: "conflict",
      reason: "Someone typed this number on the budget side. Choose which one is right.",
    };
  });

  // More than one linked item: classify them all so the UI can name them, but
  // write nothing. `writes` and `conflicts` stay empty whenever `skipped` is set.
  if (items.length > 1) {
    return { changes, writes: [], conflicts: [], requiresConfirm: false, skipped: "ambiguous_link" };
  }

  const writes = changes.filter((c) => c.kind === "filled" || c.kind === "resynced");
  const conflicts = changes.filter((c) => c.kind === "conflict");
  return { changes, writes, conflicts, requiresConfirm: conflicts.length > 0, skipped: null };
}

function empty(skipped: SyncSkipReason): SyncPlan {
  return { changes: [], writes: [], conflicts: [], requiresConfirm: false, skipped };
}

/* ---------------------------------------------------------------- validation */

export type VendorField =
  | "name"
  | "role"
  | "status"
  | "email"
  | "quoted_cents"
  | "contracted_cents";

export type VendorFieldError = { field: VendorField; message: string };

/** Something worth saying out loud that must not stop her saving. */
export type VendorNotice = { field: VendorField; message: string };

export type VendorDraft = {
  name: string;
  role?: string | null;
  status?: string | null;
  email?: string | null;
  quoted_cents?: number | null;
  contracted_cents?: number | null;
};

export type VendorValidation =
  | {
      ok: true;
      value: {
        name: string;
        role: string | null;
        status: VendorStatus;
        email: string | null;
        quoted_cents: number | null;
        contracted_cents: number | null;
      };
      warnings: VendorNotice[];
    }
  | { ok: false; errors: VendorFieldError[] };

/** Blank, whitespace-only, null and undefined all mean "not set". */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Only the name is required. A half-researched vendor — a name on a napkin and
 * nothing else — is the normal state of this table for months, and a form that
 * demands a price before it will save is a form she stops opening.
 *
 * Everything else that looks wrong is a *warning*: it is returned on the `ok`
 * branch, so the save goes through and the screen still says the thing. The two
 * that earn a warning are the ones that quietly break a total later — a booked
 * vendor with no price (the budget will not include them) and a contract more
 * than triple its quote (usually a typo, occasionally real).
 */
export function validateVendor(draft: VendorDraft): VendorValidation {
  const errors: VendorFieldError[] = [];
  const warnings: VendorNotice[] = [];

  const name = (draft.name ?? "").trim();
  if (name.length === 0) {
    errors.push({ field: "name", message: "Give this vendor a name." });
  }

  const email = blankToNull(draft.email);
  if (email !== null && !email.includes("@")) {
    errors.push({ field: "email", message: "That email address looks incomplete." });
  }

  const rawStatus = blankToNull(draft.status) ?? "researching";
  if (!isVendorStatus(rawStatus)) {
    errors.push({ field: "status", message: "That isn't one of the vendor statuses." });
  }
  const status: VendorStatus = isVendorStatus(rawStatus) ? rawStatus : "researching";

  const quoted = draft.quoted_cents ?? null;
  const contracted = draft.contracted_cents ?? null;
  if (quoted !== null && quoted < 0) {
    errors.push({ field: "quoted_cents", message: "A price can't be negative." });
  }
  if (contracted !== null && contracted < 0) {
    errors.push({ field: "contracted_cents", message: "A price can't be negative." });
  }

  if (status === "booked" && contracted === null) {
    warnings.push({
      field: "contracted_cents",
      message: "Booked with no contracted price — the budget total won't include this yet.",
    });
  }
  if (contracted !== null && quoted !== null && quoted > 0 && contracted > quoted * 3) {
    warnings.push({
      field: "contracted_cents",
      message: "That contract price is more than three times the quote — worth a second look.",
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, role: blankToNull(draft.role), status, email, quoted_cents: quoted, contracted_cents: contracted },
    warnings,
  };
}
