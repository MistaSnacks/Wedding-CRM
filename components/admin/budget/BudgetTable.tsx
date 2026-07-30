"use client";

import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatMoney, tryParseMoney } from "@/lib/format/money";
import { calendarDayIn } from "@/lib/format/wedding-date";
import {
  assembleTree,
  rollUpBudget,
  type CategoryFact,
  type ItemFact,
  type PaymentFact,
  type PaymentView,
} from "@/lib/data/budget-rules";
import type { BudgetTree } from "@/lib/data/budget";
import {
  addBudgetPayment,
  createBudgetItem,
  deleteBudgetItem,
  deleteBudgetPayment,
  loadBudgetItemDetail,
  saveBudgetItemCost,
  setPaymentPaid,
  splitIntoDeposit,
  updateBudgetItem,
  updateBudgetPayment,
} from "@/app/admin/(dashboard)/budget/actions";
import { BudgetCategoryRow } from "./BudgetCategoryRow";
import { BudgetItemCards } from "./BudgetItemCards";
import { BudgetItemRow } from "./BudgetItemRow";
import { DeltaCell } from "./DeltaCell";
import { ItemDrawer, type ItemDetail } from "./ItemDrawer";
import { COST_FIELD_LABEL, type CellFlags, type CostField } from "./MoneyCell";
import { NewItemRow } from "./NewItemRow";
import { SaveStatus, outcomeMessage, type CommitStep, type SaveState } from "./SaveStatus";

export type BudgetTableProps = {
  tree: BudgetTree;
  benchmarkLabel: string;
  currency: string;
  canEdit: boolean;
  timeZone: string;
};

/** Nine columns: the name, the reference, three cost stages, two derived, the delta, the chevron. */
const COLUMNS = 9;

/** How long the olive border sits on a cell that just saved. */
const SAVED_FLASH_MS = 900;

/**
 * The ledger — categories, their lines, and every number this page exists for.
 *
 * ## Why these nine columns
 *
 * `LINE · {reference} · ESTIMATE · QUOTE · CONTRACT · PAID · STILL TO PAY ·
 * VS {reference} · ⌄`, and the reference wedding's actual sits at position two,
 * **immediately left of the couple's own first guess**. It is never behind a
 * toggle, a tab or a hover: the whole reason a benchmark beats a blank budget is
 * that you read "she paid $6,750" and "we think $8,000" in one eye movement, and
 * a toggle turns that into a decision you have to make before you get the
 * comparison. Its heading comes from `weddings.budget_benchmark_label` — a real
 * person's name is data here, never a string in a component.
 *
 * The vendor rides in the LINE cell as a subtitle rather than taking a tenth
 * column, which buys ~140px back for figures. Everything else — notes,
 * quantity, currency, the payment schedule, delete — is behind the chevron,
 * because a table wide enough to hold it all is a table nobody reads.
 *
 * ## Optimism, and how it is undone
 *
 * Typing in a cell writes the new cents into an override map *before* the
 * request leaves. That map feeds `assembleTree` and `rollUpBudget` — the real
 * rule modules, not a copy — so the row's STILL TO PAY, its VS column, the
 * category subtotal and the footer all move in the same repaint. A figure that
 * visibly lags its own total is how someone stops trusting the page.
 *
 * When the write is refused the override is restored to what it was, the cell
 * goes blush, and the sentence from the server lands on the status line. When it
 * succeeds the overrides are dropped as the transition settles, at which point
 * the action's `revalidatePath` has already replaced the tree with the server's
 * version — so the number on screen is only ever optimistic for the length of
 * one round trip. **This depends on every write action revalidating
 * `/admin/budget`**; an action that mutates without revalidating would make the
 * cell flash back to its old value on success.
 *
 * ## The sticky-header trap
 *
 * The admin shell root carries `overflow-hidden`, which makes it the nearest
 * scroll container for `position: sticky` — and it never scrolls. A `sticky
 * top-0` `<thead>` in a page-scrolled table is therefore silently inert. So the
 * table gets its own `max-h` + `overflow-y-auto` box, and the wrapper must *not*
 * carry `overflow-hidden` the way the guest table does.
 */
export function BudgetTable(props: BudgetTableProps): React.JSX.Element {
  const { tree, benchmarkLabel, currency, canEdit, timeZone } = props;

  const [costOverrides, setCostOverrides] = useState<Record<string, number | null>>({});
  const [paidOverrides, setPaidOverrides] = useState<Record<string, { paid: boolean; paid_on: string | null }>>({});
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [status, setStatus] = useState<SaveState>({ kind: "idle" });
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [, startDetail] = useTransition();

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // Once nothing is in flight, the server's copy is the truth. Dropping the
  // overrides here is what stops an optimistic figure outliving the write that
  // produced it — including the case where someone else edited the same line in
  // another tab and the revalidated tree disagrees with what we guessed.
  useEffect(() => {
    if (pending) return;
    setCostOverrides((current) => (Object.keys(current).length === 0 ? current : {}));
    setPaidOverrides((current) => (Object.keys(current).length === 0 ? current : {}));
  }, [pending, tree]);

  const hasOverrides = Object.keys(costOverrides).length > 0 || Object.keys(paidOverrides).length > 0;

  /**
   * The tree as it looks with her un-acknowledged edits applied.
   *
   * Rebuilt through `assembleTree` and `rollUpBudget` rather than by patching
   * totals by hand: the rules for a forecast, a subtotal and a category share
   * are tested in `lib/`, and a second implementation of them inside a component
   * is one vitest cannot see and two answers the page can give.
   *
   * Skipped entirely when there is nothing to override, which is every render
   * before the first keystroke — so the server's own rollup is what paints on
   * load and there is no `new Date()` in the first render to disagree about
   * during hydration.
   */
  const view = useMemo(() => {
    if (!hasOverrides) return { categories: tree.categories, totals: tree.totals };

    const now = new Date();
    const categories: CategoryFact[] = tree.categories.map((category) => category.category);
    const items: ItemFact[] = tree.categories.flatMap((category) =>
      category.items.map((rollup) => withCostOverrides(rollup.item, costOverrides)),
    );
    const payments: PaymentFact[] = tree.categories.flatMap((category) =>
      category.items.flatMap((rollup) => rollup.payments.map((payment) => withPaidOverride(payment, paidOverrides))),
    );

    const rollups = assembleTree(categories, items, payments, now, timeZone);
    return { categories: rollups, totals: rollUpBudget(rollups, tree.totals.maxSpendCents) };
  }, [tree, costOverrides, paidOverrides, hasOverrides, timeZone]);

  const openRollup = useMemo(() => {
    if (openItemId === null) return null;
    for (const category of view.categories) {
      const found = category.items.find((rollup) => rollup.item.id === openItemId);
      if (found) return found;
    }
    return null;
  }, [view, openItemId]);

  // Only ever read while the drawer is open, which is after mount — so no
  // server render ever computes it and there is nothing to mismatch. It is the
  // venue's calendar day, not the machine's: "paid today" means today in
  // Guadalajara even when the server is already on tomorrow in UTC.
  const todayAtVenue = openItemId === null ? "" : calendarDayIn(new Date(), timeZone);

  const commit = useCallback(
    (step: CommitStep) => {
      setStatus({ kind: "saving", message: `Saving · ${step.subject}` });
      startTransition(async () => {
        step.optimistic?.();
        try {
          const result = await step.attempt();
          if (!result.ok) {
            step.rollback?.();
            setStatus({ kind: "error", message: outcomeMessage(result, step.failed) });
            return;
          }
          step.onSaved?.();
          setStatus({ kind: "saved", message: `Saved · ${step.subject}` });
        } catch {
          step.rollback?.();
          setStatus({ kind: "error", message: `${step.failed} The connection dropped, so nothing was changed.` });
        }
      });
    },
    [startTransition],
  );

  const flashSaved = useCallback((key: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setSavedKey(key);
    flashTimer.current = setTimeout(() => setSavedKey(null), SAVED_FLASH_MS);
  }, []);

  /** One money cell committed. Parse failures never reach the network. */
  const commitCost = useCallback(
    (itemId: string, itemName: string, field: CostField, raw: string) => {
      const key = cellKey(itemId, field);
      const parsed = tryParseMoney(raw);

      if (!parsed.ok) {
        setErrorKey(key);
        // The rejected text is already on screen in the blush cell, so the line
        // does not quote it back — `We couldn't read "banana" as an amount. That
        // doesn't look like an amount.` says the same thing twice. The rule's own
        // sentence leads, because it is the specific one ("Amounts can only go to
        // the cent"), and the example follows.
        setStatus({ kind: "error", message: `${parsed.message} Try something like 1,500 or $1,500.` });
        return;
      }

      const previous = costOverrides[key];
      setErrorKey((current) => (current === key ? null : current));
      setCostOverrides((current) => ({ ...current, [key]: parsed.cents }));

      commit({
        subject: `${itemName} ${COST_FIELD_LABEL[field].toLowerCase()} ${formatMoney(parsed.cents)}`,
        failed: `${itemName} didn't save.`,
        attempt: () => saveBudgetItemCost(itemId, field, raw),
        onSaved: () => flashSaved(key),
        rollback: () => {
          setErrorKey(key);
          setCostOverrides((current) => {
            const next = { ...current };
            if (previous === undefined) delete next[key];
            else next[key] = previous;
            return next;
          });
        },
      });
    },
    [commit, costOverrides, flashSaved],
  );

  const flagsFor = useCallback(
    (itemId: string) =>
      (field: CostField): CellFlags => {
        const key = cellKey(itemId, field);
        return { pending: false, justSaved: savedKey === key, errored: errorKey === key };
      },
    [savedKey, errorKey],
  );

  /**
   * Focusing the cell that failed clears its error — and only that cell.
   *
   * Tab moves focus onward the instant a bad value is refused, so a version of
   * this that cleared the status line for *any* focus wiped the sentence a
   * quarter-second after writing it: the cell stayed blush with nothing on the
   * page saying why. The guard is what keeps the explanation on screen until she
   * comes back to the number it is about.
   */
  const clearError = useCallback(
    (itemId: string, field: CostField) => {
      if (errorKey !== cellKey(itemId, field)) return;
      setErrorKey(null);
      setStatus((current) => (current.kind === "error" ? { kind: "idle" } : current));
    },
    [errorKey],
  );

  /**
   * Open the drawer, then fetch the columns the ledger does not carry.
   *
   * `notes`, `qty`, `unit_price_cents` and each payment's `receipt_url` are not
   * in `BudgetTree` — its projections stop at what the rollups need. They arrive
   * from a second read, and until it lands those inputs render **disabled rather
   * than empty**: an empty note box that fills itself in a moment later is how
   * someone types over a note that was already there.
   */
  function openDrawer(itemId: string, opener?: HTMLElement | null) {
    openerRef.current = opener ?? null;
    setOpenItemId(itemId);
    setDetail(null);
    startDetail(async () => {
      try {
        const result = await loadBudgetItemDetail(itemId);
        if (!result.ok || result.item === undefined) return;
        setDetail({
          qty: result.item.qty,
          unitPriceCents: result.item.unit_price_cents,
          notes: result.item.notes,
          receiptUrls: Object.fromEntries((result.payments ?? []).map((p) => [p.id, p.receipt_url])),
        });
      } catch {
        // The drawer is still usable for everything the tree knows; only the
        // fields that need this read stay disabled.
      }
    });
  }

  function closeDrawer() {
    setOpenItemId(null);
    setDetail(null);
    openerRef.current?.focus();
    openerRef.current = null;
  }

  const vendorNameOf = useCallback(
    (vendorId: string | null) => (vendorId === null ? null : tree.vendorsById[vendorId]?.name ?? null),
    [tree],
  );

  const vendors = useMemo(() => Object.values(tree.vendorsById), [tree]);
  const categoryOptions = useMemo(
    () => view.categories.map((category) => ({ id: category.category.id, name: category.category.name })),
    [view],
  );

  const totals = view.totals;
  const footCell = "px-3 py-3 text-right text-[13px] font-semibold text-ink tabular-nums";

  return (
    <div className="flex flex-col gap-3">
      <SaveStatus state={status} />

      {/* Desktop ledger. No `overflow-hidden` on this wrapper — see the docblock. */}
      <div className="rounded-xl border border-hairline max-md:hidden">
        <div className="max-h-[min(70dvh,720px)] overflow-x-auto overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="sticky top-0 z-20 border-b border-hairline bg-paper text-[11px] font-semibold tracking-[0.08em] text-[#6b7167]">
                <th className="w-[26%] px-4 py-3 first:rounded-tl-[11px]">LINE</th>
                <th className="w-[11%] px-3 py-3 text-right leading-[1.25] break-words whitespace-normal uppercase">{benchmarkLabel}</th>
                <th className="w-[11%] px-3 py-3 text-right">ESTIMATE</th>
                <th className="w-[11%] px-3 py-3 text-right">QUOTE</th>
                <th className="w-[11%] px-3 py-3 text-right">CONTRACT</th>
                <th className="w-[11%] px-3 py-3 text-right">PAID</th>
                <th className="w-[11%] px-3 py-3 text-right">STILL TO PAY</th>
                <th className="w-[8%] px-3 py-3 text-right leading-[1.25] break-words whitespace-normal uppercase">{`vs ${benchmarkLabel}`}</th>
                <th className="w-9 px-2 py-3 last:rounded-tr-[11px]" />
              </tr>
            </thead>

            {view.categories.map((category) => {
              const isCollapsed = collapsed.has(category.category.id);
              return (
                <tbody key={category.category.id}>
                  <BudgetCategoryRow
                    rollup={category}
                    benchmarkLabel={benchmarkLabel}
                    collapsed={isCollapsed}
                    onToggle={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(category.category.id)) next.delete(category.category.id);
                        else next.add(category.category.id);
                        return next;
                      })
                    }
                  />

                  {!isCollapsed &&
                    category.items.map((rollup) => (
                      <BudgetItemRow
                        key={rollup.item.id}
                        rollup={rollup}
                        benchmarkLabel={benchmarkLabel}
                        currency={currency}
                        canEdit={canEdit}
                        vendorName={vendorNameOf(rollup.item.vendor_id)}
                        flags={flagsFor(rollup.item.id)}
                        onCommit={(field, raw) => commitCost(rollup.item.id, rollup.item.name, field, raw)}
                        onClearError={(field) => clearError(rollup.item.id, field)}
                        onOpen={() => openDrawer(rollup.item.id, document.activeElement as HTMLElement | null)}
                        isOpen={openItemId === rollup.item.id}
                      />
                    ))}

                  {!isCollapsed && category.items.length === 0 && (
                    <tr className="border-b border-[#f1f0ea]">
                      <td colSpan={COLUMNS} className="px-4 py-5 text-[12.5px] text-muted">
                        Nothing here yet
                      </td>
                    </tr>
                  )}

                  {!isCollapsed && canEdit && (
                    <NewItemRow
                      categoryName={category.category.name}
                      colSpan={COLUMNS}
                      disabled={pending}
                      onCreate={(name) =>
                        commit({
                          subject: `${name} added to ${category.category.name}`,
                          failed: `${name} wasn't added.`,
                          attempt: () => createBudgetItem(category.category.id, name),
                        })
                      }
                    />
                  )}
                </tbody>
              );
            })}

            {/* Only when there is not even a category. With categories present but
                empty, each one already carries its own "Nothing here yet" row and
                the line that creates a line, so this would be a second empty state
                sitting under the first. */}
            {view.categories.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-10 text-center text-[13px] text-muted">
                    {"Nothing in the budget yet. Add your first line below, or start from the reference wedding."}
                  </td>
                </tr>
              </tbody>
            )}

            <tfoot className="sticky bottom-0 z-20 border-t-2 border-hairline bg-paper">
              <tr>
                <td className="px-4 py-3 text-[13px] font-semibold text-ink">Everything</td>
                <td className={`${footCell} text-muted`}>{formatMoney(totals.benchmark.benchmarkCents)}</td>
                <td className={footCell}>{formatMoney(totals.estimatedCents)}</td>
                <td className={footCell}>{formatMoney(totals.quotedCents)}</td>
                <td className={footCell}>{formatMoney(totals.contractedCents)}</td>
                <td className={footCell}>{formatMoney(totals.paidCents)}</td>
                <td className={`${footCell} ${totals.overdueCents > 0 ? "text-rose" : ""}`}>{formatMoney(totals.dueCents)}</td>
                <td className="px-3 py-3 text-right">
                  <DeltaCell delta={totals.benchmark} benchmarkLabel={benchmarkLabel} />
                </td>
                <td className="px-2 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-[11.5px] text-muted max-md:hidden">
        {`Rose means more than ${benchmarkLabel} spent, olive means less. It's a reference point from a real wedding, not a target.`}
      </p>

      <BudgetItemCards
        categories={view.categories}
        benchmarkLabel={benchmarkLabel}
        vendorName={(rollup) => vendorNameOf(rollup.item.vendor_id)}
        onOpen={(itemId) => openDrawer(itemId, null)}
      />

      {openRollup !== null && (
        <ItemDrawer
          rollup={openRollup}
          categories={categoryOptions}
          vendors={vendors}
          benchmarkLabel={benchmarkLabel}
          currency={currency}
          todayAtVenue={todayAtVenue}
          canEdit={canEdit}
          pending={pending}
          detail={detail}
          flags={flagsFor(openRollup.item.id)}
          onCommitCost={(field, raw) => commitCost(openRollup.item.id, openRollup.item.name, field, raw)}
          onClearError={(field) => clearError(openRollup.item.id, field)}
          onPatchItem={(patch) => {
            const itemId = openRollup.item.id;
            const name = openRollup.item.name;

            // Unit price arrives as raw text so the parse message can be hers.
            // A refused parse never reaches the network — see `commitCost`.
            const unitPrice = patch.unitPriceRaw === undefined ? undefined : tryParseMoney(patch.unitPriceRaw);
            if (unitPrice !== undefined && !unitPrice.ok) {
              setStatus({ kind: "error", message: unitPrice.message });
              return;
            }

            commit({
              subject: describePatch(patch, name, categoryOptions, vendorNameOf),
              failed: `${name} didn't save.`,
              attempt: () =>
                updateBudgetItem(itemId, {
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
                  ...(patch.vendorId !== undefined ? { vendorId: patch.vendorId } : {}),
                  ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
                  ...(patch.pendingGuestCount !== undefined ? { pendingGuestCount: patch.pendingGuestCount } : {}),
                  ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
                  ...(unitPrice !== undefined ? { unitPriceCents: unitPrice.cents } : {}),
                  ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
                }),
            });
          }}
          onDelete={async () => {
            const itemId = openRollup.item.id;
            const name = openRollup.item.name;
            closeDrawer();
            commit({
              subject: `${name} deleted`,
              failed: `${name} wasn't deleted.`,
              attempt: () => deleteBudgetItem(itemId),
            });
          }}
          onAddPayment={(values) =>
            commit({
              subject: `${values.label} added to ${openRollup.item.name}`,
              failed: "That payment wasn't added.",
              attempt: () => addBudgetPayment(openRollup.item.id, values),
            })
          }
          onSplitDeposit={(values) =>
            commit({
              subject: `${openRollup.item.name} split into a deposit and a balance`,
              failed: "That split wasn't saved.",
              attempt: () => splitIntoDeposit(openRollup.item.id, values),
            })
          }
          onSetPaymentPaid={(paymentId, paid) => {
            const payment = openRollup.payments.find((p) => p.id === paymentId);
            const previous = paidOverrides[paymentId];
            // The optimistic `paid_on` is today at the venue only so the row can
            // show a date at once. The server stamps the authoritative one from
            // the venue's calendar, and the revalidated tree replaces this.
            setPaidOverrides((current) => ({
              ...current,
              [paymentId]: { paid, paid_on: paid ? todayAtVenue : null },
            }));
            commit({
              subject: `${payment?.label ?? "Payment"} marked ${paid ? "paid" : "unpaid"}`,
              failed: "That payment didn't change.",
              attempt: () => setPaymentPaid(paymentId, paid),
              rollback: () =>
                setPaidOverrides((current) => {
                  const next = { ...current };
                  if (previous === undefined) delete next[paymentId];
                  else next[paymentId] = previous;
                  return next;
                }),
            });
          }}
          onPatchPayment={(paymentId, patch) => {
            const payment = openRollup.payments.find((p) => p.id === paymentId);
            if (payment === undefined) return;

            const amount = patch.amountRaw === undefined ? undefined : tryParseMoney(patch.amountRaw);
            if (amount !== undefined && !amount.ok) {
              setStatus({ kind: "error", message: amount.message });
              return;
            }

            commit({
              subject: `${patch.label ?? payment.label} updated`,
              failed: "That payment didn't save.",
              attempt: () =>
                updateBudgetPayment(paymentId, {
                  ...(patch.label !== undefined ? { label: patch.label } : {}),
                  ...(amount !== undefined ? { amountCents: amount.cents } : {}),
                  ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
                  ...(patch.paidOn !== undefined ? { paidOn: patch.paidOn } : {}),
                  ...(patch.receiptUrl !== undefined ? { receiptUrl: patch.receiptUrl } : {}),
                }),
            });
          }}
          onRemovePayment={async (paymentId) => {
            const payment = openRollup.payments.find((p) => p.id === paymentId);
            commit({
              subject: `${payment?.label ?? "Payment"} removed`,
              failed: "That payment wasn't removed.",
              attempt: () => deleteBudgetPayment(paymentId),
            });
          }}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}

/** `itemId::field` — one key for the override map, the saved flash and the error. */
function cellKey(itemId: string, field: CostField): string {
  return `${itemId}::${field}`;
}

/**
 * The item as it should look right now, with any un-settled edit applied.
 *
 * Written out field by field rather than as a computed spread so the compiler
 * still checks that every key exists on `ItemFact` — a typo'd column name in a
 * dynamic key would silently add a property nothing reads and leave the real one
 * stale, which on this page means a total that quietly disagrees with its rows.
 */
function withCostOverrides(item: ItemFact, overrides: Record<string, number | null>): ItemFact {
  const benchmark = overrides[cellKey(item.id, "benchmark_cents")];
  const estimated = overrides[cellKey(item.id, "estimated_cents")];
  const quoted = overrides[cellKey(item.id, "quoted_cents")];
  const contracted = overrides[cellKey(item.id, "contracted_cents")];

  if (benchmark === undefined && estimated === undefined && quoted === undefined && contracted === undefined) {
    return item;
  }
  return {
    ...item,
    benchmark_cents: benchmark === undefined ? item.benchmark_cents : benchmark,
    estimated_cents: estimated === undefined ? item.estimated_cents : estimated,
    quoted_cents: quoted === undefined ? item.quoted_cents : quoted,
    contracted_cents: contracted === undefined ? item.contracted_cents : contracted,
  };
}

/**
 * A payment view narrowed back to the plain fact the rules take as input.
 *
 * `status`, `daysOut` and `label_due` are all derived from the venue's calendar
 * day, so they are dropped here and recomputed by `assembleTree` — carrying them
 * through would leave a payment that was just marked paid still wearing the
 * "3 days overdue" label it was rendered with.
 */
function withPaidOverride(
  payment: PaymentView,
  overrides: Record<string, { paid: boolean; paid_on: string | null }>,
): PaymentFact {
  const override = overrides[payment.id];
  return {
    id: payment.id,
    item_id: payment.item_id,
    label: payment.label,
    amount_cents: payment.amount_cents,
    due_date: payment.due_date,
    paid: override === undefined ? payment.paid : override.paid,
    paid_on: override === undefined ? payment.paid_on : override.paid_on,
  };
}

/**
 * What the status line says about a drawer edit.
 *
 * Named rather than generic ("Venue Rental linked to Hacienda San Miguel", not
 * "item updated") because the line is the only confirmation a drawer field
 * gets: there is no cell border to flash and no total that visibly moves when
 * she picks a vendor or ticks a box.
 */
function describePatch(
  patch: {
    name?: string;
    categoryId?: string;
    vendorId?: string | null;
    currency?: string;
    pendingGuestCount?: boolean;
    qty?: string | null;
    unitPriceRaw?: string;
    notes?: string | null;
  },
  name: string,
  categories: Array<{ id: string; name: string }>,
  vendorNameOf: (vendorId: string | null) => string | null,
): string {
  if (patch.name !== undefined) return `renamed to ${patch.name}`;
  if (patch.categoryId !== undefined) {
    return `${name} moved to ${categories.find((c) => c.id === patch.categoryId)?.name ?? "another category"}`;
  }
  if (patch.vendorId !== undefined) {
    const vendor = vendorNameOf(patch.vendorId);
    return vendor === null ? `${name} has no vendor` : `${name} linked to ${vendor}`;
  }
  if (patch.currency !== undefined) return `${name} in ${patch.currency}`;
  if (patch.pendingGuestCount !== undefined) {
    return patch.pendingGuestCount ? `${name} moves with the headcount` : `${name} is a fixed total`;
  }
  if (patch.notes !== undefined) return `note on ${name}`;
  return `${name} saved`;
}
