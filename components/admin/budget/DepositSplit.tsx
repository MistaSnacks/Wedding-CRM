"use client";

import { useState } from "react";
import { centsToInputValue, formatMoney, tryParseMoney } from "@/lib/format/money";
import { splitDeposit } from "@/lib/data/budget-rules";

/**
 * "It's ten thousand, two down and the rest a month before." Two numbers in,
 * two payments out.
 *
 * **The app does the subtraction, always.** Making someone work out the balance
 * on a vendor's invoice and type it back in is exactly the arithmetic that sends
 * a couple back to the spreadsheet — and it is where the spreadsheet's errors
 * came from. So the balance is a read-back line and not an input: there is no
 * field to get wrong, and no way for deposit plus balance to fail to equal the
 * total.
 *
 * Shown only when a line has no payments yet. Once there is a schedule, the way
 * to add to it is the row at the bottom of it, not a second affordance that
 * would need to explain how it interacts with what is already there.
 */
export function DepositSplit(props: {
  defaultTotalCents: number | null;
  /** Today at the venue, `YYYY-MM-DD` — the honest default for a deposit paid now. */
  todayAtVenue: string;
  /** A month before the wedding. A balance with no due date is one nothing chases. */
  defaultBalanceDue: string | null;
  pending: boolean;
  onCreate: (values: { total: string; deposit: string; depositDue: string | null; balanceDue: string | null }) => void;
}) {
  const [total, setTotal] = useState(() => centsToInputValue(props.defaultTotalCents));
  const [deposit, setDeposit] = useState("");
  const [depositDue, setDepositDue] = useState(props.todayAtVenue);
  const [balanceDue, setBalanceDue] = useState(props.defaultBalanceDue ?? "");

  const totalParse = tryParseMoney(total);
  const depositParse = tryParseMoney(deposit);
  const totalCents = totalParse.ok ? totalParse.cents : null;
  const depositCents = depositParse.ok ? depositParse.cents : null;

  const wholeThing = totalCents !== null && depositCents !== null && depositCents >= totalCents;
  const split = totalCents !== null && depositCents !== null ? splitDeposit(totalCents, depositCents) : null;

  const readBack = !totalParse.ok
    ? totalParse.message
    : !depositParse.ok
      ? depositParse.message
      : wholeThing
        ? "That's the whole thing — add it as a single payment instead."
        : split !== null && split.ok
          ? `Deposit ${formatMoney(split.deposit)} now, balance ${formatMoney(split.balance)} later.`
          : split !== null
            ? split.message
            : "Type a total and a deposit and we'll work out the balance.";

  const ready = split !== null && split.ok && !wholeThing && !props.pending;

  function create() {
    if (!ready) return;
    props.onCreate({
      total,
      deposit,
      depositDue: depositDue === "" ? null : depositDue,
      balanceDue: balanceDue === "" ? null : balanceDue,
    });
  }

  const field = "w-full rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13.5px] text-ink outline-none focus:border-olive";

  return (
    <div className="rounded-xl border border-hairline bg-paper p-4">
      <h4 className="text-[13px] font-semibold text-ink">Split it into a deposit and a balance</h4>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]">TOTAL</span>
          <input value={total} inputMode="decimal" onChange={(event) => setTotal(event.target.value)} className={`${field} text-right tabular-nums`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]">DEPOSIT</span>
          <input value={deposit} inputMode="decimal" onChange={(event) => setDeposit(event.target.value)} className={`${field} text-right tabular-nums`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]">DEPOSIT DUE</span>
          <input type="date" value={depositDue} onChange={(event) => setDepositDue(event.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]">BALANCE DUE</span>
          <input type="date" value={balanceDue} onChange={(event) => setBalanceDue(event.target.value)} className={field} />
        </label>
      </div>

      <p className={`mt-3 text-[13px] ${wholeThing || !totalParse.ok || !depositParse.ok ? "text-rose-deep" : "text-[#4a5147]"}`}>{readBack}</p>

      <button
        type="button"
        disabled={!ready}
        onClick={create}
        className="mt-3 rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-olive-deep disabled:hover:shadow-none motion-reduce:transition-none"
      >
        Create both payments
      </button>
    </div>
  );
}
