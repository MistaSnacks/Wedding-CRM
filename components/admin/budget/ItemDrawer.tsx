"use client";

import { useEffect, useRef, useState } from "react";
import { centsToInputValue, formatMoney, formatMoneySigned } from "@/lib/format/money";
import type { ItemRollup } from "@/lib/data/budget-rules";
import type { VendorStatus } from "@/lib/types";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { MoneyCell, type CellFlags, type CostField } from "./MoneyCell";
import { PaymentSchedule } from "./PaymentSchedule";
import { VendorLinkPicker } from "./VendorLinkPicker";

/** The columns the drawer edits that the budget tree does not carry. */
export type ItemDetail = {
  qty: string | null;
  unitPriceCents: number | null;
  notes: string | null;
  /** Receipt links by payment id. */
  receiptUrls: Record<string, string | null>;
};

/**
 * Everything about one line that does not belong in a nine-column table.
 *
 * A drawer rather than a page, because the answer to "how much is the venue?"
 * is usually followed by "and how does that compare to the rest of it" — losing
 * the ledger behind a navigation makes the couple hold the table in their head.
 * A drawer keeps the context one Escape away.
 *
 * The four cost fields are the *same* `MoneyCell` the table uses, on purpose:
 * one commit path, one error path, one saved-flash, and no second
 * implementation of "what happens when she types banana". The reference figure
 * is editable here and read-only in the table — it is a fact about someone
 * else's wedding, so it should be correctable but never something she tabs
 * through while pricing her own.
 *
 * Notes, quantity, unit price and each payment's receipt link come in through
 * `detail` rather than from the tree: `ItemFact` and `PaymentFact` carry only
 * the columns the rollups need, so `BudgetTree` has none of them. While that
 * read is in flight those inputs are **disabled rather than empty** — a note box
 * that starts blank and fills itself in a beat later is how a real note gets
 * typed over.
 */
export function ItemDrawer(props: {
  rollup: ItemRollup;
  categories: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; name: string; status: VendorStatus }>;
  benchmarkLabel: string;
  currency: string;
  todayAtVenue: string;
  canEdit: boolean;
  pending: boolean;
  /** `null` until the detail read lands. */
  detail: ItemDetail | null;
  flags: (field: CostField) => CellFlags;
  onCommitCost: (field: CostField, raw: string) => void;
  onClearError: (field: CostField) => void;
  onPatchItem: (patch: {
    name?: string;
    categoryId?: string;
    vendorId?: string | null;
    currency?: string;
    pendingGuestCount?: boolean;
    qty?: string | null;
    /** Raw text; the table parses it so a bad amount gets her own message. */
    unitPriceRaw?: string;
    notes?: string | null;
  }) => void;
  onDelete: () => Promise<void>;
  onAddPayment: (values: { label: string; amount: string; dueDate: string | null }) => void;
  onSplitDeposit: (values: { total: string; deposit: string; depositDue: string | null; balanceDue: string | null }) => void;
  onSetPaymentPaid: (paymentId: string, paid: boolean) => void;
  onPatchPayment: (
    paymentId: string,
    patch: { label?: string; amountRaw?: string; dueDate?: string | null; paidOn?: string | null; receiptUrl?: string | null },
  ) => void;
  onRemovePayment: (paymentId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { rollup, canEdit } = props;
  const item = rollup.item;
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  // Held in a ref so the listener is attached once. `onClose` is a fresh closure
  // on every parent render, and depending on it directly would tear down and
  // rebuild the handler between keystrokes anywhere on the page.
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const delta = rollup.benchmark.deltaCents;
  const readBack = [
    `Forecast ${formatMoney(rollup.forecastStage === null ? null : rollup.forecastCents)}`,
    `paid ${formatMoney(rollup.paidCents)}`,
    `still to pay ${formatMoney(rollup.remainingCents)}`,
    delta === null ? `no ${props.benchmarkLabel} comparison yet` : `${formatMoneySigned(delta)} vs ${props.benchmarkLabel}`,
  ].join(" · ");

  const label = "text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]";
  const field = "w-full rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13.5px] text-ink outline-none focus:border-olive";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/20" onClick={props.onClose} aria-hidden="true" />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} details`}
        className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-full flex-col gap-5 overflow-y-auto border-l border-hairline bg-cream p-6 shadow-[0_0_40px_rgba(28,35,27,0.14)] outline-none max-md:inset-0 max-md:w-full max-md:border-l-0"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {canEdit ? (
              <BlurText
                value={item.name}
                ariaLabel="Name of this line"
                disabled={props.pending}
                onCommit={(next) => props.onPatchItem({ name: next })}
                className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-display text-[24px] font-medium text-olive-deep outline-none hover:border-[#dddbd0] focus:border-olive focus:bg-white"
              />
            ) : (
              <h2 className="font-display text-[24px] font-medium text-olive-deep">{item.name}</h2>
            )}
            {canEdit ? (
              <select
                value={item.category_id}
                disabled={props.pending}
                aria-label="Category for this line"
                onChange={(event) => props.onPatchItem({ categoryId: event.target.value })}
                className="mt-1.5 rounded-md border border-[#dddbd0] bg-white px-2 py-1 text-[12.5px] text-[#4a5147] outline-none focus:border-olive"
              >
                {props.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-[12.5px] text-[#4a5147]">{props.categories.find((c) => c.id === item.category_id)?.name ?? ""}</p>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-paper hover:text-ink motion-reduce:transition-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <section className="flex flex-col gap-2">
          <span className={label}>WHAT IT COSTS</span>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ["benchmark_cents", props.benchmarkLabel, item.benchmark_cents],
                ["estimated_cents", "Estimate", item.estimated_cents],
                ["quoted_cents", "Quote", item.quoted_cents],
                ["contracted_cents", "Contract", item.contracted_cents],
              ] as Array<[CostField, string, number | null]>
            ).map(([costField, caption, cents]) => (
              <label key={costField} className="flex flex-col gap-1">
                <span className="truncate text-[10.5px] font-medium text-[#6b7167]" title={caption}>
                  {caption}
                </span>
                <span className="rounded-lg border border-[#dddbd0] bg-white">
                  <MoneyCell
                    cents={cents}
                    itemName={item.name}
                    fieldLabel={caption}
                    canEdit={canEdit}
                    emphasis={costField === "contracted_cents"}
                    pending={props.flags(costField).pending}
                    justSaved={props.flags(costField).justSaved}
                    errored={props.flags(costField).errored}
                    onCommit={(raw) => props.onCommitCost(costField, raw)}
                    onFocus={() => props.onClearError(costField)}
                  />
                </span>
              </label>
            ))}
          </div>
          <p className="text-[12.5px] leading-relaxed text-[#4a5147]">{readBack}</p>
        </section>

        <VendorLinkPicker
          vendorId={item.vendor_id}
          vendors={props.vendors}
          canEdit={canEdit}
          disabled={props.pending}
          onChange={(vendorId) => props.onPatchItem({ vendorId })}
        />

        {canEdit && (
          <section className="flex flex-col gap-2">
            <span className={label}>HOW MANY</span>
            <div className="grid grid-cols-2 gap-3">
              <BlurText
                value={props.detail?.qty ?? ""}
                ariaLabel="Quantity"
                placeholder="Qty"
                disabled={props.pending || props.detail === null}
                onCommit={(next) => props.onPatchItem({ qty: next.trim() === "" ? null : next.trim() })}
                className={field}
              />
              <BlurText
                value={centsToInputValue(props.detail?.unitPriceCents ?? null)}
                ariaLabel="Price for each"
                placeholder="Each"
                disabled={props.pending || props.detail === null}
                onCommit={(next) => props.onPatchItem({ unitPriceRaw: next })}
                className={`${field} text-right tabular-nums`}
              />
            </div>
            <QuantityHint detail={props.detail} contracted={item.contracted_cents} onUse={(raw) => props.onCommitCost("estimated_cents", raw)} />
          </section>
        )}

        <section className="flex flex-col gap-2">
          <span className={label}>CURRENCY</span>
          {canEdit ? (
            <select
              value={item.currency}
              disabled={props.pending}
              aria-label="Currency for this line"
              onChange={(event) => props.onPatchItem({ currency: event.target.value })}
              className={field}
            >
              <option value="USD">USD</option>
              <option value="MXN">MXN</option>
            </select>
          ) : (
            <span className="text-[13.5px] text-[#4a5147]">{item.currency}</span>
          )}
          <p className="text-[11.5px] leading-relaxed text-muted">
            {"We show every number exactly as you typed it and never convert between currencies."}
          </p>
        </section>

        {canEdit && (
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={item.pending_guest_count}
              disabled={props.pending}
              onChange={(event) => props.onPatchItem({ pendingGuestCount: event.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#3b4823]"
            />
            <span className="text-[12.5px] leading-relaxed text-[#4a5147]">
              {"This total moves with the final guest count — it's a per-head cost."}
            </span>
          </label>
        )}

        <section className="flex flex-col gap-2">
          <span className={label}>NOTES</span>
          {canEdit ? (
            <BlurTextArea
              value={props.detail?.notes ?? ""}
              disabled={props.pending || props.detail === null}
              onCommit={(next) => props.onPatchItem({ notes: next.trim() === "" ? null : next })}
            />
          ) : (
            <p className="text-[13px] leading-relaxed text-[#4a5147]">{props.detail?.notes ?? "—"}</p>
          )}
        </section>

        <PaymentSchedule
          rollup={rollup}
          receiptUrls={props.detail === null ? null : props.detail.receiptUrls}
          canEdit={canEdit}
          pending={props.pending}
          todayAtVenue={props.todayAtVenue}
          onAdd={props.onAddPayment}
          onSplit={props.onSplitDeposit}
          onSetPaid={props.onSetPaymentPaid}
          onPatch={props.onPatchPayment}
          onRemove={props.onRemovePayment}
        />

        {canEdit && (
          <div className="mt-auto border-t border-hairline pt-4">
            <ConfirmButton
              variant="danger"
              label="Delete this line"
              confirmLabel={`Delete ${item.name} and its ${rollup.payments.length} ${rollup.payments.length === 1 ? "payment" : "payments"}?`}
              action={props.onDelete}
            />
          </div>
        )}
      </div>
    </>
  );
}

/** Text that reports on blur or Enter and reverts on Escape. Same contract as `MoneyCell`. */
function BlurText(props: {
  value: string;
  ariaLabel: string;
  placeholder?: string;
  disabled: boolean;
  className: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  const [focused, setFocused] = useState(false);
  const skip = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(props.value);
  }, [props.value, focused]);

  return (
    <input
      value={draft}
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (skip.current) {
          skip.current = false;
          return;
        }
        if (draft === props.value) return;
        props.onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          skip.current = true;
          setDraft(props.value);
          event.currentTarget.blur();
        }
      }}
      className={props.className}
    />
  );
}

/**
 * "200 × $4.00 = $800 — use this?"
 *
 * A button, never an auto-fill. Quantity times unit price is a good guess at an
 * estimate and a terrible replacement for one: the couple may have a flat quote,
 * a minimum, or a price that already includes service. Offered, it saves a
 * calculation; applied silently, it overwrites a number someone was given over
 * the phone.
 *
 * Hidden once a contract exists, because by then the arithmetic is history.
 */
function QuantityHint(props: { detail: ItemDetail | null; contracted: number | null; onUse: (raw: string) => void }) {
  const detail = props.detail;
  if (detail === null || props.contracted !== null) return null;
  if (detail.qty === null || detail.unitPriceCents === null) return null;

  // `qty` is free text in the database — the source sheet has "100 liters
  // (abundant)" in it — so the hint only appears when it is genuinely a number.
  const count = Number(detail.qty.trim());
  if (!Number.isFinite(count) || count <= 0) return null;

  const total = Math.round(count * detail.unitPriceCents);
  return (
    <button
      type="button"
      onClick={() => props.onUse(centsToInputValue(total))}
      className="self-start text-[12px] text-olive underline transition-colors hover:text-rose motion-reduce:transition-none"
    >
      {`${count} × ${formatMoney(detail.unitPriceCents)} = ${formatMoney(total)} — use this?`}
    </button>
  );
}

/** The notes box. Enter is a newline here, so it commits on blur only. */
function BlurTextArea(props: { value: string; disabled: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(props.value);
  }, [props.value, focused]);

  return (
    <textarea
      rows={3}
      value={draft}
      disabled={props.disabled}
      aria-label="Notes about this line"
      placeholder="Anything you want to remember about this line"
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft === props.value) return;
        props.onCommit(draft);
      }}
      className="w-full rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-olive disabled:opacity-50"
    />
  );
}
