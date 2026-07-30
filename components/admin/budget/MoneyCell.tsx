"use client";

import { useEffect, useRef, useState } from "react";
import { centsToInputValue, formatMoney } from "@/lib/format/money";

/**
 * The four `budget_items` columns a money cell can write, named as the database
 * names them so the string travels from the input to the action to the `update`
 * without a translation table anyone has to keep in sync.
 */
export type CostField =
  | "benchmark_cents"
  | "estimated_cents"
  | "quoted_cents"
  | "contracted_cents";

/** Per-cell save state, held by the table and handed down. */
export type CellFlags = { pending: boolean; justSaved: boolean; errored: boolean };

/** The column headings, in the couple's words rather than the schema's. */
export const COST_FIELD_LABEL: Record<CostField, string> = {
  benchmark_cents: "Reference",
  estimated_cents: "Estimate",
  quoted_cents: "Quote",
  contracted_cents: "Contract",
};

/**
 * A money figure that is also the input that changes it.
 *
 * She came here from a spreadsheet, where a number is edited where it is read.
 * So the cell is *always* a real `<input>`, styled to look like text until it is
 * focused — never a span that swaps to an input on click. That single decision
 * is what makes `Tab` walk across a row and down into the next one with no focus
 * management, no arrow-key grid, and no `tabIndex` anywhere: the browser's own
 * tab order already describes the table.
 *
 * A read-only viewer gets a `<span>`, not a disabled input. A disabled box looks
 * like something broken; plain text looks like a page you are allowed to read.
 *
 * **Commit on blur or Enter, never on keystroke.** Typing `1500` through a
 * per-keystroke save would write `1`, then `15`, then `150` — three wrong
 * numbers in the couple's ledger and three rows in the activity log. Escape
 * reverts to the last committed value and deliberately does not reach the
 * server.
 *
 * The draft resyncs from props whenever the cell is not focused, which is how an
 * optimistic value, a rollback, and a fresh server render all land in the box
 * without fighting whatever is being typed into it.
 */
export function MoneyCell(props: {
  cents: number | null;
  /** Names the row in the input's accessible label — "Estimate for Venue Rental". */
  itemName: string;
  /** Names the column in the same label, and in the `Saved · …` line. */
  fieldLabel: string;
  canEdit: boolean;
  /** The committed number gets weight; the guesses do not. */
  emphasis?: boolean;
  pending: boolean;
  justSaved: boolean;
  errored: boolean;
  /** Raw text, exactly as typed — parsing belongs to `lib/format/money.ts`. */
  onCommit: (raw: string) => void;
  /** Clears a stale error the moment she starts fixing it. */
  onFocus?: () => void;
}) {
  const committed = centsToInputValue(props.cents);
  const [draft, setDraft] = useState(committed);
  const [focused, setFocused] = useState(false);
  // Set by Escape so the blur it triggers does not also save the reverted value.
  const skipCommit = useRef(false);

  // Never while focused, and never while errored. The second guard is what lets
  // "banana" stay in the box after a failed parse: the text she typed is the
  // only record of what she meant, and replacing it with the old number would
  // hide the mistake instead of letting her fix it.
  useEffect(() => {
    if (!focused && !props.errored) setDraft(committed);
  }, [committed, focused, props.errored]);

  /**
   * Formatted at rest, bare while being typed in.
   *
   * A column where the lines read `15370` and their own subtotal reads `$15,370`
   * is a column that looks broken, so an idle cell shows `formatMoney`. The
   * moment it takes focus it swaps to the ungrouped digits, because that is what
   * `parseMoneyInput` reads back unchanged — leaving `$15,370` in the box would
   * make selecting-all and retyping the only safe way to edit it. Exactly the
   * behaviour of the spreadsheet she is coming from.
   *
   * `null` shows nothing rather than an em dash, so the `—` placeholder can do
   * its job in muted grey: a real `—` sitting in the value is indistinguishable
   * from a figure someone typed.
   */
  const display = focused || props.errored ? draft : props.cents === null ? "" : formatMoney(props.cents);

  if (!props.canEdit) {
    const tone = props.emphasis ? "font-semibold text-ink" : "text-[#4a5147]";
    return <span className={`block px-2 py-1.5 text-right text-[13px] tabular-nums ${tone}`}>{formatMoney(props.cents)}</span>;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipCommit.current = true;
      setDraft(committed);
      event.currentTarget.blur();
    }
  }

  function handleBlur() {
    setFocused(false);
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    // An untouched field must not re-save: `centsToInputValue` is the exact
    // inverse of what the parser reads back, so equal strings mean equal money
    // and there is nothing to send.
    if (draft.trim() === committed.trim()) return;
    props.onCommit(draft);
  }

  const state = props.errored
    ? "border-[#e5c8bf] bg-blush text-rose-deep"
    : props.justSaved
      ? "border-olive"
      : "border-transparent hover:border-[#dddbd0]";

  return (
    <input
      inputMode="decimal"
      value={display}
      disabled={props.pending}
      aria-label={`${props.fieldLabel} for ${props.itemName}`}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        setDraft(committed);
        setFocused(true);
        props.onFocus?.();
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="—"
      className={`w-full rounded-md border bg-transparent px-2 py-1.5 text-right text-[13px] tabular-nums outline-none transition-colors duration-200 motion-reduce:transition-none focus:border-olive focus:bg-white ${state} ${props.emphasis ? "font-semibold text-ink" : "text-[#4a5147]"} ${props.pending ? "opacity-60" : ""}`}
    />
  );
}
