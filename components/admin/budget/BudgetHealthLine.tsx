import { formatMoney } from "@/lib/format/money";
import type { BudgetTotals } from "@/lib/data/budget-rules";

/**
 * Budget health as a sentence and a slim bar, not a tile that says "Healthy".
 *
 * A badge reading "On track" is a verdict with nothing behind it: it tells her
 * neither the size of the gap nor which number to move. A sentence naming both
 * figures, over a bar she can read at a glance, does both — and it takes one
 * line instead of a card's worth of the fold.
 *
 * Over budget is rendered in **rose, not an alarm red**. Being over the number
 * she typed is information, not a failure — the total is a guess she is allowed
 * to revise, and the copy says so out loud.
 */
export function BudgetHealthLine({ totals }: { totals: BudgetTotals }) {
  const total = totals.maxSpendCents;
  const remaining = totals.remainingAfterForecastCents;

  if (total === null || remaining === null) {
    return (
      <p className="text-[13.5px] leading-relaxed text-[#4a5147]">
        {"Set a total budget and this page will tell you where you stand."}
      </p>
    );
  }

  const over = remaining < 0;
  // The bar is scaled to whichever is larger, so an over-budget forecast can
  // overflow the ceiling visibly instead of pinning at a full track that looks
  // identical to spending exactly the total.
  const scale = Math.max(total, totals.forecastCents, 1);
  const withinPct = Math.max(0, Math.min(100, (Math.min(totals.forecastCents, total) / scale) * 100));
  const overPct = Math.max(0, Math.min(100 - withinPct, (Math.max(0, -remaining) / scale) * 100));
  const ceilingPct = Math.max(0, Math.min(100, (total / scale) * 100));

  const sentence = over
    ? `Your forecast is ${formatMoney(-remaining)} over your total. Nothing’s wrong — it just means the number to change is either the budget or a line below.`
    : `You’re ${formatMoney(remaining)} under your total, with ${formatMoney(totals.dueCents)} still to pay.`;

  return (
    <div className="flex flex-col gap-2">
      <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-[#f0efe3]">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-olive-deep"
          style={{ width: `${withinPct}%` }}
        />
        {overPct > 0 && (
          <span
            className="absolute inset-y-0 rounded-full bg-rose"
            style={{ left: `${withinPct}%`, width: `${overPct}%` }}
          />
        )}
        {over && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-[2px] bg-[#8a4e40]"
            style={{ left: `${ceilingPct}%` }}
          />
        )}
      </span>
      <p className={`text-[13.5px] leading-relaxed ${over ? "text-rose-deep" : "text-[#4a5147]"}`}>
        {sentence}
      </p>
    </div>
  );
}
