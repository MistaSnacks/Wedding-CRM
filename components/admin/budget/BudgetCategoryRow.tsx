"use client";

import { formatMoney } from "@/lib/format/money";
import type { CategoryRollup } from "@/lib/data/budget-rules";
import { DeltaCell } from "./DeltaCell";

/**
 * A category's header and its subtotal, in one row.
 *
 * Deliberately not a heading above a separate totals line: the summary sits in
 * the *same seven columns* as the lines beneath it, so "what did we estimate for
 * food" and "what did we estimate for the tacos" read down a single axis. A
 * category strip that spans the table and then repeats the totals somewhere else
 * makes the reader do the alignment in their head.
 *
 * Collapsing hides the item rows and never this one. The point of collapsing a
 * category is to see the shape of the budget without its detail, and a fold that
 * removed the subtotal would take the answer away with the question.
 */
export function BudgetCategoryRow(props: {
  rollup: CategoryRollup;
  benchmarkLabel: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { rollup } = props;
  const lines = rollup.items.length;
  const target = rollup.category.target_cents;

  const caption = [
    `${lines} ${lines === 1 ? "line" : "lines"}`,
    target === null ? null : `target ${formatMoney(target)}`,
    rollup.overdueCount > 0 ? `${rollup.overdueCount} overdue` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const cell = "px-3 py-2 text-right text-[12.5px] font-semibold text-ink tabular-nums";

  return (
    <tr className="border-y border-hairline bg-sage-band/50">
      <td className="px-4 py-2">
        <button type="button" onClick={props.onToggle} aria-expanded={!props.collapsed} className="flex items-center gap-2 text-left">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3 w-3 shrink-0 text-olive-deep transition-transform duration-200 motion-reduce:transition-none ${props.collapsed ? "" : "rotate-90"}`}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-[13px] font-semibold text-olive-deep">{rollup.category.name}</span>
          <span className="text-[11.5px] font-normal text-[#6b7167]">{caption}</span>
        </button>
      </td>

      <td className={`${cell} font-medium text-muted`}>{formatMoney(rollup.benchmark.benchmarkCents)}</td>
      <td className={cell}>{formatMoney(rollup.estimatedCents)}</td>
      <td className={cell}>{formatMoney(rollup.quotedCents)}</td>
      <td className={cell}>{formatMoney(rollup.contractedCents)}</td>
      <td className={cell}>{formatMoney(rollup.paidCents)}</td>
      <td className={`${cell} ${rollup.overdueCents > 0 ? "text-rose" : ""}`}>{formatMoney(rollup.remainingCents)}</td>
      <td className="px-3 py-2 text-right">
        <DeltaCell delta={rollup.benchmark} benchmarkLabel={props.benchmarkLabel} />
      </td>
      <td className="px-2 py-2" />
    </tr>
  );
}
