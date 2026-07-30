import { requireAdmin } from "@/lib/admin-auth";
import { defaultScope } from "@/lib/data/scope";
import * as budget from "@/lib/data/budget";
import { calendarDayIn } from "@/lib/format/wedding-date";
import { formatMoney } from "@/lib/format/money";
import { BudgetHeadline } from "@/components/admin/budget/BudgetHeadline";
import { BudgetLedgerStrip } from "@/components/admin/budget/BudgetLedgerStrip";
import { BudgetHealthLine } from "@/components/admin/budget/BudgetHealthLine";
import { CategoryBars } from "@/components/admin/budget/CategoryBars";
import { CashFlowStrip } from "@/components/admin/budget/CashFlowStrip";
import { BudgetSetup, type SetupCategory } from "@/components/admin/budget/BudgetSetup";
import { BudgetEmptyState } from "@/components/admin/budget/BudgetEmptyState";
import { BudgetTable } from "@/components/admin/budget/BudgetTable";

export const dynamic = "force-dynamic";

/**
 * The budget screen.
 *
 * `requireAdmin`, not `requireEditorPage`: a viewer can read the budget. Every
 * *write* is gated inside the server action, which is the only gate that
 * matters — the admin surface runs on the service-role client and bypasses RLS,
 * so a hidden button is decoration and `requireEditor()` is the security
 * boundary. `canEdit` rides down so read-only users see text where an editor
 * sees an input.
 *
 * The timezone is read the way `layout.tsx` reads it, and for the same reason:
 * a payment "due today" has to mean today at the venue. Vercel runs UTC, so
 * getting this wrong looks perfect on a laptop in California and is wrong in
 * production every evening in Guadalajara.
 *
 * No arithmetic happens here beyond four sums that are named and explained
 * below. Everything else is `rollUpBudget`'s, which is where vitest can see it.
 */
export default async function BudgetPage() {
  const admin = await requireAdmin();
  const scope = defaultScope();
  const now = new Date();

  const { data: weddingRow } = await scope.db
    .from("weddings")
    .select("timezone, wedding_date")
    .eq("id", scope.weddingId)
    .single();
  const wedding: { timezone: string | null; wedding_date: string | null } | null = weddingRow;
  const timeZone: string = wedding?.timezone ?? "America/Los_Angeles";

  const tree = await budget.tree(scope, now, timeZone);
  const { totals, categories } = tree;
  const canEdit = admin.role !== "viewer";

  // --- The only four sums this file computes -------------------------------
  // Each is a plain Σ over a stored column, not a rollup: `rollUpBudget` has no
  // opinion about allocation targets or about which lines are contracted, and
  // inventing a second rollup here to hold them is how two numbers on one page
  // start to disagree. Every *money* figure on screen still comes from the
  // rollups; these four only describe them.

  /** Σ `budget_categories.target_cents` — how much of the ceiling is spoken for. */
  const targetsTotalCents = categories.reduce((sum, c) => sum + (c.category.target_cents ?? 0), 0);
  const unallocatedCents =
    totals.maxSpendCents === null ? null : totals.maxSpendCents - targetsTotalCents;

  /**
   * The contingency's headroom.
   *
   * Deliberately `target − Σ(item forecasts)` rather than `target − category
   * forecast`: a category with no items falls back to its target as its
   * forecast, which would report an untouched contingency as entirely used up.
   */
  const contingency = categories.find((c) => c.category.is_contingency) ?? null;
  const contingencyLeftCents =
    contingency === null || contingency.category.target_cents === null
      ? null
      : contingency.category.target_cents -
        contingency.items.reduce((sum, i) => sum + i.forecastCents, 0);

  /** How many lines carry a signed price, of all of them. */
  const contractedLineCount = categories.reduce(
    (count, c) => count + c.items.filter((i) => i.item.contracted_cents !== null).length,
    0,
  );

  /** `upcomingPayments(…, 30)` already excludes overdue; the overdue card owns those. */
  const due30Cents = tree.upcoming.reduce((sum, p) => sum + p.amount_cents, 0);

  // -------------------------------------------------------------------------

  const allPayments = categories.flatMap((c) => c.items.flatMap((i) => i.payments));
  const itemNameById = new Map(
    categories.flatMap((c) => c.items.map((i) => [i.item.id, i.item.name] as const)),
  );
  const todayCalendarDay = calendarDayIn(now, timeZone);

  const setupCategories: SetupCategory[] = categories.map((c) => ({
    id: c.category.id,
    name: c.category.name,
    benchmarkCents: c.benchmarkCents,
    targetCents: c.category.target_cents,
    isContingency: c.category.is_contingency,
  }));

  // "0 lines · $62,970 forecast" is a true sentence that reads like a bug. When
  // no line has been priced, that forecast is the sum of the category targets —
  // a plan, not a forecast — so it is named as one.
  const lead =
    totals.itemCount === 0
      ? `Nothing priced yet · ${formatMoney(totals.forecastCents)} set aside across ${categories.length} ${categories.length === 1 ? "category" : "categories"}`
      : `${totals.itemCount} ${totals.itemCount === 1 ? "line" : "lines"} · ${formatMoney(totals.forecastCents)} forecast`;
  const subtitle =
    totals.maxSpendCents === null
      ? lead
      : `${lead}, against ${formatMoney(totals.maxSpendCents)}`;

  // The first-run hero replaces the page only when there is genuinely nothing:
  // no lines *and* no categories. Once targets exist, the cards read them
  // honestly — a $0 card is information, and a hero over the top of a budget
  // she has already started is a page that has stopped paying attention.
  const isEmpty = totals.itemCount === 0 && categories.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold text-ink">Budget</h1>
          <p className="mt-0.5 text-[13.5px] text-[#6b7167]">{subtitle}</p>
        </div>
        {canEdit && (
          <a
            href="#budget-setup"
            className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose"
          >
            {totals.maxSpendCents === null ? "Set your total" : "Adjust targets"}
          </a>
        )}
      </div>

      {!canEdit && (
        <p className="text-[12.5px] text-muted">
          {"You’re viewing this budget. Ask whoever set it up if you need to change a number."}
        </p>
      )}

      {isEmpty ? (
        <>
          <BudgetEmptyState canEdit={canEdit} hasCategories={categories.length > 0} />
          <BudgetSetup
            totalCents={totals.maxSpendCents}
            benchmarkLabel={tree.benchmarkLabel}
            benchmarkTotalCents={totals.benchmarkCents}
            categories={setupCategories}
            canEdit={canEdit}
          />
        </>
      ) : (
        <>
          <BudgetHeadline
            totals={totals}
            benchmarkLabel={tree.benchmarkLabel}
            unallocatedCents={unallocatedCents}
            contractedLineCount={contractedLineCount}
            due30Cents={due30Cents}
            due30Count={tree.upcoming.length}
          />

          <BudgetLedgerStrip
            totals={totals}
            benchmarkLabel={tree.benchmarkLabel}
            contingencyLeftCents={contingencyLeftCents}
          />

          <BudgetHealthLine totals={totals} />

          {tree.overdue.length > 0 && (
            <section className="rounded-xl border border-blush-border bg-blush p-5">
              <h2 className="text-[14.5px] font-semibold text-rose-deep">
                Payments that have slipped past
              </h2>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {tree.overdue.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12.5px]"
                  >
                    <span className="font-medium text-ink">
                      {itemNameById.get(payment.item_id) ?? payment.label}
                    </span>
                    <span className="text-[#4a5147]">{payment.label}</span>
                    <span className="font-semibold tabular-nums text-rose-deep">
                      {formatMoney(payment.amount_cents)}
                    </span>
                    <span className="text-rose-deep">{payment.label_due}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {totals.mixedCurrency && (
            <section className="rounded-xl border border-hairline bg-paper/70 p-5">
              <h2 className="text-[14.5px] font-semibold text-ink">
                {`This budget mixes ${totals.currencies.join(" and ")}`}
              </h2>
              <p className="mt-1.5 max-w-[70ch] text-[12.5px] leading-relaxed text-[#4a5147]">
                {"We show every number exactly as you typed it and never convert between currencies — so the totals on this page add up amounts in more than one. Tell us which you’d rather work in and we’ll sort it out."}
              </p>
            </section>
          )}

          <BudgetTable
            tree={tree}
            benchmarkLabel={tree.benchmarkLabel}
            currency={tree.currency}
            canEdit={canEdit}
            timeZone={timeZone}
            weddingDay={wedding?.wedding_date ?? null}
          />

          <CategoryBars categories={categories} benchmarkLabel={tree.benchmarkLabel} />

          <CashFlowStrip
            payments={allPayments}
            todayCalendarDay={todayCalendarDay}
            weddingDay={wedding?.wedding_date ?? null}
          />

          <BudgetSetup
            totalCents={totals.maxSpendCents}
            benchmarkLabel={tree.benchmarkLabel}
            benchmarkTotalCents={totals.benchmarkCents}
            categories={setupCategories}
            canEdit={canEdit}
          />
        </>
      )}
    </div>
  );
}
