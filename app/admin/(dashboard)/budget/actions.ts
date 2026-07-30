"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireAdmin, requireEditor } from "@/lib/admin-auth";
import { forWedding, type WeddingScope } from "@/lib/data/scope";
import * as budget from "@/lib/data/budget";
import { BudgetValidationError } from "@/lib/data/budget";
import {
  AllocationError,
  DEFAULT_ALLOCATION,
  splitDeposit,
  type AllocationSlice,
} from "@/lib/data/budget-rules";
import { MoneyParseError, tryParseMoney } from "@/lib/format/money";
import { calendarDayIn } from "@/lib/format/wedding-date";

/**
 * Every write the budget screens make.
 *
 * The shape is `app/admin/(dashboard)/events/actions.ts` reduced to its rules,
 * and the two rules are not decorative.
 *
 * `requireEditor()` is the **first** line of every one of these. The admin
 * surface runs on the service-role client, which bypasses RLS entirely, so this
 * call is the only role gate there is — a viewer who replays one of these POSTs
 * by hand gets stopped here or nowhere.
 *
 * `unstable_rethrow(error)` is the **first** line of every catch. When the
 * session has lapsed, `requireEditor` → `requireAdmin` calls `redirect()`, and
 * Next implements `redirect()` by *throwing* a control-flow signal rather than
 * an error. Swallowed by a catch-all, it never navigates and the screen renders
 * the literal string `NEXT_REDIRECT` in the error line. Rethrown, she lands on
 * the sign-in page, which is what an expired session is supposed to do.
 *
 * No arithmetic lives here. Amounts are read with `tryParseMoney`, the rest is
 * handed to `lib/data/budget.ts`, which hands it to `lib/data/budget-rules.ts`.
 * Vitest only sees `lib/**`, so a decision made in this file is a decision
 * nobody can test.
 */

export type ActionResult = { ok: boolean; message?: string };

export type BudgetFormState = {
  ok: boolean;
  /** Keyed by the FormData field name, so the message renders under its input. */
  fieldErrors?: Record<string, string>;
  savedId?: string;
  /** Legitimate-but-worth-saying notes. Never a reason to refuse a save. */
  warnings?: string[];
  /** One sentence for the status line: what changed, or what went wrong. */
  message?: string;
};

/** The four money columns a cell in the table can edit. */
export type ItemCostField =
  | "benchmark_cents"
  | "estimated_cents"
  | "quoted_cents"
  | "contracted_cents";

export type ItemCostResult = {
  ok: boolean;
  message?: string;
  itemId?: string;
  field?: ItemCostField;
  /** The value now stored, in cents. `null` means "not priced yet", not zero. */
  cents?: number | null;
  warnings?: string[];
};

/** Turns anything thrown into one sentence, in her words where we have them. */
function readableError(error: unknown): string {
  if (error instanceof BudgetValidationError) return error.errors.map((e) => e.message).join(" ");
  if (error instanceof AllocationError) return error.message;
  if (error instanceof MoneyParseError) return error.message;
  // Deliberately not `error.message`. `lib/data/budget.ts` rethrows PostgREST
  // errors verbatim, so that branch printed raw Postgres — a violated check
  // constraint, an RLS denial, a bare "TypeError: fetch failed" — into a rose
  // panel addressed to a bride. The three classes above are the ones written in
  // her language; anything else is written in Postgres's.
  return "Something went wrong, and nothing was changed. Try again in a moment.";
}

/**
 * Every path whose numbers just moved.
 *
 * `/admin` is on this list on purpose: the Overview reads the same totals, and
 * forgetting it is the most likely bug in this slice — the budget page updates,
 * the dashboard keeps yesterday's number, and the two disagree on screen.
 */
function revalidateBudget(vendorId?: string | null): void {
  revalidatePath("/admin/budget");
  revalidatePath("/admin");
  if (vendorId) revalidatePath(`/admin/vendors/${vendorId}`);
}

/**
 * The venue's zone, resolved once per action that touches a calendar day.
 *
 * Vercel runs UTC. "Paid today" typed at eight in the evening in Guadalajara is
 * already tomorrow by the server's clock, and a `new Date().toISOString()` here
 * would date the payment a day late every night without ever failing a test.
 */
async function venueTimeZone(scope: WeddingScope): Promise<string> {
  const { data } = await scope.db
    .from("weddings")
    .select("timezone")
    .eq("id", scope.weddingId)
    .single();
  const wedding: { timezone: string | null } | null = data;
  return wedding?.timezone ?? "America/Los_Angeles";
}

/** A form field as text, or `null` when it was left blank. */
function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

/** A checkbox or a `"yes"`/`"true"` string. */
function flag(formData: FormData, key: string): boolean {
  const value = String(formData.get(key) ?? "").toLowerCase();
  return value === "on" || value === "yes" || value === "true" || value === "1";
}

/**
 * Reads a money field, attaching a parse failure to the field it came from.
 *
 * Returns `undefined` for a field the form did not send at all — which is not
 * the same as a field sent blank. Blank clears the column to `null` ("not
 * priced yet"); absent leaves whatever is stored alone.
 */
function money(
  formData: FormData,
  key: string,
  errors: Record<string, string>,
): number | null | undefined {
  if (!formData.has(key)) return undefined;
  const parsed = tryParseMoney(String(formData.get(key) ?? ""));
  if (!parsed.ok) {
    errors[key] = parsed.message;
    return undefined;
  }
  return parsed.cents;
}

// ---------------------------------------------------------------------------
// The total, and the seeded per-category targets
// ---------------------------------------------------------------------------

/**
 * `weddings.budget_total_cents`.
 *
 * Deliberately nullable and deliberately unset until she says a number: the
 * couple never stated a ceiling, and a seeded guess here would be a figure the
 * page then measures her against for the rest of the planning. Blank clears it
 * back to unset rather than storing zero.
 */
export async function setBudgetTotal(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const parsed = tryParseMoney(String(formData.get("total") ?? ""));
    if (!parsed.ok) return { ok: false, fieldErrors: { total: parsed.message } };

    await budget.setMaxSpend(scope, parsed.cents, admin.userId);
    revalidateBudget();
    return { ok: true, message: "Saved · your total budget" };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, fieldErrors: { form: readableError(error) } };
  }
}

/**
 * The total plus a percentage split, written as per-category `target_cents`.
 *
 * The percentages arrive as a JSON array rather than as parallel `getAll()`
 * lists, because parallel lists silently misalign the moment one row's checkbox
 * is unticked and the contingency flag lands on the wrong category.
 *
 * The client's arithmetic is never trusted: it suggests, and `allocateByPercent`
 * decides. That function apportions by largest remainder so the targets sum to
 * the total *exactly*, and it refuses a plan with no contingency slice.
 */
export async function seedTargets(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const parsedTotal = tryParseMoney(String(formData.get("total") ?? ""));
    if (!parsedTotal.ok) return { ok: false, fieldErrors: { total: parsedTotal.message } };
    if (parsedTotal.cents === null) {
      return { ok: false, fieldErrors: { total: "Put a total in first, then we can split it." } };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("slices") ?? "[]"));
    } catch {
      return { ok: false, fieldErrors: { form: "Something went wrong. Nothing was changed." } };
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      return { ok: false, fieldErrors: { form: "Add at least one category before saving." } };
    }

    const plan: AllocationSlice[] = [];
    for (const entry of raw) {
      const row = entry as { name?: unknown; pct?: unknown; isContingency?: unknown };
      const name = String(row.name ?? "").trim();
      const pct = Number(row.pct);
      if (name.length === 0) {
        return { ok: false, fieldErrors: { form: "Every category needs a name." } };
      }
      if (!Number.isFinite(pct) || pct < 0) {
        return { ok: false, fieldErrors: { form: "Every share has to be zero or more." } };
      }
      plan.push({ name, pct: pct / 100, isContingency: row.isContingency === true });
    }

    await budget.seedAllocation(scope, parsedTotal.cents, plan, admin.userId);
    revalidateBudget();
    return { ok: true, message: "Saved · your category targets" };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, fieldErrors: { form: readableError(error) } };
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveCategory(
  categoryId: string | null,
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const errors: Record<string, string> = {};
    const targetCents = money(formData, "target", errors);
    const benchmarkCents = money(formData, "benchmark", errors);
    if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

    const input = {
      ...(formData.has("name") ? { name: String(formData.get("name") ?? "") } : {}),
      ...(targetCents !== undefined ? { targetCents } : {}),
      ...(benchmarkCents !== undefined ? { benchmarkCents } : {}),
      ...(formData.has("notes") ? { notes: text(formData, "notes") } : {}),
    };

    const saved =
      categoryId === null
        ? await budget.createCategory(scope, input, admin.userId)
        : await budget.updateCategory(scope, categoryId, input, admin.userId);

    revalidateBudget();
    return { ok: true, savedId: saved.id, message: `Saved · ${saved.name}` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, fieldErrors: { form: readableError(error) } };
  }
}

/** What a delete would take with it, read at the moment she asks. */
export async function categoryDeletionCost(
  categoryId: string,
): Promise<{ ok: boolean; message?: string; impact?: budget.CategoryRemovalImpact }> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    return { ok: true, impact: await budget.categoryRemovalImpact(scope, categoryId) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Deleting a category refuses while anything is still filed under it, and says
 * what. Nothing is ever cascaded into someone's budget.
 */
export async function deleteCategory(categoryId: string): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    await budget.removeCategory(scope, categoryId, admin.userId);
    revalidateBudget();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function reorderCategories(orderedIds: string[]): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    await budget.reorderCategories(scope, orderedIds, admin.userId);
    revalidatePath("/admin/budget");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * The empty state's "add the categories" door: the rule module's category names
 * with **no money in them at all**.
 *
 * `DEFAULT_ALLOCATION` carries percentages too, and they are deliberately not
 * used here. A target invented before she has said what she can spend is the
 * exact failure every commercial budget tool ships — a number that looks like
 * advice and is really a guess. Names are structure; money is hers.
 */
export async function createStarterCategories(): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const existing = await budget.listCategories(scope);
    const taken = new Set(existing.map((c) => c.name.trim().toLowerCase()));

    for (const slice of DEFAULT_ALLOCATION) {
      if (taken.has(slice.name.trim().toLowerCase())) continue;
      await budget.createCategory(
        scope,
        { name: slice.name, isContingency: slice.isContingency === true },
        admin.userId,
      );
    }

    revalidateBudget();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * One inline money cell, committed.
 *
 * A blank cell stores `null`, and that is the point of returning `cents` rather
 * than a boolean: `null` renders as an em dash ("not priced yet") and `0`
 * renders as `$0` ("we plan to spend nothing here"). They are different claims
 * and the caller has to be able to tell which one it just wrote.
 */
export async function saveBudgetItemCost(
  itemId: string,
  field: ItemCostField,
  raw: string,
): Promise<ItemCostResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const parsed = tryParseMoney(raw);
    if (!parsed.ok) return { ok: false, itemId, field, message: parsed.message };

    const input =
      field === "benchmark_cents"
        ? { benchmarkCents: parsed.cents }
        : field === "estimated_cents"
          ? { estimatedCents: parsed.cents }
          : field === "quoted_cents"
            ? { quotedCents: parsed.cents }
            : { contractedCents: parsed.cents };

    const { item, warning } = await budget.updateItem(scope, itemId, input, admin.userId);
    revalidateBudget(item.vendor_id);

    return {
      ok: true,
      itemId,
      field,
      cents: parsed.cents,
      ...(warning ? { warnings: [warning] } : {}),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, itemId, field, message: readableError(error) };
  }
}

/**
 * The columns the drawer edits that the ledger's own props do not carry.
 *
 * `BudgetTree` is assembled from `ItemFact` and `PaymentFact`, which hold only
 * the columns the rollups need — no `notes`, no `qty`, no `receipt_url`. A
 * drawer field that saves what you type without ever showing what is already
 * stored is worse than no field: the first time she opens a line that has a
 * note on it, the empty box replaces it. So the drawer reads them on open.
 *
 * `requireAdmin`, not `requireEditor`: this is a read, and a viewer is allowed
 * to see the budget they are viewing.
 */
export type ItemDetailResult = {
  ok: boolean;
  message?: string;
  item?: { id: string; qty: string | null; unit_price_cents: number | null; notes: string | null };
  payments?: Array<{ id: string; receipt_url: string | null; notes: string | null }>;
};

export async function loadBudgetItemDetail(itemId: string): Promise<ItemDetailResult> {
  try {
    const admin = await requireAdmin();
    const scope = forWedding(admin.weddingId);

    const [item, payments] = await Promise.all([
      budget.getItem(scope, itemId),
      budget.listPayments(scope, itemId),
    ]);

    return {
      ok: true,
      item: {
        id: item.id,
        qty: item.qty,
        unit_price_cents: item.unit_price_cents,
        notes: item.notes,
      },
      payments: payments.map((p) => ({ id: p.id, receipt_url: p.receipt_url, notes: p.notes })),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * The one-field "add a line" affordance at the foot of a category.
 *
 * Returns the new id so the caller can put the cursor in the row it just made,
 * which is what makes typing a list of lines feel like typing a list.
 */
export async function addBudgetItem(
  categoryId: string,
  name: string,
): Promise<{ ok: boolean; message?: string; itemId?: string }> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const { item } = await budget.createItem(scope, { categoryId, name }, admin.userId);
    revalidateBudget();
    return { ok: true, itemId: item.id };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/** `addBudgetItem` under the other name the ledger has used for it. */
export async function createBudgetItem(
  categoryId: string,
  name: string,
): Promise<{ ok: boolean; message?: string; itemId?: string }> {
  return addBudgetItem(categoryId, name);
}

/**
 * The empty state's "just add a line" door: a category to hold it, then a blank
 * line inside it.
 */
export async function addFirstBudgetItem(): Promise<{
  ok: boolean;
  message?: string;
  itemId?: string;
}> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const existing = await budget.listCategories(scope);
    const home =
      existing.find((c) => c.name.trim().toLowerCase() === "everything else") ??
      existing[0] ??
      (await budget.createCategory(scope, { name: "Everything else" }, admin.userId));

    const { item } = await budget.createItem(
      scope,
      { categoryId: home.id, name: "New line" },
      admin.userId,
    );
    revalidateBudget();
    return { ok: true, itemId: item.id };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Create or edit a line from a form.
 *
 * A patch, not a replacement: only the fields the form actually sent are
 * written. Posting the whole row back would mean editing a note re-saves a
 * price the form never showed, quietly reverting another editor's change and —
 * worse — reverting a vendor sync.
 */
export async function saveItem(
  itemId: string | null,
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const errors: Record<string, string> = {};
    const benchmarkCents = money(formData, "benchmark", errors);
    const estimatedCents = money(formData, "estimated", errors);
    const quotedCents = money(formData, "quoted", errors);
    const contractedCents = money(formData, "contracted", errors);
    const unitPriceCents = money(formData, "unitPrice", errors);
    if (Object.keys(errors).length > 0) {
      return { ok: false, fieldErrors: errors, message: Object.values(errors)[0] };
    }

    const input = {
      ...(formData.has("categoryId") ? { categoryId: String(formData.get("categoryId") ?? "") } : {}),
      ...(formData.has("name") ? { name: String(formData.get("name") ?? "") } : {}),
      ...(formData.has("vendorId") ? { vendorId: text(formData, "vendorId") } : {}),
      ...(benchmarkCents !== undefined ? { benchmarkCents } : {}),
      ...(estimatedCents !== undefined ? { estimatedCents } : {}),
      ...(quotedCents !== undefined ? { quotedCents } : {}),
      ...(contractedCents !== undefined ? { contractedCents } : {}),
      ...(unitPriceCents !== undefined ? { unitPriceCents } : {}),
      ...(formData.has("qty") ? { qty: text(formData, "qty") } : {}),
      ...(formData.has("currency") ? { currency: String(formData.get("currency") ?? "USD") } : {}),
      ...(formData.has("pendingGuestCount")
        ? { pendingGuestCount: flag(formData, "pendingGuestCount") }
        : {}),
      ...(formData.has("notes") ? { notes: text(formData, "notes") } : {}),
    };

    const { item, warning } =
      itemId === null
        ? await budget.createItem(scope, input, admin.userId)
        : await budget.updateItem(scope, itemId, input, admin.userId);

    revalidateBudget(item.vendor_id);
    return {
      ok: true,
      savedId: item.id,
      message: `Saved · ${item.name}`,
      ...(warning ? { warnings: [warning] } : {}),
    };
  } catch (error) {
    unstable_rethrow(error);
    const message = readableError(error);
    return { ok: false, fieldErrors: { form: message }, message };
  }
}

/** The same write as `saveItem`, taking a plain patch instead of a `FormData`. */
export type BudgetItemPatch = {
  name?: string;
  categoryId?: string;
  vendorId?: string | null;
  currency?: string;
  pendingGuestCount?: boolean;
  qty?: string | null;
  unitPriceCents?: number | null;
  notes?: string | null;
};

export async function updateBudgetItem(
  itemId: string,
  patch: BudgetItemPatch,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const input = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
      ...(patch.vendorId !== undefined ? { vendorId: patch.vendorId } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.pendingGuestCount !== undefined
        ? { pendingGuestCount: patch.pendingGuestCount }
        : {}),
      ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
      ...(patch.unitPriceCents !== undefined ? { unitPriceCents: patch.unitPriceCents } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };

    const { item, warning } = await budget.updateItem(scope, itemId, input, admin.userId);
    revalidateBudget(item.vendor_id);
    return { ok: true, ...(warning ? { message: warning } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/** Refile a line under another category. Its own write, so its own revalidation. */
export async function moveItem(itemId: string, categoryId: string): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    await budget.moveItem(scope, itemId, categoryId, admin.userId);
    revalidateBudget();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Point a line at a vendor, or at nobody.
 *
 * The vendor's contracted price is deliberately **not** copied across here.
 * Decision 6 says a cross-write must be visible, and one riding along with "I
 * picked a name from a list" is the definition of invisible.
 */
export async function setItemVendor(
  itemId: string,
  vendorId: string | null,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    const { item } = await budget.updateItem(scope, itemId, { vendorId }, admin.userId);
    revalidateBudget(item.vendor_id);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function deleteItem(itemId: string): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const removed = await budget.removeItem(scope, itemId, admin.userId);
    revalidateBudget();
    return {
      ok: true,
      message:
        removed.payments === 0
          ? "Line deleted."
          : `Line deleted, along with ${removed.payments} ${removed.payments === 1 ? "payment" : "payments"}.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/** `deleteItem` under the other name the ledger has used for it. */
export async function deleteBudgetItem(itemId: string): Promise<ActionResult> {
  return deleteItem(itemId);
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Add or edit one installment.
 *
 * When `paid` is ticked with no day given, the day is stamped as **today at the
 * venue**, resolved on the server. Vercel runs UTC, so
 * `new Date().toISOString().slice(0, 10)` would file a payment made on a
 * Guadalajara evening under tomorrow, every night, without ever failing a test.
 */
export async function savePayment(
  paymentId: string | null,
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    const timeZone = await venueTimeZone(scope);

    const errors: Record<string, string> = {};
    const amountCents = money(formData, "amount", errors);
    if (Object.keys(errors).length > 0) {
      return { ok: false, fieldErrors: errors, message: Object.values(errors)[0] };
    }

    const sendsPaid = formData.has("paid");
    const paid = flag(formData, "paid");
    const paidOn = paid ? (text(formData, "paidOn") ?? calendarDayIn(new Date(), timeZone)) : null;

    const input = {
      ...(formData.has("itemId") ? { itemId: String(formData.get("itemId") ?? "") } : {}),
      ...(formData.has("label") ? { label: text(formData, "label") } : {}),
      ...(amountCents !== undefined ? { amountCents } : {}),
      ...(formData.has("dueDate") ? { dueDate: text(formData, "dueDate") } : {}),
      ...(sendsPaid ? { paid, paidOn } : {}),
      ...(formData.has("method") ? { method: text(formData, "method") } : {}),
      ...(formData.has("reference") ? { reference: text(formData, "reference") } : {}),
      ...(formData.has("receiptUrl") ? { receiptUrl: text(formData, "receiptUrl") } : {}),
      ...(formData.has("notes") ? { notes: text(formData, "notes") } : {}),
    };

    const { payment, warning } =
      paymentId === null
        ? await budget.createPayment(scope, input, admin.userId)
        : await budget.updatePayment(scope, paymentId, input, admin.userId);

    revalidateBudget(payment.vendor_id);
    return {
      ok: true,
      savedId: payment.id,
      message: `Saved · ${payment.label}`,
      ...(warning ? { warnings: [warning] } : {}),
    };
  } catch (error) {
    unstable_rethrow(error);
    const message = readableError(error);
    return { ok: false, fieldErrors: { form: message }, message };
  }
}

/** One installment, as the drawer's form collects it — raw text, parsed here. */
export type PaymentFormValues = {
  label: string;
  amount: string;
  dueDate: string | null;
};

export async function addBudgetPayment(
  itemId: string,
  values: PaymentFormValues,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const amount = tryParseMoney(values.amount);
    if (!amount.ok) return { ok: false, message: amount.message };

    const { payment, warning } = await budget.createPayment(
      scope,
      { itemId, label: values.label, amountCents: amount.cents, dueDate: values.dueDate },
      admin.userId,
    );
    revalidateBudget(payment.vendor_id);
    return { ok: true, ...(warning ? { message: warning } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export type PaymentPatch = {
  label?: string;
  amountCents?: number | null;
  dueDate?: string | null;
  paidOn?: string | null;
  receiptUrl?: string | null;
  notes?: string | null;
};

export async function updateBudgetPayment(
  paymentId: string,
  patch: PaymentPatch,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const input = {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.amountCents !== undefined ? { amountCents: patch.amountCents } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.paidOn !== undefined ? { paidOn: patch.paidOn } : {}),
      ...(patch.receiptUrl !== undefined ? { receiptUrl: patch.receiptUrl } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };

    const { payment, warning } = await budget.updatePayment(scope, paymentId, input, admin.userId);
    revalidateBudget(payment.vendor_id);
    return { ok: true, ...(warning ? { message: warning } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * The paid toggle.
 *
 * `paidOn` is optional and **defaults to today at the venue, derived here** —
 * never from the browser's clock and never from
 * `new Date().toISOString().slice(0, 10)`, which is UTC. A caller may pass an
 * explicit day for a payment made last week; anything that is not a real
 * calendar day is refused by `validatePayment`, which catches `2026-02-30` —
 * a string `Date.parse` silently rolls forward to March 2nd.
 */
export async function markPaymentPaid(
  paymentId: string,
  paid: boolean,
  paidOn?: string | null,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    const timeZone = await venueTimeZone(scope);

    const day = paid ? (paidOn ?? "").trim() || calendarDayIn(new Date(), timeZone) : null;
    const payment = await budget.setPaymentPaid(scope, paymentId, paid, day, admin.userId);
    revalidateBudget(payment.vendor_id);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/** `markPaymentPaid` under the other name the ledger has used for it. */
export async function setPaymentPaid(
  paymentId: string,
  paid: boolean,
  paidOn?: string | null,
): Promise<ActionResult> {
  return markPaymentPaid(paymentId, paid, paidOn);
}

export async function deletePayment(paymentId: string): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    await budget.removePayment(scope, paymentId, admin.userId);
    revalidateBudget();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/** `deletePayment` under the other name the ledger has used for it. */
export async function deleteBudgetPayment(paymentId: string): Promise<ActionResult> {
  return deletePayment(paymentId);
}

/**
 * "The whole thing is $10,000 and they want $2,000 up front" → two payments.
 *
 * The app does the subtraction. Making her work the balance out on the vendor's
 * invoice and type it back in is exactly the arithmetic that sent this couple
 * to a spreadsheet in the first place, and it is where the spreadsheet's own
 * errors came from. `splitDeposit` is the rule; this only writes what it
 * returns — including its refusal when the deposit *is* the whole thing, which
 * would otherwise leave a second payment of $0 that nobody can explain.
 */
export async function splitItemDeposit(
  itemId: string,
  totalRaw: string,
  depositRaw: string,
  depositDue: string | null,
  balanceDue: string | null,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const total = tryParseMoney(totalRaw);
    if (!total.ok) return { ok: false, message: total.message };
    const deposit = tryParseMoney(depositRaw);
    if (!deposit.ok) return { ok: false, message: deposit.message };
    if (total.cents === null || deposit.cents === null) {
      return { ok: false, message: "Both a total and a deposit are needed to split it." };
    }

    const split = splitDeposit(total.cents, deposit.cents);
    if (!split.ok) return { ok: false, message: split.message };
    if (split.deposit <= 0) {
      return { ok: false, message: "A deposit needs an amount. Add the whole cost as one payment instead." };
    }
    if (split.balance === 0) {
      return { ok: false, message: "That’s the whole thing — add it as a single payment instead." };
    }

    // Payments before the price, and the first one is undone if the second
    // fails. Writing the price first meant a rejected payment left the line
    // showing a new cost with no schedule behind it — and because the failure
    // path never revalidated, the screen kept displaying the old number while
    // the database held the new one.
    const first = await budget.createPayment(
      scope,
      { itemId, label: "Deposit", kind: "deposit", amountCents: split.deposit, dueDate: depositDue },
      admin.userId,
    );

    let second;
    try {
      second = await budget.createPayment(
        scope,
        {
          itemId,
          label: "Final balance",
          kind: "final",
          amountCents: split.balance,
          dueDate: balanceDue,
        },
        admin.userId,
      );
    } catch (error) {
      unstable_rethrow(error);
      await budget.removePayment(scope, first.payment.id, admin.userId).catch(() => {});
      revalidateBudget(null);
      return { ok: false, message: readableError(error) };
    }

    const { item } = await budget.updateItem(
      scope,
      itemId,
      { contractedCents: total.cents },
      admin.userId,
    );

    revalidateBudget(item.vendor_id);
    const warning = first.warning ?? second.warning;
    return { ok: true, ...(warning ? { message: warning } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/** `splitItemDeposit` taking the drawer's form object instead of five arguments. */
export type DepositFormValues = {
  total: string;
  deposit: string;
  depositDue: string | null;
  balanceDue: string | null;
};

export async function splitIntoDeposit(
  itemId: string,
  values: DepositFormValues,
): Promise<ActionResult> {
  return splitItemDeposit(
    itemId,
    values.total,
    values.deposit,
    values.depositDue,
    values.balanceDue,
  );
}
