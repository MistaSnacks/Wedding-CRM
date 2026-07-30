import { formatMoney, formatPercent } from "@/lib/format/money";
import type { BudgetTotals } from "@/lib/data/budget-rules";

/**
 * The four numbers worth a tile.
 *
 * The client asked for ten. Ten tiles is not a summary — at ten nothing is
 * emphasised, so the eye reads none of them, which is the failure Zola fixed by
 * collapsing to three headline figures. Six of the ten are ledger facts that
 * read better under the column they summarise than floating in a card, so they
 * live in `BudgetLedgerStrip` and the table's footer instead. Nothing was
 * dropped; it was ranked.
 *
 * **Every value here comes out of `rollUpBudget`.** Not one is recomputed
 * locally, which is the only way the cards, the strip, the bars and the table's
 * `<tfoot>` can be guaranteed to agree. Two numbers on one page that disagree
 * by a dollar cost more trust than the whole feature buys.
 */
export type BudgetHeadlineProps = {
  totals: BudgetTotals;
  /** From `weddings.budget_benchmark_label`. Never a name written in code. */
  benchmarkLabel: string;
  /** `maxSpend − Σ category.target_cents`. Null when no total has been set. */
  unallocatedCents: number | null;
  /** Lines with a contracted price, of `totals.itemCount`. */
  contractedLineCount: number;
  /** Σ of `upcomingPayments(…, 30)` — unpaid and falling due within a month. */
  due30Cents: number;
  due30Count: number;
};

type Card = {
  label: string;
  value: string;
  /** Rendered in place of the value when there is no number to show yet. */
  cta?: { href: string; text: string };
  accent: string;
  accentRose?: boolean;
  sub: string;
  rose?: boolean;
};

export function BudgetHeadline({
  totals,
  benchmarkLabel,
  unallocatedCents,
  contractedLineCount,
  due30Cents,
  due30Count,
}: BudgetHeadlineProps) {
  const remaining = totals.remainingAfterForecastCents;

  // Binding decision 9 fixes these two on screen, because the client's own
  // spec calls both of them "remaining" and identical labels on different
  // quantities get read as a bug.
  const leftInBudget =
    remaining === null
      ? "no total set yet"
      : remaining >= 0
        ? `${formatMoney(remaining)} left in budget`
        : `${formatMoney(-remaining)} over budget`;

  const unallocated =
    unallocatedCents === null
      ? "waiting on your number"
      : unallocatedCents === 0
        ? "fully allocated"
        : unallocatedCents > 0
          ? `${formatMoney(unallocatedCents)} unallocated`
          : `${formatMoney(-unallocatedCents)} over-allocated`;

  const paidShare =
    totals.forecastCents === 0
      ? "nothing forecast yet"
      : `${formatPercent(totals.paidCents / totals.forecastCents)} of forecast`;

  const benchmarkSub =
    totals.benchmarkCents > 0
      ? `${benchmarkLabel} came to ${formatMoney(totals.benchmarkCents)}`
      : "No reference figures yet";

  const cards: Card[] = [
    {
      label: "TOTAL BUDGET",
      value: totals.maxSpendCents === null ? "—" : formatMoney(totals.maxSpendCents),
      ...(totals.maxSpendCents === null
        ? { cta: { href: "#budget-setup", text: "Set your total budget" } }
        : {}),
      accent: unallocated,
      accentRose: unallocatedCents !== null && unallocatedCents < 0,
      sub: benchmarkSub,
    },
    {
      label: "FORECAST",
      value: formatMoney(totals.forecastCents),
      accent: leftInBudget,
      accentRose: remaining !== null && remaining < 0,
      sub: `${contractedLineCount} of ${totals.itemCount} lines are contracted`,
    },
    {
      label: "PAID SO FAR",
      value: formatMoney(totals.paidCents),
      accent: paidShare,
      sub: `${formatMoney(totals.dueCents)} still to pay`,
    },
    {
      label: "DUE IN 30 DAYS",
      value: formatMoney(due30Cents),
      accent: `${due30Count} ${due30Count === 1 ? "payment" : "payments"}`,
      sub:
        totals.overdueCount > 0
          ? `${totals.overdueCount} overdue · ${formatMoney(totals.overdueCents)}`
          : "nothing overdue",
      // Mirrors the NEEDS ATTENTION card on the Overview: rose is reserved for
      // money that is actually late, never for money that is merely large.
      rose: totals.overdueCents > 0,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2 max-md:gap-2.5">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-2 rounded-[14px] border border-hairline p-5 max-md:p-4"
        >
          <span className="text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]">{c.label}</span>
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={`text-[34px] font-semibold leading-none tabular-nums ${
                c.rose ? "text-rose" : c.value === "—" ? "text-muted" : "text-ink"
              }`}
            >
              {c.value}
            </span>
            <span
              className={`text-[13px] font-medium ${c.accentRose ? "text-rose" : "text-olive"}`}
            >
              {c.accent}
            </span>
          </span>
          {c.cta ? (
            <a
              href={c.cta.href}
              className="self-start text-[12.5px] font-medium text-olive underline underline-offset-2 hover:text-rose"
            >
              {c.cta.text}
            </a>
          ) : (
            <span className="text-[12.5px] text-muted">{c.sub}</span>
          )}
        </div>
      ))}
    </div>
  );
}
