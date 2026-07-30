"use client";

import { formatMoney } from "@/lib/format/money";
import type { ItemRollup } from "@/lib/data/budget-rules";
import { DeltaCell } from "./DeltaCell";
import { COST_FIELD_LABEL, MoneyCell, type CellFlags, type CostField } from "./MoneyCell";

/**
 * One budget line, across the nine columns of the ledger.
 *
 * The vendor is folded into the name cell rather than given a column of its own.
 * That buys about 140px back for the numbers — which are what this table is for
 * — and it reads better as a subtitle anyway: "Venue Rental, from Hacienda San
 * Miguel" is a sentence, whereas the same two facts in adjacent columns are a
 * lookup.
 *
 * Everything not on this row — notes, quantity, the payment schedule, the
 * currency, delete — is behind the chevron. A bride on a phone cannot read
 * fifteen columns, and neither can a bride on a laptop with a vendor on the
 * other end of the line.
 */
export function BudgetItemRow(props: {
  rollup: ItemRollup;
  benchmarkLabel: string;
  /** The wedding's own currency, so a line in another one can be flagged, never converted. */
  currency: string;
  canEdit: boolean;
  vendorName: string | null;
  flags: (field: CostField) => CellFlags;
  onCommit: (field: CostField, raw: string) => void;
  onClearError: (field: CostField) => void;
  onOpen: () => void;
  isOpen: boolean;
}) {
  const { rollup, canEdit } = props;
  const item = rollup.item;
  const foreignCurrency = item.currency !== props.currency;

  function money(field: CostField, cents: number | null, emphasis?: boolean) {
    return (
      <MoneyCell
        cents={cents}
        itemName={item.name}
        fieldLabel={COST_FIELD_LABEL[field]}
        canEdit={canEdit}
        emphasis={emphasis}
        pending={props.flags(field).pending}
        justSaved={props.flags(field).justSaved}
        errored={props.flags(field).errored}
        onCommit={(raw) => props.onCommit(field, raw)}
        onFocus={() => props.onClearError(field)}
      />
    );
  }

  return (
    <tr className={`border-b border-[#f1f0ea] last:border-0 ${props.isOpen ? "bg-paper/70" : "hover:bg-paper/50"}`}>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink">{item.name}</span>
          {item.pending_guest_count && (
            <span className="shrink-0 rounded-full bg-[#f3edd8] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-[#7a6420]">PER HEAD</span>
          )}
          {foreignCurrency && (
            <span className="shrink-0 rounded-full bg-[#f3edd8] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-[#7a6420]">{item.currency}</span>
          )}
        </span>
        <span className="mt-0.5 block text-[11.5px]">
          {props.vendorName ? (
            <a href={`/admin/vendors/${item.vendor_id}`} className="text-olive hover:text-rose">
              {props.vendorName}
            </a>
          ) : (
            <span className="text-muted">No vendor yet</span>
          )}
        </span>
      </td>

      <td className="px-3 py-2.5 text-right text-[13px] text-muted tabular-nums">{formatMoney(item.benchmark_cents)}</td>
      <td className="px-1 py-1.5">{money("estimated_cents", item.estimated_cents)}</td>
      <td className="px-1 py-1.5">{money("quoted_cents", item.quoted_cents)}</td>
      <td className="px-1 py-1.5">{money("contracted_cents", item.contracted_cents, true)}</td>

      <td className={`px-3 py-2.5 text-right text-[13px] tabular-nums ${rollup.paidCents > 0 ? "text-olive-deep" : "text-muted"}`}>
        {formatMoney(rollup.paidCents)}
      </td>
      <td className={`px-3 py-2.5 text-right text-[13px] tabular-nums ${rollup.hasOverdue ? "font-semibold text-rose" : "text-[#4a5147]"}`}>
        {formatMoney(rollup.remainingCents)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <DeltaCell delta={rollup.benchmark} benchmarkLabel={props.benchmarkLabel} />
      </td>

      <td className="px-2 py-2.5 text-right">
        <button
          type="button"
          onClick={props.onOpen}
          aria-expanded={props.isOpen}
          aria-label={`Open ${item.name}`}
          className="rounded-md p-1 text-muted transition-colors hover:bg-paper hover:text-olive-deep motion-reduce:transition-none"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </td>
    </tr>
  );
}
