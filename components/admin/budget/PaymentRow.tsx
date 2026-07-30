"use client";

import { useEffect, useRef, useState } from "react";
import { centsToInputValue, formatMoney } from "@/lib/format/money";
import type { PaymentView } from "@/lib/data/budget-rules";
import { ConfirmButton } from "@/components/admin/ConfirmButton";

/**
 * One installment: what it is, what it costs, when it is due, whether it is paid.
 *
 * **Every date word on this row comes from `label_due`**, which the rules module
 * derives from the *signed* `calendarDayDelta` against the venue's calendar day.
 * That is not a detail. `daysUntilCalendarDate` floors at zero, so through it
 * yesterday and today are the same number and nothing is ever late; and
 * `new Date(payment.due_date)` reads a calendar day as a UTC midnight, which on
 * Vercel — running UTC — turns a payment due this morning in Guadalajara red
 * overnight while everyone is asleep. Both bugs have shipped in this repo.
 *
 * Marking paid reveals the paid-on date already filled in with today at the
 * venue, rather than opening a dialogue to ask for it. The answer is right
 * almost every time, and when it is wrong the correction is one click away in
 * the field that is already showing the wrong answer.
 *
 * Un-ticking needs no confirmation. It is trivially reversible, and a
 * "are you sure?" on a reversible action teaches people to click through the
 * ones that are not.
 */
export function PaymentRow(props: {
  payment: PaymentView;
  canEdit: boolean;
  pending: boolean;
  /** Today at the venue, as `YYYY-MM-DD`. Never `new Date()` in a component. */
  todayAtVenue: string;
  /** The stored receipt link; `undefined` while the drawer's detail read is in flight. */
  receiptUrl: string | null | undefined;
  /** The toggle only. The server stamps the day from the venue's calendar, not the browser's. */
  onSetPaid: (paid: boolean) => void;
  onPatch: (patch: {
    label?: string;
    amountRaw?: string;
    dueDate?: string | null;
    paidOn?: string | null;
    receiptUrl?: string | null;
  }) => void;
  onRemove: () => Promise<void>;
}) {
  const { payment } = props;

  const rowTone =
    payment.status === "paid"
      ? "border-b border-[#f1f0ea] opacity-80"
      : payment.status === "overdue"
        ? "border-b border-blush-border bg-blush"
        : "border-b border-[#f1f0ea]";

  const badge =
    payment.status === "paid" ? (
      <span className="shrink-0 rounded-full bg-sage-band px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.05em] text-olive-deep uppercase">{payment.label_due}</span>
    ) : payment.status === "overdue" ? (
      <span className="shrink-0 text-[11.5px] font-semibold text-rose-deep">{payment.label_due}</span>
    ) : payment.status === "due_soon" ? (
      <span className="shrink-0 rounded-full bg-[#f3edd8] px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.05em] text-[#7a6420] uppercase">{payment.label_due}</span>
    ) : (
      <span className="shrink-0 text-[11.5px] text-muted">{payment.label_due}</span>
    );

  if (!props.canEdit) {
    return (
      <div className={`flex items-center gap-3 px-1 py-2.5 ${rowTone}`}>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{payment.label}</span>
        <span className="shrink-0 text-[13px] font-medium text-ink tabular-nums">{formatMoney(payment.amount_cents)}</span>
        {badge}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 px-1 py-2.5 ${rowTone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <BlurInput
          value={payment.label}
          disabled={props.pending}
          ariaLabel={`Name of the ${formatMoney(payment.amount_cents)} payment`}
          placeholder="Deposit"
          className="min-w-0 flex-1 basis-[130px]"
          onCommit={(next) => props.onPatch({ label: next })}
        />
        <BlurInput
          value={centsToInputValue(payment.amount_cents)}
          disabled={props.pending}
          ariaLabel={`Amount of ${payment.label}`}
          placeholder="0"
          inputMode="decimal"
          className="w-[92px] shrink-0 text-right tabular-nums"
          onCommit={(next) => props.onPatch({ amountRaw: next })}
        />
        <input
          type="date"
          value={payment.due_date ?? ""}
          disabled={props.pending}
          aria-label={`Due date for ${payment.label}`}
          onChange={(event) => props.onPatch({ dueDate: event.target.value === "" ? null : event.target.value })}
          className="w-[136px] shrink-0 rounded-md border border-[#dddbd0] bg-white px-2 py-1.5 text-[12.5px] text-[#4a5147] outline-none focus:border-olive"
        />
        <button
          type="button"
          disabled={props.pending}
          aria-pressed={payment.paid}
          onClick={() => props.onSetPaid(!payment.paid)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-colors duration-200 motion-reduce:transition-none ${payment.paid ? "border-olive bg-sage-band text-olive-deep" : "border-[#dddbd0] bg-white text-[#6b7167] hover:border-olive hover:text-olive-deep"}`}
        >
          {payment.paid ? "Paid" : "Mark paid"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {badge}
        {payment.paid && (
          <label className="flex items-center gap-1.5 text-[11.5px] text-[#6b7167]">
            <span>Paid on</span>
            <input
              type="date"
              value={payment.paid_on ?? props.todayAtVenue}
              disabled={props.pending}
              aria-label={`Date ${payment.label} was paid`}
              onChange={(event) => props.onPatch({ paidOn: event.target.value === "" ? null : event.target.value })}
              className="rounded-md border border-[#dddbd0] bg-white px-2 py-1 text-[12px] text-[#4a5147] outline-none focus:border-olive"
            />
          </label>
        )}
        {/* A pasted Drive or Dropbox link, not an upload — there is no storage
            integration in this app and a receipt is a link the couple already
            has. Disabled until the detail read lands, so an empty box cannot
            overwrite a link that is already stored. */}
        <BlurInput
          value={props.receiptUrl ?? ""}
          disabled={props.pending || props.receiptUrl === undefined}
          ariaLabel={`Receipt link for ${payment.label}`}
          placeholder="Paste a receipt link"
          className="min-w-0 flex-1 basis-[180px]"
          onCommit={(next) => props.onPatch({ receiptUrl: next.trim() === "" ? null : next.trim() })}
        />
        {props.receiptUrl && (
          <a href={props.receiptUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-olive underline hover:text-rose">
            Open receipt
          </a>
        )}
        <span className="ml-auto shrink-0">
          <ConfirmButton label="Remove" confirmLabel="Remove this payment?" action={props.onRemove} />
        </span>
      </div>
    </div>
  );
}

/**
 * A text input that reports on blur or Enter and reverts on Escape.
 *
 * The same commit contract as `MoneyCell`, for the fields that are not money.
 * Kept local to this file rather than exported: the payment row is the only
 * place in the budget that edits free text inline, and a shared "editable text"
 * abstraction with one caller is a layer, not a saving.
 */
function BlurInput(props: {
  value: string;
  disabled: boolean;
  ariaLabel: string;
  placeholder?: string;
  inputMode?: "text" | "decimal";
  className?: string;
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
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      inputMode={props.inputMode ?? "text"}
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
      className={`rounded-md border border-[#dddbd0] bg-white px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-olive ${props.className ?? ""}`}
    />
  );
}
