"use client";

import { useRef, useState } from "react";
import { formatMoney } from "@/lib/format/money";
import type { ItemRollup } from "@/lib/data/budget-rules";
import { DepositSplit } from "./DepositSplit";
import { PaymentRow } from "./PaymentRow";

/** What the next installment is usually called, by how many there already are. */
const NEXT_LABEL = ["Deposit", "Second payment", "Final balance"];

/**
 * When the money for this line actually leaves, and whether it has.
 *
 * The blank row at the bottom is always there for the same reason the new-line
 * row is: adding an installment should cost a name, an amount and a return, not
 * a button that opens a form. Its label placeholder walks "Deposit" → "Second
 * payment" → "Final balance", which is the shape of nearly every wedding
 * contract, so most of the time the suggestion is simply right.
 *
 * The deposit split appears only on a line with no payments at all — see
 * `DepositSplit`. Afterwards this list is the schedule, and there is exactly one
 * place to add to it.
 */
export function PaymentSchedule(props: {
  rollup: ItemRollup;
  canEdit: boolean;
  pending: boolean;
  todayAtVenue: string;
  defaultBalanceDue: string | null;
  /** Receipt links by payment id, once the drawer's detail read has landed. */
  receiptUrls: Record<string, string | null> | null;
  onAdd: (values: { label: string; amount: string; dueDate: string | null }) => void;
  onSplit: (values: { total: string; deposit: string; depositDue: string | null; balanceDue: string | null }) => void;
  onSetPaid: (paymentId: string, paid: boolean) => void;
  onPatch: (
    paymentId: string,
    patch: { label?: string; amountRaw?: string; dueDate?: string | null; paidOn?: string | null; receiptUrl?: string | null },
  ) => void;
  onRemove: (paymentId: string) => Promise<void>;
}) {
  const { rollup } = props;
  const payments = rollup.payments;

  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const labelInput = useRef<HTMLInputElement | null>(null);

  const suggestion = NEXT_LABEL[Math.min(payments.length, NEXT_LABEL.length - 1)];

  function add() {
    if (amount.trim() === "") return;
    const values = {
      label: label.trim() === "" ? suggestion : label.trim(),
      amount,
      dueDate: due === "" ? null : due,
    };
    setLabel("");
    setAmount("");
    setDue("");
    props.onAdd(values);
    labelInput.current?.focus();
  }

  const scheduled = payments.reduce((sum, p) => sum + p.amount_cents, 0);
  const field = "rounded-md border border-[#dddbd0] bg-white px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-olive";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]">PAYMENT SCHEDULE</h3>
        <span className="text-[11.5px] text-muted tabular-nums">
          {`${formatMoney(rollup.paidCents)} paid of ${formatMoney(scheduled)} scheduled`}
        </span>
      </div>

      {props.canEdit && payments.length === 0 && (
        <DepositSplit
          defaultTotalCents={rollup.forecastStage === null ? null : rollup.forecastCents}
          todayAtVenue={props.todayAtVenue}
          defaultBalanceDue={props.defaultBalanceDue}
          pending={props.pending}
          onCreate={props.onSplit}
        />
      )}

      <div className="flex flex-col">
        {payments.map((payment) => (
          <PaymentRow
            key={payment.id}
            payment={payment}
            canEdit={props.canEdit}
            pending={props.pending}
            todayAtVenue={props.todayAtVenue}
            receiptUrl={props.receiptUrls === null ? undefined : props.receiptUrls[payment.id] ?? null}
            onSetPaid={(paid) => props.onSetPaid(payment.id, paid)}
            onPatch={(patch) => props.onPatch(payment.id, patch)}
            onRemove={() => props.onRemove(payment.id)}
          />
        ))}
        {payments.length === 0 && (
          <p className="px-1 py-3 text-[12.5px] text-muted">Nothing scheduled yet. Add the first payment below.</p>
        )}
      </div>

      {props.canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={labelInput}
            value={label}
            aria-label="Name of the new payment"
            placeholder={suggestion}
            onChange={(event) => setLabel(event.target.value)}
            className={`${field} min-w-0 flex-1 basis-[130px]`}
          />
          <input
            value={amount}
            inputMode="decimal"
            aria-label="Amount of the new payment"
            placeholder="Amount"
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            className={`${field} w-[92px] shrink-0 text-right tabular-nums`}
          />
          <input
            type="date"
            value={due}
            aria-label="Due date of the new payment"
            onChange={(event) => setDue(event.target.value)}
            className={`${field} w-[136px] shrink-0`}
          />
          <button
            type="button"
            onClick={add}
            disabled={props.pending || amount.trim() === ""}
            className="shrink-0 rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:opacity-40 disabled:hover:border-[#dddbd0] disabled:hover:text-ink motion-reduce:transition-none"
          >
            + Add
          </button>
        </div>
      )}

      {rollup.item.pending_guest_count && (
        <p className="text-[11.5px] leading-relaxed text-[#6b7167]">
          {"This total moves with the headcount, so the balance is a best guess for now."}
        </p>
      )}
    </section>
  );
}
