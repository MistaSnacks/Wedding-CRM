import { formatMoney } from "@/lib/format/money";
import type { BudgetTotals } from "@/lib/data/budget-rules";

/**
 * The six ledger facts the headline cards demoted, on one line.
 *
 * These are the numbers the client listed that are not headlines: they answer a
 * question you already have ("how much of this is actually signed?") rather
 * than raising one. On a line, under the cards, they cost no attention until
 * wanted — which is what a tile cannot do.
 *
 * Every figure is read straight off `rollUpBudget`, including the two that look
 * derived:
 *
 * - `STILL ESTIMATED` is `forecast − contracted`. Because an item's forecast
 *   *is* its contracted price whenever one exists, that subtraction is exactly
 *   the sum of the forecasts of the lines with no contract yet — no second walk
 *   of the tree, and no chance of the two disagreeing.
 * - `LEFT IN BUDGET` is `remainingAfterForecastCents`, the same field the
 *   FORECAST card's accent uses, so the card and the strip cannot drift apart.
 */
export type BudgetLedgerStripProps = {
  totals: BudgetTotals;
  benchmarkLabel: string;
  /** Contingency target less what is forecast against it. Null when there is no such category. */
  contingencyLeftCents: number | null;
};

export function BudgetLedgerStrip({
  totals,
  benchmarkLabel,
  contingencyLeftCents,
}: BudgetLedgerStripProps) {
  const remaining = totals.remainingAfterForecastCents;
  const overBudget = remaining !== null && remaining < 0;

  const entries: Array<{ label: string; value: string; tone?: "rose" | "muted" }> = [
    { label: "Contracted", value: formatMoney(totals.known.contractedCents) },
    {
      label: "Still estimated",
      value: formatMoney(totals.forecastCents - totals.contractedCents),
    },
    { label: "Still to pay", value: formatMoney(totals.dueCents) },
    {
      label: overBudget ? "Over budget" : "Left in budget",
      value: remaining === null ? "—" : formatMoney(Math.abs(remaining)),
      ...(overBudget ? { tone: "rose" as const } : {}),
      ...(remaining === null ? { tone: "muted" as const } : {}),
    },
    {
      label: "Contingency left",
      value: contingencyLeftCents === null ? "—" : formatMoney(contingencyLeftCents),
      ...(contingencyLeftCents === null
        ? { tone: "muted" as const }
        : contingencyLeftCents < 0
          ? { tone: "rose" as const }
          : {}),
    },
    {
      label: `${benchmarkLabel} total`,
      value: totals.benchmarkCents > 0 ? formatMoney(totals.benchmarkCents) : "—",
      tone: "muted",
    },
  ];

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-xl border border-hairline bg-paper/70 px-5 py-3.5">
      {entries.map((entry) => (
        <div key={entry.label} className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6b7167]">
            {entry.label}
          </span>
          <span
            className={`text-[15px] font-semibold tabular-nums ${
              entry.tone === "rose" ? "text-rose" : entry.tone === "muted" ? "text-muted" : "text-ink"
            }`}
          >
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
