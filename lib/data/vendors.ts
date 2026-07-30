import type { WeddingScope } from "./scope";
import type { BudgetItemRow, VendorPriority, VendorRow, VendorStatus } from "@/lib/types";
import * as activity from "./activity";
import { invalidateCache } from "@/lib/limiter";
import {
  filterVendors,
  sortVendors,
  syncPlan,
  validateVendor,
  type SyncItemFact,
  type SyncPlan,
  type VendorFact,
  type VendorFieldError,
  type VendorFilter,
  type VendorNotice,
  type VendorSort,
} from "./vendor-rules";
import { rollUpItem, type ItemFact, type ItemRollup, type PaymentFact } from "./budget-rules";
import { ITEM_FACT_COLS, PAYMENT_FACT_COLS, toPaymentFact, type PaymentFactRow } from "./budget";

/**
 * I/O for vendors, plus the one write that crosses into the budget: pushing a
 * vendor's contracted price onto the budget lines linked to them.
 *
 * Same contract as every other `lib/data` module. Every function takes a
 * `WeddingScope` first; every query chains `.eq("wedding_id", scope.weddingId)`
 * even when a foreign key has already narrowed it, because the admin surface
 * runs on the service-role client and bypasses RLS — that filter is the real
 * tenancy guard. Ids from a page or a form go through `requireVendor` before a
 * write touches the row.
 *
 * All the deciding happens in `vendor-rules.ts` and `budget-rules.ts`: what
 * counts as booked, which vendors are chasing a signature, how a list is
 * filtered and sorted, and — the important one — whether a vendor's price may
 * be written onto a budget line at all. This file fetches, delegates, writes
 * what the plan says it may write, and returns the plan.
 */

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const VENDOR_COLS =
  "id, wedding_id, category_id, name, role, status, priority, assigned_to, contact_name, company, email, phone, website, instagram, address, estimated_cents, quoted_cents, contracted_cents, currency, contract_signed_at, booked_at, contract_url, rating, notes, sort_order";

/** Exactly the fields the pure rules read — for the metrics call and the team strip. */
const VENDOR_FACT_COLS =
  "id, name, role, status, estimated_cents, quoted_cents, contracted_cents, contract_signed_at, currency, sort_order";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Thrown when `validateVendor` rejects a draft, carrying per-field messages. */
export class VendorValidationError extends Error {
  constructor(public errors: VendorFieldError[]) {
    super(errors.map((e) => e.message).join(" "));
    this.name = "VendorValidationError";
  }
}

/**
 * A vendor draft. Every field is optional so an inline edit can send one field;
 * `create` still fails validation without a name, and `update` merges anything
 * omitted from the stored row before validating.
 */
export type VendorInput = {
  name?: string;
  role?: string | null;
  status?: string | null;
  categoryId?: string | null;
  priority?: VendorPriority;
  assignedTo?: string | null;
  contactName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  instagram?: string | null;
  address?: string | null;
  estimatedCents?: number | null;
  quotedCents?: number | null;
  contractedCents?: number | null;
  currency?: string;
  /** Calendar date, "YYYY-MM-DD". */
  contractSignedAt?: string | null;
  /** Calendar date. */
  bookedAt?: string | null;
  contractUrl?: string | null;
  rating?: number | null;
  notes?: string | null;
};

export type VendorWithRollup = VendorRow & {
  linkedItemCount: number;
  /** Σ paid payments across linked items. */
  paidCents: number;
  /** Σ forecast across linked items. */
  forecastCents: number;
  /** Earliest unpaid due date across linked items, or null. */
  nextDueDate: string | null;
  hasOverduePayment: boolean;
};

export type VendorDetail = {
  vendor: VendorRow;
  /** This vendor's budget lines, rolled up by `budget-rules`. */
  items: ItemRollup[];
  /** Lines with no vendor yet, for the "attach a budget line" picker. */
  unlinkedItemOptions: Array<{ id: string; name: string; categoryName: string }>;
  totals: { forecastCents: number; paidCents: number; remainingCents: number };
};

export type VendorRemovalImpact = {
  linkedItems: number;
  itemNames: string[];
  paymentsOnThoseItems: number;
};

/** A vendor write, plus anything `validateVendor` wanted said out loud. */
export type VendorWriteResult = {
  vendor: VendorRow;
  warnings: VendorNotice[];
  /**
   * The result of pushing this vendor's contract price into the budget. Null
   * when the write never touched `contractedCents`, so no sync was considered.
   */
  sync: SyncPlan | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every vendor write moves an Overview number; the cache clears beside the write. */
function invalidateMetrics(scope: WeddingScope): void {
  invalidateCache(`metrics:${scope.weddingId}`);
}

function orNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `updated_at` is a `timestamptz`, unlike the `date` columns around it. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Confirms a vendor belongs to this wedding before any write touches it. */
async function requireVendor(scope: WeddingScope, id: string): Promise<VendorRow> {
  const { data, error } = await scope.db
    .from("vendors")
    .select(VENDOR_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Vendor not found in this wedding");
  return data as VendorRow;
}

/** Just enough of a line to link it, unlink it and name it in the log. */
type LinkableItem = Pick<
  BudgetItemRow,
  "id" | "category_id" | "vendor_id" | "name" | "contracted_cents" | "contracted_source"
>;

/** Confirms a budget line belongs to this wedding before it is linked or unlinked. */
async function requireItemId(scope: WeddingScope, itemId: string): Promise<LinkableItem> {
  const { data, error } = await scope.db
    .from("budget_items")
    .select("id, category_id, vendor_id, name, contracted_cents, contracted_source")
    .eq("wedding_id", scope.weddingId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Budget line not found in this wedding");
  return data as LinkableItem;
}

/** Reads every budget line and payment in the wedding, projected to the facts. */
async function readBudgetFacts(
  scope: WeddingScope,
): Promise<{ items: ItemFact[]; payments: PaymentFact[] }> {
  const [itemsResult, paymentsResult] = await Promise.all([
    scope.db
      .from("budget_items")
      .select(ITEM_FACT_COLS)
      .eq("wedding_id", scope.weddingId)
      .order("sort_order")
      .order("id"),
    scope.db
      .from("budget_payments")
      .select(PAYMENT_FACT_COLS)
      .eq("wedding_id", scope.weddingId)
      .order("due_date", { nullsFirst: false })
      .order("id"),
  ]);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);

  return {
    items: (itemsResult.data ?? []) as ItemFact[],
    payments: ((paymentsResult.data ?? []) as PaymentFactRow[]).map(toPaymentFact),
  };
}

/**
 * The soonest unpaid due date among a vendor's lines.
 *
 * Calendar days compare correctly as `YYYY-MM-DD` strings, which is the whole
 * reason they are stored that way — sorting them as text is the same as sorting
 * them as days, with no zone to get wrong.
 */
function earliestUnpaidDueDate(rollups: ItemRollup[]): string | null {
  const dates = rollups
    .flatMap((r) => r.payments)
    .filter((p) => !p.paid && p.due_date !== null)
    .map((p) => p.due_date as string)
    .sort();
  return dates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The vendor list with each vendor's budget position attached.
 *
 * Three parallel selects — vendors, budget lines, payments — and then every
 * derived number comes from `budget-rules.rollUpItem`, so a vendor's "paid" and
 * the budget page's "paid" are the same function over the same rows.
 *
 * Filtering and sorting happen **in memory** rather than in the query. One
 * wedding has tens of vendors, and one code path means the server-rendered page
 * and the client list that re-filters as she types cannot disagree about what
 * "quoted" or "unsigned" means.
 *
 * `now` and `timeZone` are parameters because "overdue" is a question about the
 * day it is at the venue, and this module never reads a clock of its own.
 */
export async function list(
  scope: WeddingScope,
  now: Date,
  timeZone: string,
  filter?: VendorFilter,
  sort: VendorSort = "status",
): Promise<VendorWithRollup[]> {
  const [vendorsResult, budget] = await Promise.all([
    scope.db
      .from("vendors")
      .select(VENDOR_COLS)
      .eq("wedding_id", scope.weddingId)
      .order("sort_order")
      .order("name"),
    readBudgetFacts(scope),
  ]);
  if (vendorsResult.error) throw new Error(vendorsResult.error.message);
  const vendors = (vendorsResult.data ?? []) as VendorRow[];

  const rollupsByVendor = new Map<string, ItemRollup[]>();
  for (const item of budget.items) {
    if (item.vendor_id === null) continue;
    const rollup = rollUpItem(item, budget.payments, now, timeZone);
    const bucket = rollupsByVendor.get(item.vendor_id);
    if (bucket) bucket.push(rollup);
    else rollupsByVendor.set(item.vendor_id, [rollup]);
  }

  const rows: VendorWithRollup[] = vendors.map((vendor) => {
    const mine = rollupsByVendor.get(vendor.id) ?? [];
    return {
      ...vendor,
      linkedItemCount: mine.length,
      paidCents: mine.reduce((sum, r) => sum + r.paidCents, 0),
      forecastCents: mine.reduce((sum, r) => sum + r.forecastCents, 0),
      nextDueDate: earliestUnpaidDueDate(mine),
      hasOverduePayment: mine.some((r) => r.hasOverdue),
    };
  });

  return sortVendors(filterVendors(rows, filter), sort);
}

/** The narrow projection the rules need — for `metrics.budget` and the team strip. */
export async function facts(scope: WeddingScope): Promise<VendorFact[]> {
  const { data, error } = await scope.db
    .from("vendors")
    .select(VENDOR_FACT_COLS)
    .eq("wedding_id", scope.weddingId)
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as VendorFact[];
}

export async function get(scope: WeddingScope, id: string): Promise<VendorRow> {
  return requireVendor(scope, id);
}

/**
 * One vendor, their budget lines, and the lines they could be attached to.
 *
 * Four queries: the vendor, then the wedding's lines, payments and category
 * names in parallel. Reading all the lines and splitting them in memory is
 * cheaper than two filtered round trips at this size, and it is what makes the
 * "attach a budget line" picker free.
 */
export async function detail(
  scope: WeddingScope,
  id: string,
  now: Date,
  timeZone: string,
): Promise<VendorDetail> {
  const vendor = await requireVendor(scope, id);

  const [budget, categoriesResult] = await Promise.all([
    readBudgetFacts(scope),
    scope.db
      .from("budget_categories")
      .select("id, name")
      .eq("wedding_id", scope.weddingId)
      .order("sort_order")
      .order("id"),
  ]);
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);
  const categoryNames = new Map(
    ((categoriesResult.data ?? []) as Array<{ id: string; name: string }>).map((c) => [
      c.id,
      c.name,
    ]),
  );

  const items = budget.items
    .filter((item) => item.vendor_id === id)
    .map((item) => rollUpItem(item, budget.payments, now, timeZone));

  const forecastCents = items.reduce((sum, r) => sum + r.forecastCents, 0);
  const paidCents = items.reduce((sum, r) => sum + r.paidCents, 0);

  return {
    vendor,
    items,
    unlinkedItemOptions: budget.items
      .filter((item) => item.vendor_id === null)
      .map((item) => ({
        id: item.id,
        name: item.name,
        categoryName: categoryNames.get(item.category_id) ?? "",
      })),
    totals: {
      forecastCents,
      paidCents,
      // Floored for the same reason the rules floor it: "−$400 remaining"
      // reads as a broken app rather than as an overpayment.
      remainingCents: Math.max(0, forecastCents - paidCents),
    },
  };
}

/** The distinct roles she has actually used, for the filter and the role picker. */
export async function rolesInUse(scope: WeddingScope): Promise<string[]> {
  const { data, error } = await scope.db
    .from("vendors")
    .select("role")
    .eq("wedding_id", scope.weddingId);
  if (error) throw new Error(error.message);

  const roles = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ role: string | null }>) {
    const role = (row.role ?? "").trim();
    if (role.length === 0) continue;
    // First casing wins, so the list does not show "DJ" and "dj" as two roles.
    const key = role.toLowerCase();
    if (!roles.has(key)) roles.set(key, role);
  }
  return [...roles.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Validates a draft, merging anything the caller omitted from the stored row so
 * an inline edit of one field does not have to resend the vendor.
 */
function validated(input: VendorInput, existing?: VendorRow) {
  const validation = validateVendor({
    name: input.name ?? existing?.name ?? "",
    role: input.role !== undefined ? input.role : existing?.role,
    status: input.status !== undefined ? input.status : existing?.status,
    email: input.email !== undefined ? input.email : existing?.email,
    quoted_cents: input.quotedCents !== undefined ? input.quotedCents : existing?.quoted_cents,
    contracted_cents:
      input.contractedCents !== undefined ? input.contractedCents : existing?.contracted_cents,
  });
  if (!validation.ok) throw new VendorValidationError(validation.errors);
  return validation;
}

export async function create(
  scope: WeddingScope,
  input: VendorInput,
  actorId?: string,
): Promise<VendorWriteResult> {
  const validation = validated(input);
  if (input.categoryId) await requireCategoryId(scope, input.categoryId);

  const { data: last, error: lastError } = await scope.db
    .from("vendors")
    .select("sort_order")
    .eq("wedding_id", scope.weddingId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(lastError.message);
  const lastRow: { sort_order: number } | null = last;

  const { data, error } = await scope.db
    .from("vendors")
    .insert({
      wedding_id: scope.weddingId,
      category_id: input.categoryId ?? null,
      name: validation.value.name,
      // The column is `not null default 'other'`; omitting it lets the default
      // stand rather than writing a null the constraint would refuse.
      ...(validation.value.role !== null ? { role: validation.value.role } : {}),
      status: validation.value.status,
      ...(input.priority ? { priority: input.priority } : {}),
      assigned_to: orNull(input.assignedTo),
      contact_name: orNull(input.contactName),
      company: orNull(input.company),
      email: validation.value.email,
      phone: orNull(input.phone),
      website: orNull(input.website),
      instagram: orNull(input.instagram),
      address: orNull(input.address),
      estimated_cents: input.estimatedCents ?? null,
      quoted_cents: validation.value.quoted_cents,
      contracted_cents: validation.value.contracted_cents,
      ...(input.currency ? { currency: input.currency } : {}),
      contract_signed_at: orNull(input.contractSignedAt),
      booked_at: orNull(input.bookedAt),
      contract_url: orNull(input.contractUrl),
      rating: input.rating ?? null,
      notes: orNull(input.notes),
      sort_order: lastRow === null ? 0 : lastRow.sort_order + 1,
    })
    .select(VENDOR_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const vendor = data as VendorRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "vendor.created",
    payload: { vendorId: vendor.id, name: vendor.name, role: vendor.role, status: vendor.status },
  });
  // A brand-new vendor cannot have a linked budget line yet, so there is
  // nothing to sync and saying "null" is more honest than an empty plan.
  return { vendor, warnings: validation.warnings, sync: null };
}

/**
 * Patches the fields the caller sent, then — **only if the input named
 * `contractedCents`** — pushes that price to the vendor's budget lines.
 *
 * The push is not automatic and it is not silent: `syncContractedToItems`
 * returns the plan, including the changes it refused to make, so the action can
 * tell her exactly what else moved and what needs her decision.
 */
export async function update(
  scope: WeddingScope,
  id: string,
  input: VendorInput,
  actorId?: string,
): Promise<VendorWriteResult> {
  const existing = await requireVendor(scope, id);
  const validation = validated(input, existing);
  if (input.categoryId) await requireCategoryId(scope, input.categoryId);

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.name !== undefined) patch.name = validation.value.name;
  if (input.role !== undefined) patch.role = validation.value.role ?? "other";
  if (input.status !== undefined) patch.status = validation.value.status;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.assignedTo !== undefined) patch.assigned_to = orNull(input.assignedTo);
  if (input.contactName !== undefined) patch.contact_name = orNull(input.contactName);
  if (input.company !== undefined) patch.company = orNull(input.company);
  if (input.email !== undefined) patch.email = validation.value.email;
  if (input.phone !== undefined) patch.phone = orNull(input.phone);
  if (input.website !== undefined) patch.website = orNull(input.website);
  if (input.instagram !== undefined) patch.instagram = orNull(input.instagram);
  if (input.address !== undefined) patch.address = orNull(input.address);
  if (input.estimatedCents !== undefined) patch.estimated_cents = input.estimatedCents;
  if (input.quotedCents !== undefined) patch.quoted_cents = validation.value.quoted_cents;
  if (input.contractedCents !== undefined) patch.contracted_cents = validation.value.contracted_cents;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.contractSignedAt !== undefined) patch.contract_signed_at = orNull(input.contractSignedAt);
  if (input.bookedAt !== undefined) patch.booked_at = orNull(input.bookedAt);
  if (input.contractUrl !== undefined) patch.contract_url = orNull(input.contractUrl);
  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.notes !== undefined) patch.notes = orNull(input.notes);

  const { data, error } = await scope.db
    .from("vendors")
    .update(patch)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(VENDOR_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const vendor = data as VendorRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "vendor.updated",
    payload: { vendorId: id, name: vendor.name, status: vendor.status },
  });

  const sync =
    input.contractedCents === undefined
      ? null
      : await syncContractedToItems(scope, id, existing.contracted_cents, actorId);

  return { vendor, warnings: validation.warnings, sync };
}

/**
 * Moves a vendor along the lifecycle.
 *
 * Logs `vendor.booked` rather than a generic status change when she books
 * someone, because the couple's activity feed should read like news. Signing is
 * a separate, deliberate edit: this never stamps `contract_signed_at`, which is
 * exactly what keeps a newly booked vendor on the "Contracts Outstanding" card.
 */
export async function setStatus(
  scope: WeddingScope,
  id: string,
  status: VendorStatus,
  actorId?: string,
): Promise<VendorRow> {
  const existing = await requireVendor(scope, id);
  const validation = validated({ status }, existing);

  const { data, error } = await scope.db
    .from("vendors")
    .update({ status: validation.value.status, updated_at: nowIso() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(VENDOR_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const vendor = data as VendorRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: status === "booked" ? "vendor.booked" : "vendor.status_changed",
    payload: { vendorId: id, name: vendor.name, from: existing.status, to: vendor.status },
  });
  return vendor;
}

/** What deleting a vendor would touch, for the confirmation dialog. */
export async function removalImpact(
  scope: WeddingScope,
  id: string,
): Promise<VendorRemovalImpact> {
  await requireVendor(scope, id);

  const { data: items, error: itemsError } = await scope.db
    .from("budget_items")
    .select("id, name")
    .eq("wedding_id", scope.weddingId)
    .eq("vendor_id", id)
    .order("sort_order")
    .order("id");
  if (itemsError) throw new Error(itemsError.message);
  const rows = (items ?? []) as Array<{ id: string; name: string }>;

  if (rows.length === 0) return { linkedItems: 0, itemNames: [], paymentsOnThoseItems: 0 };

  const { count, error: paymentsError } = await scope.db
    .from("budget_payments")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", scope.weddingId)
    .in(
      "budget_item_id",
      rows.map((r) => r.id),
    );
  if (paymentsError) throw new Error(paymentsError.message);

  return {
    linkedItems: rows.length,
    itemNames: rows.map((r) => r.name),
    paymentsOnThoseItems: count ?? 0,
  };
}

/**
 * Deletes a vendor. **Budget lines survive** — they are unlinked first, not
 * deleted, because the money was always the couple's line item and the vendor
 * was a label on it.
 *
 * The unlink is a real write, not a foreign-key side effect: the FK is
 * `on delete restrict` (a composite `set null` would also null `wedding_id`,
 * which is `not null`), so Postgres refuses the delete until nothing points at
 * the row. Payments carry their own optional `vendor_id` and are unlinked the
 * same way.
 *
 * There is no undo, so the impact is written into the activity payload.
 */
export async function remove(
  scope: WeddingScope,
  id: string,
  actorId?: string,
): Promise<VendorRemovalImpact> {
  const vendor = await requireVendor(scope, id);
  const impact = await removalImpact(scope, id);

  const unlinked = await Promise.all([
    scope.db
      .from("budget_items")
      .update({ vendor_id: null, updated_at: nowIso() })
      .eq("wedding_id", scope.weddingId)
      .eq("vendor_id", id),
    scope.db
      .from("budget_payments")
      .update({ vendor_id: null, updated_at: nowIso() })
      .eq("wedding_id", scope.weddingId)
      .eq("vendor_id", id),
  ]);
  for (const result of unlinked) {
    if (result.error) throw new Error(result.error.message);
  }

  const { error } = await scope.db
    .from("vendors")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "vendor.removed",
    payload: { vendorId: id, name: vendor.name, unlinked: impact },
  });
  return impact;
}

/**
 * Attaches a budget line to a vendor, then offers the vendor's contract price
 * to that line through the usual plan — so linking never overwrites a number
 * she typed without asking.
 */
export async function linkItem(
  scope: WeddingScope,
  vendorId: string,
  itemId: string,
  actorId?: string,
): Promise<SyncPlan> {
  const vendor = await requireVendor(scope, vendorId);
  const item = await requireItemId(scope, itemId);

  const { error } = await scope.db
    .from("budget_items")
    .update({ vendor_id: vendorId, updated_at: nowIso() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "vendor.item_linked",
    payload: { vendorId, vendorName: vendor.name, itemId, itemName: item.name },
  });

  return syncContractedToItems(scope, vendorId, undefined, actorId);
}

/** Detaches a budget line from its vendor. The line and its payments stay. */
export async function unlinkItem(
  scope: WeddingScope,
  itemId: string,
  actorId?: string,
): Promise<void> {
  const item = await requireItemId(scope, itemId);

  const { error } = await scope.db
    .from("budget_items")
    .update({ vendor_id: null, updated_at: nowIso() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "vendor.item_unlinked",
    payload: { vendorId: item.vendor_id, itemId, itemName: item.name },
  });
}

/**
 * Pushes a vendor's contracted price onto the budget lines linked to them —
 * but only the ones `syncPlan` says may be written.
 *
 * The direction is one way and the refusals are the point: clearing a vendor's
 * price never blanks a budget line, two linked lines are ambiguous and write
 * nothing, and a number a human typed on the budget side comes back as a
 * `conflict` for her to resolve rather than being replaced. The whole plan is
 * returned either way, so a caller can show what changed *and* what did not.
 *
 * `previousContractedCents` is the vendor's price before this edit; with it,
 * a line still holding the old price is a resync rather than an overwrite.
 * Passing `undefined` makes the plan stricter, never looser.
 *
 * The migration also ships a `set_vendor_contracted_price` RPC that writes
 * every linked line unconditionally. It is deliberately not used: it cannot
 * express "refuse this one", which is the rule this function exists to enforce.
 */
export async function syncContractedToItems(
  scope: WeddingScope,
  vendorId: string,
  previousContractedCents: number | null | undefined,
  actorId?: string,
): Promise<SyncPlan> {
  const vendor = await requireVendor(scope, vendorId);

  const { data, error } = await scope.db
    .from("budget_items")
    .select("id, name, contracted_cents, contracted_source")
    .eq("wedding_id", scope.weddingId)
    .eq("vendor_id", vendorId)
    .order("sort_order")
    .order("id");
  if (error) throw new Error(error.message);
  const items = (data ?? []) as SyncItemFact[];

  const plan = syncPlan(vendor.contracted_cents, items, previousContractedCents);
  if (plan.writes.length === 0) return plan;

  const results = await Promise.all(
    plan.writes.map((change) =>
      scope.db
        .from("budget_items")
        .update({
          contracted_cents: change.toCents,
          // Records that this number came from the vendor, so the next sync
          // knows it is safe to move and the UI can say where it came from.
          contracted_source: "vendor",
          currency: vendor.currency,
          updated_at: nowIso(),
        })
        .eq("wedding_id", scope.weddingId)
        .eq("id", change.itemId),
    ),
  );
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
  }
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "vendor.contract_synced",
    payload: {
      vendorId,
      vendorName: vendor.name,
      contractedCents: vendor.contracted_cents,
      written: plan.writes,
      conflicts: plan.conflicts,
    },
  });
  return plan;
}

/** Confirms a category belongs to this wedding before a vendor is filed under it. */
async function requireCategoryId(scope: WeddingScope, categoryId: string): Promise<void> {
  const { data, error } = await scope.db
    .from("budget_categories")
    .select("id")
    .eq("wedding_id", scope.weddingId)
    .eq("id", categoryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Category not found in this wedding");
}
