"use client";

import { formatMoney, formatMoneySigned } from "@/lib/format/money";
import type { CategoryRollup, ItemRollup } from "@/lib/data/budget-rules";

/**
 * The budget on a phone, standing in a venue with a vendor talking at you.
 *
 * A genuine duplicate of the table, not a squeezed one. Nine columns cannot be
 * made to work at 390px, and the honest response is to decide what actually
 * matters at arm's length: **what is it, who's it with, what does it cost, and
 * where does that stand.** Estimate, quote and contract collapse into the single
 * forecast, because the difference between them is a planning question and this
 * screen is for answering "have we paid the photographer yet".
 *
 * **No inline editing here.** A money input at this size is a mis-tap waiting to
 * happen, and a mis-tap in a budget is a wrong number nobody notices. Tapping a
 * card opens the drawer, where every field has room, and the list says so at the
 * bottom rather than leaving her to discover it.
 */
export function BudgetItemCards(props: {
  categories: CategoryRollup[];
  benchmarkLabel: string;
  vendorName: (item: ItemRollup) => string | null;
  onOpen: (itemId: string) => void;
}) {
  const anyItems = props.categories.some((category) => category.items.length > 0);

  return (
    <div className="flex flex-col gap-5 md:hidden">
      {props.categories.map((category) => (
        <section key={category.category.id} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-semibold tracking-[0.08em] text-[#6b7167] uppercase">{category.category.name}</h3>
            <span className="text-[12px] font-semibold text-ink tabular-nums">{formatMoney(category.forecastCents)}</span>
          </div>

          {category.items.map((rollup) => (
            <ItemCard
              key={rollup.item.id}
              rollup={rollup}
              benchmarkLabel={props.benchmarkLabel}
              vendorName={props.vendorName(rollup)}
              onOpen={() => props.onOpen(rollup.item.id)}
            />
          ))}

          {category.items.length === 0 && (
            <p className="rounded-xl border border-hairline px-4 py-5 text-center text-[12.5px] text-muted">Nothing here yet</p>
          )}
        </section>
      ))}

      {!anyItems && (
        <p className="rounded-xl border border-hairline px-4 py-8 text-center text-[13px] text-muted">
          {"Nothing in the budget yet. Add your first line on a bigger screen, or start from the reference wedding."}
        </p>
      )}

      {anyItems && <p className="text-center text-[11.5px] text-muted">Tap a line to edit it.</p>}
    </div>
  );
}

function ItemCard(props: { rollup: ItemRollup; benchmarkLabel: string; vendorName: string | null; onOpen: () => void }) {
  const { rollup } = props;
  const overdueCents = rollup.payments
    .filter((payment) => payment.status === "overdue")
    .reduce((sum, payment) => sum + payment.amount_cents, 0);

  const status =
    overdueCents > 0 ? (
      <span className="text-[11.5px] font-semibold text-rose">{`${formatMoney(overdueCents)} overdue`}</span>
    ) : rollup.paymentStatus === "paid" ? (
      <span className="text-[11.5px] text-olive-deep">Paid in full</span>
    ) : rollup.paidCents > 0 ? (
      <span className="text-[11.5px] text-[#4a5147]">{`${formatMoney(rollup.paidCents)} paid · ${formatMoney(rollup.remainingCents)} to go`}</span>
    ) : (
      <span className="text-[11.5px] text-muted">Nothing paid yet</span>
    );

  const delta = rollup.benchmark.deltaCents;
  const deltaTone = rollup.benchmark.direction === "over" ? "text-rose" : rollup.benchmark.direction === "under" ? "text-olive-deep" : "text-muted";

  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="flex w-full items-start gap-3 rounded-xl border border-hairline bg-white/70 px-4 py-3.5 text-left active:bg-paper"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ink">{props.rollup.item.name}</span>
        <span className="mt-0.5 block truncate text-[12.5px] text-[#4a5147]">{props.vendorName ?? "No vendor yet"}</span>
        <span className="mt-1 block truncate text-[11.5px] text-muted">
          {`${props.benchmarkLabel}: ${formatMoney(rollup.item.benchmark_cents)}`}
          {delta !== null && <span className={`ml-1 font-medium ${deltaTone}`}>{formatMoneySigned(delta)}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[15px] font-semibold text-ink tabular-nums">
          {formatMoney(rollup.forecastStage === null ? null : rollup.forecastCents)}
        </span>
        {status}
      </span>
    </button>
  );
}
