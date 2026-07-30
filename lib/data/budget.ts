import type { WeddingScope } from "./scope";
import type {
  BudgetCategoryRow,
  BudgetItemRow,
  BudgetPaymentRow,
  PaymentKind,
  VendorStatus,
} from "@/lib/types";
import * as activity from "./activity";
import { invalidateCache } from "@/lib/limiter";
import {
  allocateByPercent,
  assembleTree,
  effectiveCostCents,
  overduePayments,
  paymentsDueThisMonth,
  rollUpBudget,
  splitDeposit,
  upcomingPayments,
  validateCategory,
  validateItem,
  validatePayment,
  type AllocationSlice,
  type BudgetFieldError,
  type BudgetTotals,
  type CategoryFact,
  type CategoryRollup,
  type ItemFact,
  type PaymentFact,
  type PaymentView,
} from "./budget-rules";

/**
 * I/O for the budget: `budget_categories`, `budget_items`, `budget_payments`,
 * and the three `weddings` budget columns. Nothing here decides anything.
 *
 * Every number this module returns is computed by `budget-rules.ts`, because
 * vitest only sees `lib/**` and a rollup written inline in a page or an action
 * is a rollup nobody can test. This file fetches, hands the rows to a pure
 * function, and returns what comes back.
 *
 * Every function takes a `WeddingScope` first and every query — including the
 * ones a foreign key has already narrowed — chains
 * `.eq("wedding_id", scope.weddingId)`. The admin surface runs on the
 * service-role client, which bypasses RLS entirely, so that filter is the
 * tenancy guarantee and RLS is only the backstop. Ids arriving from a page, a
 * form or a drag handler are client input: anything that names an existing row
 * goes through a `require*` guard first, so a foreign id becomes an error
 * rather than a silent no-op or a cross-tenant write.
 *
 * Two shapes of date live here and they are not interchangeable. `due_date`,
 * `paid_at` and `contract_signed_at` are Postgres `date` columns — calendar
 * days with no instant and no zone — and never touch `new Date()`; the caller
 * supplies `now` and the venue's `timeZone` and `budget-rules` does the
 * comparison. `updated_at` is a real instant and is stamped normally.
 */

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const CATEGORY_COLS =
  "id, wedding_id, name, slug, sort_order, target_cents, benchmark_cents, is_contingency, notes";

const ITEM_COLS =
  "id, wedding_id, category_id, vendor_id, name, qty, unit_price_cents, benchmark_cents, estimated_cents, quoted_cents, contracted_cents, contracted_source, currency, pending_guest_count, is_reconciliation, notes, sort_order";

const PAYMENT_COLS =
  "id, wedding_id, budget_item_id, vendor_id, label, kind, amount_cents, currency, due_date, paid_at, method, reference, receipt_url, notes, sort_order";

const WEDDING_BUDGET_COLS = "budget_total_cents, budget_currency, budget_benchmark_label";

/**
 * The narrow projections the rollups actually need.
 *
 * Exported because `lib/data/vendors.ts` reads the same two tables for its own
 * rollups: one definition means the vendor list and the budget page can never
 * be looking at different columns, and — more importantly — can never disagree
 * about what "paid" means.
 */
export const ITEM_FACT_COLS =
  "id, category_id, vendor_id, name, benchmark_cents, estimated_cents, quoted_cents, contracted_cents, currency, pending_guest_count, sort_order";

export const PAYMENT_FACT_COLS = "id, budget_item_id, label, amount_cents, due_date, paid_at";

export type PaymentFactRow = Pick<
  BudgetPaymentRow,
  "id" | "budget_item_id" | "label" | "amount_cents" | "due_date" | "paid_at"
>;

/**
 * A `budget_payments` row as the rules module wants it.
 *
 * The database has no `paid` boolean on purpose: `paid_at` is both the flag and
 * the date, so the two can never disagree (there is no state where a payment is
 * marked paid on no day, or dated but unpaid). The in-memory fact type keeps
 * them as separate fields because the rules read them separately, and this is
 * the one place the translation happens. The parent column is
 * `budget_item_id`; the fact calls it `item_id`.
 */
export function toPaymentFact(row: PaymentFactRow): PaymentFact {
  return {
    id: row.id,
    item_id: row.budget_item_id,
    label: row.label,
    amount_cents: row.amount_cents,
    due_date: row.due_date,
    paid: row.paid_at !== null,
    paid_on: row.paid_at,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Thrown when a rule module rejects a draft, carrying per-field messages. */
export class BudgetValidationError extends Error {
  constructor(public errors: BudgetFieldError[]) {
    super(errors.map((e) => e.message).join(" "));
    this.name = "BudgetValidationError";
  }
}

/** The wedding-level budget settings, all three from one row. */
export type BudgetSettings = {
  /** `weddings.budget_total_cents`. Null means unset — the UI prompts, it never shows $0. */
  maxSpendCents: number | null;
  currency: string;
  /** `weddings.budget_benchmark_label`. The benchmark's name lives here, never in code. */
  benchmarkLabel: string;
};

export type BudgetTree = {
  categories: CategoryRollup[];
  totals: BudgetTotals;
  /** Every vendor in the wedding, for naming an item's vendor without a second query. */
  vendorsById: Record<string, { id: string; name: string; status: VendorStatus }>;
  overdue: PaymentView[];
  upcoming: PaymentView[];
  timeZone: string;
  benchmarkLabel: string;
  currency: string;
};

export type BudgetSummary = {
  maxSpendCents: number | null;
  forecastCents: number;
  paidCents: number;
  /** forecast − paid, floored at zero. "Still to pay". */
  dueCents: number;
  benchmarkCents: number;
  benchmarkDeltaCents: number | null;
  /** maxSpend − forecast. "Left in budget". Null when no total is set; negative means over. */
  remainingAfterForecastCents: number | null;
  /** Σ unpaid scheduled payments. */
  scheduledUnpaidCents: number;
  health: BudgetTotals["health"];
  overdueCount: number;
  overdueCents: number;
  dueThisMonthCount: number;
  dueThisMonthCents: number;
  mixedCurrency: boolean;
  itemCount: number;
  currency: string;
  benchmarkLabel: string;
};

/**
 * A category draft. Every field is optional so an inline edit can send one:
 * `update` merges the omitted ones from the stored row before validating.
 */
export type BudgetCategoryInput = {
  name?: string;
  targetCents?: number | null;
  benchmarkCents?: number | null;
  isContingency?: boolean;
  notes?: string | null;
};

/** A budget line draft. `categoryId` and `name` are required on create only. */
export type BudgetItemInput = {
  categoryId?: string;
  vendorId?: string | null;
  name?: string;
  /** Free text: the source sheet has "2", "180" and "100 liters (abundant)". */
  qty?: string | null;
  unitPriceCents?: number | null;
  benchmarkCents?: number | null;
  estimatedCents?: number | null;
  quotedCents?: number | null;
  contractedCents?: number | null;
  currency?: string;
  pendingGuestCount?: boolean;
  notes?: string | null;
};

/** A payment draft. `itemId` and `amountCents` are required on create only. */
export type PaymentInput = {
  itemId?: string;
  vendorId?: string | null;
  label?: string | null;
  kind?: PaymentKind;
  /** Always positive, even for a refund — the sign is applied from `kind`. */
  amountCents?: number | null;
  currency?: string;
  dueDate?: string | null;
  paid?: boolean;
  paidOn?: string | null;
  method?: string | null;
  reference?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
};

/**
 * A write plus anything the validator wanted said out loud.
 *
 * The rule modules deliberately return warnings on the `ok` branch — an
 * unpriced line and a payment schedule that exceeds the recorded cost are both
 * legitimate — so the shell carries them out rather than dropping them, which
 * would make the rule unreachable from the UI.
 */
export type ItemWriteResult = { item: BudgetItemRow; warning: string | null };
export type PaymentWriteResult = { payment: BudgetPaymentRow; warning: string | null };

export type CategoryRemovalImpact = {
  items: number;
  payments: number;
  paidCents: number;
  /** Vendors filed under this category. They block a delete too (FK is `restrict`). */
  vendors: number;
};

/** Upcoming payments reach a month ahead unless the caller says otherwise. */
export const UPCOMING_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Every budget write moves an Overview number; the cache clears beside the write. */
function invalidateMetrics(scope: WeddingScope): void {
  invalidateCache(`metrics:${scope.weddingId}`);
}

/** Blank strings from a form mean "not set", not an empty value. */
function orNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `updated_at` is a `timestamptz` — a real instant, unlike the `date` columns. */
function nowIso(): string {
  return new Date().toISOString();
}

/** A stable machine key for a category, so a later rename cannot break the seed. */
function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "category";
}

/** `slugify`, then `-2`, `-3`… until it is free. The column is unique per wedding. */
function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Case- and whitespace-insensitive name match, for "does this category exist?". */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Guards — every client-supplied id is confirmed to be ours before a write
// ---------------------------------------------------------------------------

async function requireCategory(scope: WeddingScope, id: string): Promise<BudgetCategoryRow> {
  const { data, error } = await scope.db
    .from("budget_categories")
    .select(CATEGORY_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Category not found in this wedding");
  return data as BudgetCategoryRow;
}

async function requireItem(scope: WeddingScope, id: string): Promise<BudgetItemRow> {
  const { data, error } = await scope.db
    .from("budget_items")
    .select(ITEM_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Budget line not found in this wedding");
  return data as BudgetItemRow;
}

async function requirePayment(scope: WeddingScope, id: string): Promise<BudgetPaymentRow> {
  const { data, error } = await scope.db
    .from("budget_payments")
    .select(PAYMENT_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Payment not found in this wedding");
  return data as BudgetPaymentRow;
}

/**
 * Confirms a vendor is ours before a budget row points at it.
 *
 * The composite foreign key `(vendor_id, wedding_id)` would refuse a foreign
 * vendor anyway, but it refuses with a Postgres constraint string. This turns
 * the same case into a sentence.
 */
async function requireVendorId(scope: WeddingScope, vendorId: string): Promise<void> {
  const { data, error } = await scope.db
    .from("vendors")
    .select("id")
    .eq("wedding_id", scope.weddingId)
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Vendor not found in this wedding");
}

/** The next free `sort_order`, so a new row lands at the end of its list. */
async function nextSortOrder(
  scope: WeddingScope,
  table: "budget_categories" | "budget_items",
  categoryId?: string,
): Promise<number> {
  let query = scope.db
    .from(table)
    .select("sort_order")
    .eq("wedding_id", scope.weddingId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (categoryId !== undefined) query = query.eq("category_id", categoryId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  const last: { sort_order: number } | null = data;
  return last === null ? 0 : last.sort_order + 1;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readSettings(scope: WeddingScope): Promise<BudgetSettings> {
  const { data, error } = await scope.db
    .from("weddings")
    .select(WEDDING_BUDGET_COLS)
    .eq("id", scope.weddingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row: {
    budget_total_cents: number | null;
    budget_currency: string | null;
    budget_benchmark_label: string | null;
  } | null = data;

  return {
    maxSpendCents: row?.budget_total_cents ?? null,
    currency: row?.budget_currency ?? "USD",
    // The generic fallback matches the column default. The real wedding's
    // benchmark is named in the seed, never in code.
    benchmarkLabel: row?.budget_benchmark_label ?? "Reference wedding",
  };
}

/** The couple's ceiling, their currency, and what they call the benchmark. */
export async function settings(scope: WeddingScope): Promise<BudgetSettings> {
  return readSettings(scope);
}

export async function maxSpend(scope: WeddingScope): Promise<number | null> {
  return (await readSettings(scope)).maxSpendCents;
}

/**
 * The whole budget — categories, their lines, and every line's payments — in
 * one round of five parallel queries.
 *
 * Flat scoped selects, assembled in memory by `assembleTree`, rather than one
 * PostgREST embed (`select("*, budget_items(*, budget_payments(*))")`). An
 * embed is a single round trip, but `.eq("wedding_id", …)` on an embedded query
 * only filters the parent, and this codebase's tenancy guarantee is that every
 * query names the wedding. Five small scoped reads beat one clever one.
 *
 * The fifth read is the `weddings` row: the totals need the ceiling and the
 * page needs the benchmark's label, and fetching them here keeps the caller
 * down to a single await.
 */
export async function tree(
  scope: WeddingScope,
  now: Date,
  timeZone: string,
  opts: { upcomingWindowDays?: number } = {},
): Promise<BudgetTree> {
  const [settingsRow, categoriesResult, itemsResult, paymentsResult, vendorsResult] =
    await Promise.all([
      readSettings(scope),
      scope.db
        .from("budget_categories")
        .select(CATEGORY_COLS)
        .eq("wedding_id", scope.weddingId)
        .order("sort_order")
        .order("id"),
      scope.db
        .from("budget_items")
        .select(ITEM_COLS)
        .eq("wedding_id", scope.weddingId)
        .order("sort_order")
        .order("id"),
      scope.db
        .from("budget_payments")
        .select(PAYMENT_COLS)
        .eq("wedding_id", scope.weddingId)
        .order("due_date", { nullsFirst: false })
        .order("id"),
      scope.db
        .from("vendors")
        .select("id, name, status")
        .eq("wedding_id", scope.weddingId)
        .order("name"),
    ]);
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (vendorsResult.error) throw new Error(vendorsResult.error.message);

  const categories: CategoryFact[] = (categoriesResult.data ?? []) as BudgetCategoryRow[];
  const items: ItemFact[] = (itemsResult.data ?? []) as BudgetItemRow[];
  const payments = ((paymentsResult.data ?? []) as BudgetPaymentRow[]).map(toPaymentFact);
  const vendors: Array<{ id: string; name: string; status: VendorStatus }> =
    vendorsResult.data ?? [];

  const rollups = assembleTree(categories, items, payments, now, timeZone);

  return {
    categories: rollups,
    totals: rollUpBudget(rollups, settingsRow.maxSpendCents),
    vendorsById: Object.fromEntries(vendors.map((v) => [v.id, v])),
    overdue: overduePayments(payments, now, timeZone),
    upcoming: upcomingPayments(
      payments,
      now,
      timeZone,
      opts.upcomingWindowDays ?? UPCOMING_WINDOW_DAYS,
    ),
    timeZone,
    benchmarkLabel: settingsRow.benchmarkLabel,
    currency: settingsRow.currency,
  };
}

/**
 * The headline numbers for the Overview cards.
 *
 * The same tables as `tree` with the narrow fact projections, and deliberately
 * **not** implemented as `tree(...)` plus a discard: the dashboard should never
 * pay to fetch every note, quantity and receipt link on every line just to
 * render four totals.
 */
export async function summary(
  scope: WeddingScope,
  now: Date,
  timeZone: string,
): Promise<BudgetSummary> {
  const [settingsRow, categoriesResult, itemsResult, paymentsResult] = await Promise.all([
    readSettings(scope),
    scope.db
      .from("budget_categories")
      .select("id, name, target_cents, benchmark_cents, is_contingency, sort_order")
      .eq("wedding_id", scope.weddingId)
      .order("sort_order")
      .order("id"),
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
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);

  const categories: CategoryFact[] = categoriesResult.data ?? [];
  const items: ItemFact[] = itemsResult.data ?? [];
  const payments = ((paymentsResult.data ?? []) as PaymentFactRow[]).map(toPaymentFact);

  const totals = rollUpBudget(
    assembleTree(categories, items, payments, now, timeZone),
    settingsRow.maxSpendCents,
  );
  const thisMonth = paymentsDueThisMonth(payments, now, timeZone);

  return {
    maxSpendCents: totals.maxSpendCents,
    forecastCents: totals.forecastCents,
    paidCents: totals.paidCents,
    dueCents: totals.dueCents,
    benchmarkCents: totals.benchmarkCents,
    benchmarkDeltaCents: totals.benchmark.deltaCents,
    remainingAfterForecastCents: totals.remainingAfterForecastCents,
    scheduledUnpaidCents: totals.outstandingScheduledCents,
    health: totals.health,
    overdueCount: totals.overdueCount,
    overdueCents: totals.overdueCents,
    dueThisMonthCount: thisMonth.count,
    dueThisMonthCents: thisMonth.cents,
    mixedCurrency: totals.mixedCurrency,
    itemCount: totals.itemCount,
    currency: settingsRow.currency,
    benchmarkLabel: settingsRow.benchmarkLabel,
  };
}

export async function listCategories(scope: WeddingScope): Promise<BudgetCategoryRow[]> {
  const { data, error } = await scope.db
    .from("budget_categories")
    .select(CATEGORY_COLS)
    .eq("wedding_id", scope.weddingId)
    .order("sort_order")
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as BudgetCategoryRow[];
}

export async function getItem(scope: WeddingScope, id: string): Promise<BudgetItemRow> {
  return requireItem(scope, id);
}

/** One line's payments, in the order the drawer lists them. */
export async function listPayments(
  scope: WeddingScope,
  itemId: string,
): Promise<BudgetPaymentRow[]> {
  const { data, error } = await scope.db
    .from("budget_payments")
    .select(PAYMENT_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("budget_item_id", itemId)
    .order("sort_order")
    .order("due_date", { nullsFirst: false })
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as BudgetPaymentRow[];
}

// ---------------------------------------------------------------------------
// Wedding-level settings
// ---------------------------------------------------------------------------

export async function setMaxSpend(
  scope: WeddingScope,
  cents: number | null,
  actorId?: string,
): Promise<void> {
  if (cents !== null && (!Number.isInteger(cents) || cents < 0)) {
    throw new BudgetValidationError([
      { field: "amount", message: "A budget total has to be a whole amount, and not negative." },
    ]);
  }

  const { error } = await scope.db
    .from("weddings")
    .update({ budget_total_cents: cents, updated_at: nowIso() })
    .eq("id", scope.weddingId);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.max_spend_set",
    payload: { maxSpendCents: cents },
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(
  scope: WeddingScope,
  input: BudgetCategoryInput,
  actorId?: string,
): Promise<BudgetCategoryRow> {
  const validation = validateCategory({ name: input.name ?? "" });
  if (!validation.ok) throw new BudgetValidationError(validation.errors);

  const existing = await listCategories(scope);
  const slug = uniqueSlug(validation.value.name, new Set(existing.map((c) => c.slug)));
  const sortOrder = existing.reduce((max, c) => Math.max(max, c.sort_order + 1), 0);

  const { data, error } = await scope.db
    .from("budget_categories")
    .insert({
      wedding_id: scope.weddingId,
      name: validation.value.name,
      slug,
      sort_order: sortOrder,
      target_cents: input.targetCents ?? null,
      benchmark_cents: input.benchmarkCents ?? null,
      is_contingency: input.isContingency ?? false,
      notes: orNull(input.notes),
    })
    .select(CATEGORY_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const created = data as BudgetCategoryRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.category_created",
    payload: { categoryId: created.id, name: created.name },
  });
  return created;
}

/**
 * Patches only the fields the caller sent. The slug is never rewritten: it is
 * the key the seed and the importer match on, so a rename must not break them.
 */
export async function updateCategory(
  scope: WeddingScope,
  id: string,
  input: BudgetCategoryInput,
  actorId?: string,
): Promise<BudgetCategoryRow> {
  const existing = await requireCategory(scope, id);

  const validation = validateCategory({ name: input.name ?? existing.name });
  if (!validation.ok) throw new BudgetValidationError(validation.errors);

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.name !== undefined) patch.name = validation.value.name;
  if (input.targetCents !== undefined) patch.target_cents = input.targetCents;
  if (input.benchmarkCents !== undefined) patch.benchmark_cents = input.benchmarkCents;
  if (input.isContingency !== undefined) patch.is_contingency = input.isContingency;
  if (input.notes !== undefined) patch.notes = orNull(input.notes);

  const { data, error } = await scope.db
    .from("budget_categories")
    .update(patch)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(CATEGORY_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const updated = data as BudgetCategoryRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.category_updated",
    payload: { categoryId: id, name: updated.name },
  });
  return updated;
}

/** What is filed under a category, for the confirmation dialog. */
export async function categoryRemovalImpact(
  scope: WeddingScope,
  id: string,
): Promise<CategoryRemovalImpact> {
  await requireCategory(scope, id);

  const [itemsResult, vendorsResult] = await Promise.all([
    scope.db
      .from("budget_items")
      .select("id")
      .eq("wedding_id", scope.weddingId)
      .eq("category_id", id),
    scope.db
      .from("vendors")
      .select("id")
      .eq("wedding_id", scope.weddingId)
      .eq("category_id", id),
  ]);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (vendorsResult.error) throw new Error(vendorsResult.error.message);

  const itemIds = ((itemsResult.data ?? []) as Array<{ id: string }>).map((i) => i.id);
  if (itemIds.length === 0) {
    return { items: 0, payments: 0, paidCents: 0, vendors: (vendorsResult.data ?? []).length };
  }

  const { data: payments, error: paymentsError } = await scope.db
    .from("budget_payments")
    .select("amount_cents, paid_at")
    .eq("wedding_id", scope.weddingId)
    .in("budget_item_id", itemIds);
  if (paymentsError) throw new Error(paymentsError.message);

  const rows: Array<{ amount_cents: number; paid_at: string | null }> = payments ?? [];
  return {
    items: itemIds.length,
    payments: rows.length,
    paidCents: rows
      .filter((p) => p.paid_at !== null)
      .reduce((sum, p) => sum + p.amount_cents, 0),
    vendors: (vendorsResult.data ?? []).length,
  };
}

/**
 * Deletes an **empty** category, and refuses otherwise.
 *
 * The foreign keys from `budget_items` and `vendors` are `on delete restrict`,
 * so a category holding money cannot be deleted at all — deliberately. Rather
 * than let Postgres answer with a constraint name, this reads the impact first
 * and says what is in the way. Never cascade a delete into someone's budget:
 * moving the lines somewhere is a decision only she can make.
 */
export async function removeCategory(
  scope: WeddingScope,
  id: string,
  actorId?: string,
): Promise<CategoryRemovalImpact> {
  const category = await requireCategory(scope, id);
  const impact = await categoryRemovalImpact(scope, id);

  if (impact.items > 0 || impact.vendors > 0) {
    const blockers = [
      impact.items > 0 ? `${impact.items} budget ${impact.items === 1 ? "line" : "lines"}` : null,
      impact.vendors > 0 ? `${impact.vendors} ${impact.vendors === 1 ? "vendor" : "vendors"}` : null,
    ].filter((part): part is string => part !== null);
    throw new Error(
      `"${category.name}" still has ${blockers.join(" and ")} in it. Move them to another category first.`,
    );
  }

  const { error } = await scope.db
    .from("budget_categories")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.category_removed",
    payload: { categoryId: id, name: category.name },
  });
  return impact;
}

/**
 * Writes `sort_order` to match the given order.
 *
 * One scoped update per row, run together. Ids outside this wedding match
 * nothing, so a foreign id is a no-op rather than a cross-tenant write. There
 * is no `reorder_budget_categories` RPC yet, so unlike `events.reorder` this is
 * not one statement — a failure mid-flight can leave a partial order, which the
 * next drag corrects.
 */
export async function reorderCategories(
  scope: WeddingScope,
  orderedIds: string[],
  actorId?: string,
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      scope.db
        .from("budget_categories")
        .update({ sort_order: index, updated_at: nowIso() })
        .eq("wedding_id", scope.weddingId)
        .eq("id", id),
    ),
  );
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
  }
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.categories_reordered",
    payload: { order: orderedIds },
  });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Validates a line draft, merging anything the caller omitted from the stored
 * row so an inline edit of one cell does not have to resend the whole line.
 *
 * `qty` is not handed to `validateItem`: the column is text because the source
 * spreadsheet contains "100 liters (abundant)", and the rule's whole-number
 * check would reject the couple's own data.
 */
function validatedItem(input: BudgetItemInput, existing?: BudgetItemRow) {
  const validation = validateItem({
    name: input.name ?? existing?.name ?? "",
    benchmarkCents: input.benchmarkCents !== undefined ? input.benchmarkCents : existing?.benchmark_cents,
    estimatedCents: input.estimatedCents !== undefined ? input.estimatedCents : existing?.estimated_cents,
    quotedCents: input.quotedCents !== undefined ? input.quotedCents : existing?.quoted_cents,
    contractedCents:
      input.contractedCents !== undefined ? input.contractedCents : existing?.contracted_cents,
    unitPriceCents:
      input.unitPriceCents !== undefined ? input.unitPriceCents : existing?.unit_price_cents,
  });
  if (!validation.ok) throw new BudgetValidationError(validation.errors);
  return validation;
}

export async function createItem(
  scope: WeddingScope,
  input: BudgetItemInput,
  actorId?: string,
): Promise<ItemWriteResult> {
  const categoryId = input.categoryId;
  if (categoryId === undefined) {
    throw new BudgetValidationError([
      { field: "name", message: "Pick a category for this line." },
    ]);
  }
  await requireCategory(scope, categoryId);
  if (input.vendorId) await requireVendorId(scope, input.vendorId);

  const validation = validatedItem(input);
  const sortOrder = await nextSortOrder(scope, "budget_items", categoryId);

  const { data, error } = await scope.db
    .from("budget_items")
    .insert({
      wedding_id: scope.weddingId,
      category_id: categoryId,
      vendor_id: input.vendorId ?? null,
      name: validation.value.name,
      qty: orNull(input.qty),
      unit_price_cents: validation.value.unitPriceCents,
      benchmark_cents: validation.value.benchmarkCents,
      estimated_cents: validation.value.estimatedCents,
      quoted_cents: validation.value.quotedCents,
      contracted_cents: validation.value.contractedCents,
      // A number typed on the budget side is `manual`; only a vendor sync
      // writes `vendor`, which is what lets the UI refuse to overwrite silently.
      contracted_source: "manual",
      ...(input.currency ? { currency: input.currency } : {}),
      pending_guest_count: input.pendingGuestCount ?? false,
      notes: orNull(input.notes),
      sort_order: sortOrder,
    })
    .select(ITEM_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const item = data as BudgetItemRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.item_created",
    payload: { itemId: item.id, categoryId, name: item.name },
  });
  return { item, warning: validation.warning ?? null };
}

/**
 * A line and its payment schedule in one call: total in, deposit in, balance
 * computed.
 *
 * The app does the subtraction — making someone work the balance out on the
 * vendor's invoice and type it back is exactly the arithmetic that sends a
 * couple back to the spreadsheet. Both payment rows go in one multi-row insert,
 * which is a single statement, so a half-written schedule is not possible. A
 * deposit equal to the total produces one payment, not one plus a $0 row nobody
 * can explain.
 */
export async function createItemWithDeposit(
  scope: WeddingScope,
  input: BudgetItemInput & {
    totalCents: number;
    depositCents: number;
    depositDue?: string | null;
    balanceDue?: string | null;
  },
  actorId?: string,
): Promise<{ item: BudgetItemRow; payments: BudgetPaymentRow[]; warning: string | null }> {
  const split = splitDeposit(input.totalCents, input.depositCents);
  if (!split.ok) throw new BudgetValidationError([{ field: "amount", message: split.message }]);

  const { item, warning } = await createItem(
    scope,
    { ...input, contractedCents: input.totalCents },
    actorId,
  );

  const rows = [
    ...(split.deposit > 0
      ? [
          {
            wedding_id: scope.weddingId,
            budget_item_id: item.id,
            vendor_id: item.vendor_id,
            label: "Deposit",
            kind: "deposit",
            amount_cents: split.deposit,
            currency: item.currency,
            due_date: orNull(input.depositDue),
            sort_order: 0,
          },
        ]
      : []),
    ...(split.balance > 0
      ? [
          {
            wedding_id: scope.weddingId,
            budget_item_id: item.id,
            vendor_id: item.vendor_id,
            label: "Final balance",
            kind: "final",
            amount_cents: split.balance,
            currency: item.currency,
            due_date: orNull(input.balanceDue),
            sort_order: 1,
          },
        ]
      : []),
  ];
  if (rows.length === 0) return { item, payments: [], warning };

  const { data, error } = await scope.db.from("budget_payments").insert(rows).select(PAYMENT_COLS);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const payments = (data ?? []) as BudgetPaymentRow[];
  for (const payment of payments) {
    await activity.log(scope, {
      actorType: "admin",
      actorId,
      action: "payment.created",
      payload: {
        paymentId: payment.id,
        itemId: item.id,
        label: payment.label,
        amountCents: payment.amount_cents,
        dueDate: payment.due_date,
      },
    });
  }
  return { item, payments, warning };
}

export async function updateItem(
  scope: WeddingScope,
  id: string,
  input: BudgetItemInput,
  actorId?: string,
): Promise<ItemWriteResult> {
  const existing = await requireItem(scope, id);
  if (input.categoryId !== undefined) await requireCategory(scope, input.categoryId);
  if (input.vendorId) await requireVendorId(scope, input.vendorId);

  const validation = validatedItem(input, existing);

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.vendorId !== undefined) patch.vendor_id = input.vendorId;
  if (input.name !== undefined) patch.name = validation.value.name;
  if (input.qty !== undefined) patch.qty = orNull(input.qty);
  if (input.unitPriceCents !== undefined) patch.unit_price_cents = validation.value.unitPriceCents;
  if (input.benchmarkCents !== undefined) patch.benchmark_cents = validation.value.benchmarkCents;
  if (input.estimatedCents !== undefined) patch.estimated_cents = validation.value.estimatedCents;
  if (input.quotedCents !== undefined) patch.quoted_cents = validation.value.quotedCents;
  if (input.contractedCents !== undefined) {
    patch.contracted_cents = validation.value.contractedCents;
    // Typed here, by a person: a later vendor sync must treat it as a conflict
    // rather than quietly replacing it.
    patch.contracted_source = "manual";
  }
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.pendingGuestCount !== undefined) patch.pending_guest_count = input.pendingGuestCount;
  if (input.notes !== undefined) patch.notes = orNull(input.notes);

  const { data, error } = await scope.db
    .from("budget_items")
    .update(patch)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(ITEM_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const item = data as BudgetItemRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.item_updated",
    payload: { itemId: id, name: item.name },
  });
  return { item, warning: validation.warning ?? null };
}

/**
 * Deletes a line and, by cascade, its payments — **including paid ones**, which
 * is why the counts are read first and written to the activity log. There is no
 * undo, so the log is the record.
 */
export async function removeItem(
  scope: WeddingScope,
  id: string,
  actorId?: string,
): Promise<{ payments: number; paidCents: number }> {
  const item = await requireItem(scope, id);

  const { data, error: readError } = await scope.db
    .from("budget_payments")
    .select("amount_cents, paid_at")
    .eq("wedding_id", scope.weddingId)
    .eq("budget_item_id", id);
  if (readError) throw new Error(readError.message);
  const rows: Array<{ amount_cents: number; paid_at: string | null }> = data ?? [];
  const impact = {
    payments: rows.length,
    paidCents: rows.filter((p) => p.paid_at !== null).reduce((sum, p) => sum + p.amount_cents, 0),
  };

  const { error } = await scope.db
    .from("budget_items")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.item_removed",
    payload: { itemId: id, name: item.name, destroyed: impact },
  });
  return impact;
}

/** Moves a line to another category, at the end of it. */
export async function moveItem(
  scope: WeddingScope,
  id: string,
  categoryId: string,
  actorId?: string,
): Promise<BudgetItemRow> {
  await requireItem(scope, id);
  const category = await requireCategory(scope, categoryId);
  const sortOrder = await nextSortOrder(scope, "budget_items", categoryId);

  const { data, error } = await scope.db
    .from("budget_items")
    .update({ category_id: categoryId, sort_order: sortOrder, updated_at: nowIso() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(ITEM_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const item = data as BudgetItemRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.item_moved",
    payload: { itemId: id, name: item.name, categoryId, categoryName: category.name },
  });
  return item;
}

/** Same shape as `reorderCategories`, narrowed to one category's lines. */
export async function reorderItems(
  scope: WeddingScope,
  categoryId: string,
  orderedIds: string[],
  actorId?: string,
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      scope.db
        .from("budget_items")
        .update({ sort_order: index, updated_at: nowIso() })
        .eq("wedding_id", scope.weddingId)
        .eq("category_id", categoryId)
        .eq("id", id),
    ),
  );
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
  }
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.items_reordered",
    payload: { categoryId, order: orderedIds },
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * A refund is the only row that may be negative, and the database enforces
 * that against `kind`. Callers pass a positive amount and a kind; the sign is
 * applied here so no form has to teach anyone to type a minus.
 */
function signedAmount(kind: PaymentKind, amountCents: number): number {
  return kind === "refund" ? -Math.abs(amountCents) : Math.abs(amountCents);
}

/**
 * The line's cost for the "these payments add up to more than the cost you
 * recorded" warning — `effectiveCostCents`, not a fallback chain written out
 * again here. Null when no cost column is filled, so an unpriced line warns
 * about nothing rather than about everything.
 */
function forecastForWarning(item: BudgetItemRow): number | null {
  const forecast = effectiveCostCents(item);
  return forecast.stage === null ? null : forecast.cents;
}

export async function createPayment(
  scope: WeddingScope,
  input: PaymentInput,
  actorId?: string,
): Promise<PaymentWriteResult> {
  const itemId = input.itemId;
  if (itemId === undefined) {
    throw new BudgetValidationError([
      { field: "amount", message: "A payment has to belong to a budget line." },
    ]);
  }
  const item = await requireItem(scope, itemId);
  if (input.vendorId) await requireVendorId(scope, input.vendorId);

  const siblings = await listPayments(scope, itemId);
  const validation = validatePayment(
    {
      label: input.label,
      amountCents: input.amountCents ?? null,
      dueDate: input.dueDate,
      paid: input.paid,
      paidOn: input.paidOn,
      otherScheduledCents: siblings.reduce((sum, p) => sum + p.amount_cents, 0),
    },
    forecastForWarning(item),
  );
  if (!validation.ok) throw new BudgetValidationError(validation.errors);

  const kind: PaymentKind = input.kind ?? "installment";
  const { data, error } = await scope.db
    .from("budget_payments")
    .insert({
      wedding_id: scope.weddingId,
      budget_item_id: itemId,
      vendor_id: input.vendorId !== undefined ? input.vendorId : item.vendor_id,
      label: validation.value.label,
      kind,
      amount_cents: signedAmount(kind, validation.value.amountCents),
      currency: input.currency ?? item.currency,
      due_date: validation.value.dueDate,
      // `paid_at` is the only paid flag: a date means paid, null means not.
      paid_at: validation.value.paidOn,
      method: orNull(input.method),
      reference: orNull(input.reference),
      receipt_url: orNull(input.receiptUrl),
      notes: orNull(input.notes),
      sort_order: siblings.length,
    })
    .select(PAYMENT_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const payment = data as BudgetPaymentRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "payment.created",
    payload: {
      paymentId: payment.id,
      itemId,
      label: payment.label,
      amountCents: payment.amount_cents,
      dueDate: payment.due_date,
    },
  });
  return { payment, warning: validation.warning ?? null };
}

export async function updatePayment(
  scope: WeddingScope,
  id: string,
  input: PaymentInput,
  actorId?: string,
): Promise<PaymentWriteResult> {
  const existing = await requirePayment(scope, id);
  if (input.vendorId) await requireVendorId(scope, input.vendorId);

  const item = await requireItem(scope, existing.budget_item_id);
  const siblings = (await listPayments(scope, existing.budget_item_id)).filter((p) => p.id !== id);

  const kind: PaymentKind = input.kind ?? existing.kind;
  const validation = validatePayment(
    {
      label: input.label !== undefined ? input.label : existing.label,
      amountCents:
        input.amountCents !== undefined
          ? input.amountCents
          : Math.abs(existing.amount_cents),
      dueDate: input.dueDate !== undefined ? input.dueDate : existing.due_date,
      paid: input.paid !== undefined ? input.paid : existing.paid_at !== null,
      paidOn: input.paidOn !== undefined ? input.paidOn : existing.paid_at,
      otherScheduledCents: siblings.reduce((sum, p) => sum + p.amount_cents, 0),
    },
    forecastForWarning(item),
  );
  if (!validation.ok) throw new BudgetValidationError(validation.errors);

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.vendorId !== undefined) patch.vendor_id = input.vendorId;
  if (input.label !== undefined) patch.label = validation.value.label;
  if (input.kind !== undefined) patch.kind = kind;
  if (input.amountCents !== undefined || input.kind !== undefined) {
    patch.amount_cents = signedAmount(kind, validation.value.amountCents);
  }
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.dueDate !== undefined) patch.due_date = validation.value.dueDate;
  // `paid_at` is both the date and the only paid flag, so a cleared date used to
  // read as "not paid": emptying the field to retype it silently un-recorded the
  // payment, reported "Saved", and dropped the amount out of PAID SO FAR with
  // nothing on screen admitting it. A date edit may move *when* it was paid;
  // only an explicit `paid` may change *whether* it was.
  if (input.paid !== undefined) {
    patch.paid_at = validation.value.paidOn;
  } else if (input.paidOn !== undefined && validation.value.paidOn !== null) {
    patch.paid_at = validation.value.paidOn;
  }
  if (input.method !== undefined) patch.method = orNull(input.method);
  if (input.reference !== undefined) patch.reference = orNull(input.reference);
  if (input.receiptUrl !== undefined) patch.receipt_url = orNull(input.receiptUrl);
  if (input.notes !== undefined) patch.notes = orNull(input.notes);

  const { data, error } = await scope.db
    .from("budget_payments")
    .update(patch)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(PAYMENT_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  const payment = data as BudgetPaymentRow;
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "payment.updated",
    payload: {
      paymentId: id,
      itemId: payment.budget_item_id,
      amountCents: payment.amount_cents,
      dueDate: payment.due_date,
    },
  });
  return { payment, warning: validation.warning ?? null };
}

export async function removePayment(
  scope: WeddingScope,
  id: string,
  actorId?: string,
): Promise<void> {
  const payment = await requirePayment(scope, id);

  const { error } = await scope.db
    .from("budget_payments")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "payment.removed",
    payload: {
      paymentId: id,
      itemId: payment.budget_item_id,
      label: payment.label,
      amountCents: payment.amount_cents,
      paidOn: payment.paid_at,
    },
  });
}

/**
 * Marks a payment paid or unpaid.
 *
 * `paidOn` is required when marking paid and **this function never reads a
 * clock**: the caller passes `calendarDayIn(new Date(), timeZone)`, the day it
 * is at the venue. A server-clock date would be tomorrow's for anyone paying in
 * the evening in Guadalajara, because Vercel runs UTC — the kind of bug that
 * looks fine on a laptop and is wrong in production every night.
 *
 * Marking unpaid forces `paid_at` back to null, so a re-opened payment cannot
 * keep a stale date.
 */
export async function setPaymentPaid(
  scope: WeddingScope,
  id: string,
  paid: boolean,
  paidOn: string | null,
  actorId?: string,
): Promise<BudgetPaymentRow> {
  const existing = await requirePayment(scope, id);

  if (paid && paidOn === null) {
    throw new BudgetValidationError([
      { field: "paidOn", message: "Marking a payment paid needs the day it was paid." },
    ]);
  }

  // Reuse the rules module's calendar-date check (it rejects "2026-02-30",
  // which `Date.parse` silently rolls over to March 2nd) and its normalisation
  // of paid/paid-on. The amount is passed as its magnitude so a refund row,
  // which is legitimately negative, is not rejected by the amount rule.
  const validation = validatePayment(
    {
      label: existing.label,
      amountCents: Math.abs(existing.amount_cents),
      dueDate: existing.due_date,
      paid,
      paidOn,
    },
    null,
  );
  if (!validation.ok) throw new BudgetValidationError(validation.errors);

  const { data, error } = await scope.db
    .from("budget_payments")
    .update({ paid_at: validation.value.paidOn, updated_at: nowIso() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select(PAYMENT_COLS)
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: paid ? "payment.marked_paid" : "payment.marked_unpaid",
    payload: {
      paymentId: id,
      itemId: existing.budget_item_id,
      amountCents: existing.amount_cents,
      paidOn: validation.value.paidOn,
    },
  });
  return data as BudgetPaymentRow;
}

// ---------------------------------------------------------------------------
// Percentage seeding
// ---------------------------------------------------------------------------

/**
 * Turns "my budget is $60,000, split it the usual way" into category targets.
 *
 * `allocateByPercent` does the apportionment (largest-remainder, so the slices
 * sum to the cent). This function only writes: a category whose name already
 * exists — compared case-insensitively, because "Flowers + Decor" and
 * "flowers + decor" are the same category to a person — has its `target_cents`
 * updated, and anything new is inserted. **Nothing is ever deleted**, so
 * re-running the wizard cannot destroy a category she added by hand.
 */
export async function seedAllocation(
  scope: WeddingScope,
  totalCents: number,
  plan: AllocationSlice[],
  actorId?: string,
): Promise<BudgetCategoryRow[]> {
  const slices = allocateByPercent(totalCents, plan);
  const existing = await listCategories(scope);
  const byName = new Map(existing.map((c) => [nameKey(c.name), c]));
  const takenSlugs = new Set(existing.map((c) => c.slug));
  let nextOrder = existing.reduce((max, c) => Math.max(max, c.sort_order + 1), 0);

  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; targetCents: number }> = [];

  for (const slice of slices) {
    const match = byName.get(nameKey(slice.name));
    if (match) {
      updates.push({ id: match.id, targetCents: slice.targetCents });
      continue;
    }
    const slug = uniqueSlug(slice.name, takenSlugs);
    takenSlugs.add(slug);
    inserts.push({
      wedding_id: scope.weddingId,
      name: slice.name,
      slug,
      sort_order: nextOrder,
      target_cents: slice.targetCents,
      is_contingency: slice.isContingency,
    });
    nextOrder += 1;
  }

  const results = await Promise.all([
    ...updates.map((u) =>
      scope.db
        .from("budget_categories")
        .update({ target_cents: u.targetCents, updated_at: nowIso() })
        .eq("wedding_id", scope.weddingId)
        .eq("id", u.id),
    ),
    ...(inserts.length > 0
      ? [scope.db.from("budget_categories").insert(inserts)]
      : []),
    scope.db
      .from("weddings")
      .update({ budget_total_cents: totalCents, updated_at: nowIso() })
      .eq("id", scope.weddingId),
  ]);
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
  }
  invalidateMetrics(scope);

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "budget.seeded",
    payload: { totalCents, plan: slices, created: inserts.length, updated: updates.length },
  });
  return listCategories(scope);
}
