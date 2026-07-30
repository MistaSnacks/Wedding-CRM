"use client";

/**
 * The one line under the H1 that says whether the last change stuck.
 *
 * A budget page saves on blur, dozens of times an hour, and there is no submit
 * button to watch. So the confirmation has to be ambient: one line that replaces
 * itself, never a stack, never a toast that has already faded by the time she
 * looks up from the keyboard.
 *
 * Two elements, not one with a swapped attribute. A polite `role="status"` is
 * for the ordinary "saved" traffic, which a screen reader should mention when it
 * gets a turn; a failure is `role="alert"` and interrupts, because the number on
 * screen is now a number the database does not have. React reuses a DOM node
 * when only its attributes change, and several screen readers latch the role at
 * first paint — rendering them as two separate branches guarantees the assertive
 * one is announced.
 *
 * This module also owns the small plumbing types the whole budget table shares,
 * so that a leaf like `PaymentRow` can accept a `commit` without importing from
 * `BudgetTable.tsx` and closing an import cycle.
 */

/**
 * What a budget server action returns.
 *
 * Declared structurally rather than imported from the actions file on purpose:
 * every action in this app returns `{ ok, message? }`, and depending on the
 * *shape* instead of the *name* means the table keeps compiling if the actions
 * module calls its alias something else, or adds fields to it.
 */
export type ActionOutcome = {
  ok: boolean;
  message?: string;
  /** The form-shaped actions report per-field instead; the first one becomes the line. */
  fieldErrors?: Record<string, string>;
};

/** The one sentence to show for a refused write, wherever the action put it. */
export function outcomeMessage(outcome: ActionOutcome, fallback: string): string {
  if (outcome.message !== undefined) return outcome.message;
  const first = Object.values(outcome.fieldErrors ?? {})[0];
  return first ?? fallback;
}

/** One optimistic write: what to try, what to say, and how to undo it. */
export type CommitStep = {
  attempt: () => Promise<ActionOutcome>;
  /** What changed, as a noun phrase: `Venue Rental contract $15,370`. */
  subject: string;
  /** The sentence to show when the server declines without one of its own. */
  failed: string;
  /** Applied immediately, before the request. */
  optimistic?: () => void;
  /** Undoes `optimistic` when the write is refused or the connection drops. */
  rollback?: () => void;
  /** Runs only on a confirmed success — the cell's olive flash hangs off this. */
  onSaved?: () => void;
};

export type Commit = (step: CommitStep) => void;

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

/**
 * Anchored to the viewport, not to the top of the page.
 *
 * In normal flow this line sat above a ledger that is its own 720px scroll box
 * inside a page that also scrolls. Working anywhere below the fold — the
 * ordinary case with 79 rows — put the cell's blush highlight on screen and the
 * sentence explaining it at `top: -1`, so a rejected amount showed a pink box
 * and no reason. On a phone it was worse: the item drawer is `inset-0` at
 * `z-50` and the drawer is the only way to edit anything there, so every
 * confirmation *and* every failure was painted behind it.
 *
 * `z-[60]` clears the drawer. It is not a toast — it never fades on a timer and
 * never stacks; it is still one line that replaces itself, just one that stays
 * where she can see it.
 */
export function SaveStatus(props: { state: SaveState }) {
  const { state } = props;
  if (state.kind === "idle") return <span role="status" aria-live="polite" className="sr-only" />;

  const shell = "fixed bottom-5 left-1/2 z-[60] max-w-[min(92vw,32rem)] -translate-x-1/2 rounded-lg px-3.5 py-2.5 text-[12.5px] shadow-[0_8px_24px_rgba(28,35,27,0.14)]";

  if (state.kind === "error") {
    return (
      <p role="alert" className={`${shell} border border-blush-border bg-blush text-rose-deep`}>
        {state.message}
      </p>
    );
  }

  return (
    <p role="status" aria-live="polite" className={`${shell} border border-hairline bg-white text-[#4a5147]`}>
      {state.message}
    </p>
  );
}
