"use client";

import { useActionState, useMemo, useState } from "react";
import { centsToInputValue, formatMoney, tryParseMoney } from "@/lib/format/money";
import { DEFAULT_ALLOCATION } from "@/lib/data/budget-rules";
import {
  seedTargets,
  setBudgetTotal,
  type BudgetFormState,
} from "@/app/admin/(dashboard)/budget/actions";

/**
 * "What can you spend, all in?" — and then a starting split she can argue with.
 *
 * `weddings.budget_total_cents` is deliberately null until this form is used.
 * The couple never stated a ceiling, and **inventing one is the single thing
 * this screen must not do**: every commercial budget tool seeds from a national
 * average, planners publicly rubbish those averages as fantasy, and a number
 * the app made up is a number she is then measured against for a year. So the
 * value starts empty, the helper text names where the suggestion comes from,
 * and the word "suggestion" is on screen.
 *
 * The percentages here are a *proposal*. Nothing they compute is written:
 * the form posts the percentages, and `allocateByPercent` on the server does
 * the apportionment (largest remainder, so the targets sum to the total
 * exactly) and enforces the mandatory contingency. Client arithmetic that ends
 * up in the database is client arithmetic nobody can test.
 *
 * Two deliberate departures from the drafted spec, both to avoid writing a bug
 * into data this component cannot fix:
 *
 * - **Category names are text, not inputs.** `seedAllocation` matches existing
 *   categories by name; renaming one here would create a second category and
 *   leave the original holding its old target, double-counting the allocation.
 *   Renaming belongs where the categories live.
 * - **No remove button.** A removed row is simply absent from the plan, which
 *   leaves its stored target untouched rather than cleared — the opposite of
 *   what removing it looks like. A row set to 0% says "nothing set aside here",
 *   which is a claim the page can render honestly.
 */
export type SetupCategory = {
  id: string;
  name: string;
  /** The reference wedding's actual for this category, for the row's caption. */
  benchmarkCents: number;
  targetCents: number | null;
  isContingency: boolean;
};

export type BudgetSetupProps = {
  totalCents: number | null;
  benchmarkLabel: string;
  benchmarkTotalCents: number;
  categories: SetupCategory[];
  canEdit: boolean;
};

type Row = {
  key: string;
  name: string;
  pct: number;
  isContingency: boolean;
  benchmarkCents: number;
};

/** Contingency never drops below this. Every wedding finds a surprise. */
const CONTINGENCY_FLOOR = 5;
const CONTINGENCY_SEED = 8;

/** The largest non-contingency row, which absorbs every rounding adjustment. */
function largestOther(rows: Row[]): Row | null {
  return rows
    .filter((r) => !r.isContingency)
    .reduce<Row | null>((best, r) => (best === null || r.pct > best.pct ? r : best), null);
}

/**
 * The percentages this form opens on.
 *
 * Three sources, in order of how much they know about this particular wedding:
 *
 * 1. **Her own targets**, when any are set. "Adjust targets" must open on the
 *    numbers she chose, not on a suggestion that would quietly zero the two
 *    categories the reference wedding happens to have no figure for.
 * 2. **The reference wedding's real shares**, on a first run. Grounded in one
 *    wedding's receipts rather than an industry table — that grounding is the
 *    entire point of the benchmark column, and abandoning it here to seed from
 *    a national average would be the exact failure this build exists to beat.
 * 3. **The rule module's default plan**, when there is nothing at all to go on.
 *
 * Nothing invents a figure: every branch redistributes something that already
 * exists, and the result is a suggestion she edits before anything is written.
 */
function seedRows(categories: SetupCategory[]): Row[] {
  if (categories.length === 0) {
    return DEFAULT_ALLOCATION.map((slice) => ({
      key: slice.name,
      name: slice.name,
      pct: Math.round(slice.pct * 100),
      isContingency: slice.isContingency === true,
      benchmarkCents: 0,
    }));
  }

  const withContingency: SetupCategory[] = categories.some((c) => c.isContingency)
    ? categories
    : [
        ...categories,
        {
          id: "new-contingency",
          name: "Contingency",
          benchmarkCents: 0,
          targetCents: null,
          isContingency: true,
        },
      ];

  const targetTotal = withContingency.reduce((sum, c) => sum + (c.targetCents ?? 0), 0);
  const rest = withContingency.filter((c) => !c.isContingency);
  const benchmarkTotal = rest.reduce((sum, c) => sum + c.benchmarkCents, 0);
  const share = 100 - CONTINGENCY_SEED;

  const rows: Row[] = withContingency.map((c) => ({
    key: c.id,
    name: c.name,
    isContingency: c.isContingency,
    benchmarkCents: c.benchmarkCents,
    pct:
      targetTotal > 0
        ? Math.round(((c.targetCents ?? 0) / targetTotal) * 100)
        : c.isContingency
          ? CONTINGENCY_SEED
          : benchmarkTotal > 0
            ? Math.round((c.benchmarkCents / benchmarkTotal) * share)
            : Math.round(share / Math.max(1, rest.length)),
  }));

  // An allocation with no buffer in it is the one thing this form will not
  // open on, so the floor is carved out of the largest category — visibly, on
  // screen, before she saves anything.
  const contingency = rows.find((r) => r.isContingency);
  if (contingency && contingency.pct < CONTINGENCY_FLOOR) {
    const donor = largestOther(rows);
    const owed = CONTINGENCY_FLOOR - contingency.pct;
    if (donor) donor.pct = Math.max(0, donor.pct - owed);
    contingency.pct = CONTINGENCY_FLOOR;
  }

  // Rounding leaves a point or two on the floor; the largest non-contingency
  // row absorbs it so the form opens on exactly 100 rather than on an error.
  const sum = rows.reduce((total, r) => total + r.pct, 0);
  if (sum !== 100) {
    const donor = largestOther(rows);
    if (donor) donor.pct = Math.max(0, donor.pct + (100 - sum));
  }
  return rows;
}

export function BudgetSetup({
  totalCents,
  benchmarkLabel,
  benchmarkTotalCents,
  categories,
  canEdit,
}: BudgetSetupProps) {
  const seeded = useMemo(() => seedRows(categories), [categories]);

  const [open, setOpen] = useState(totalCents === null);
  const [step, setStep] = useState<1 | 2>(1);
  const [totalDraft, setTotalDraft] = useState(centsToInputValue(totalCents));
  const [rows, setRows] = useState<Row[]>(seeded);
  const [floorNote, setFloorNote] = useState(false);

  const [totalState, saveTotal, totalPending] = useActionState<BudgetFormState, FormData>(
    setBudgetTotal,
    { ok: true },
  );
  const [seedState, saveSeed, seedPending] = useActionState<BudgetFormState, FormData>(
    seedTargets,
    { ok: true },
  );

  const parsedTotal = tryParseMoney(totalDraft);
  const totalValueCents = parsedTotal.ok ? parsedTotal.cents : null;
  const sum = rows.reduce((total, r) => total + r.pct, 0);
  const contingency = rows.find((r) => r.isContingency) ?? null;

  const centsFor = (pct: number) =>
    totalValueCents === null ? null : Math.round((totalValueCents * pct) / 100);

  const setPct = (key: string, next: number) => {
    const row = rows.find((r) => r.key === key);
    const clamped = row?.isContingency
      ? Math.max(CONTINGENCY_FLOOR, Math.min(100, next))
      : Math.max(0, Math.min(100, next));
    if (row?.isContingency && next < CONTINGENCY_FLOOR) setFloorNote(true);
    setRows((current) => current.map((r) => (r.key === key ? { ...r, pct: clamped } : r)));
  };

  const nudgeContingency = (delta: number) => {
    if (!contingency) return;
    setPct(contingency.key, contingency.pct + delta);
  };

  const slices = JSON.stringify(
    rows.map((r) => ({ name: r.name, pct: r.pct, isContingency: r.isContingency })),
  );

  if (!canEdit) return null;

  const heading = totalCents === null ? "What can you spend, all in?" : "Adjust your targets";
  const helper =
    benchmarkTotalCents > 0
      ? `${benchmarkLabel} came to ${formatMoney(benchmarkTotalCents)} all in. You can change this whenever you like.`
      : "You can change this whenever you like.";

  return (
    <section id="budget-setup" className="rounded-xl border border-hairline p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[24px] font-medium leading-[1.15] text-olive-deep">
            {heading}
          </h2>
          {totalCents !== null && !open && (
            <p className="mt-1 text-[12.5px] text-muted">
              {`Your total is ${formatMoney(totalCents)}. Change it, or change how it’s split.`}
            </p>
          )}
        </div>
        {totalCents !== null && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose"
          >
            {open ? "Close" : "Adjust targets"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-5">
          {/* Step 1 — the total. One number, one large field. */}
          <div className="flex flex-col gap-2">
            <label htmlFor="budget-total" className="text-[13px] font-medium text-ink">
              Your total budget
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-baseline rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2 focus-within:border-olive">
                <span className="text-[20px] font-medium text-muted">$</span>
                <input
                  id="budget-total"
                  inputMode="decimal"
                  value={totalDraft}
                  onChange={(event) => setTotalDraft(event.target.value)}
                  placeholder="60,000"
                  className="w-40 bg-transparent px-2 text-right text-[28px] font-semibold tabular-nums text-ink outline-none"
                />
              </span>
              {step === 1 ? (
                <button
                  type="button"
                  disabled={totalValueCents === null}
                  onClick={() => setStep(2)}
                  className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-olive-deep disabled:hover:shadow-none motion-reduce:transition-none"
                >
                  Continue
                </button>
              ) : null}
              <form action={saveTotal}>
                <input type="hidden" name="total" value={totalDraft} />
                <button
                  type="submit"
                  disabled={totalPending}
                  className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose disabled:opacity-60"
                >
                  Save the total only
                </button>
              </form>
            </div>
            <p className="text-[12.5px] text-muted">{helper}</p>
            {!parsedTotal.ok && (
              <p
                role="alert"
                className="rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep"
              >
                {parsedTotal.message}
              </p>
            )}
            {totalState.fieldErrors?.total || totalState.fieldErrors?.form ? (
              <p
                role="alert"
                className="rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep"
              >
                {totalState.fieldErrors.total ?? totalState.fieldErrors.form}
              </p>
            ) : null}
          </div>

          {/* Step 2 — the split. Every row editable, nothing locked but the buffer. */}
          {step === 2 && (
            <form action={saveSeed} className="flex flex-col gap-3 border-t border-hairline pt-5">
              <input type="hidden" name="total" value={totalDraft} />
              <input type="hidden" name="slices" value={slices} />

              <div>
                <h3 className="text-[14.5px] font-semibold text-ink">{"Here’s a starting split"}</h3>
                <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-[#4a5147]">
                  {benchmarkTotalCents > 0
                    ? `These percentages are what ${benchmarkLabel} actually spent in each category, scaled to your total. Change any of them — nothing is locked except a little kept aside for surprises.`
                    : "This is a starting suggestion, not advice. Change any of them — nothing is locked except a little kept aside for surprises."}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                {rows.map((row) => (
                  <div key={row.key} className="flex flex-wrap items-center gap-3">
                    <span className="w-44 shrink-0 truncate text-[13px] font-medium text-ink">
                      {row.name}
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={row.isContingency ? CONTINGENCY_FLOOR : 0}
                        max={100}
                        step={1}
                        value={row.pct}
                        aria-label={`${row.name} share of the budget, in percent`}
                        onChange={(event) => setPct(row.key, Math.round(Number(event.target.value)))}
                        className="w-16 rounded-md border border-[#dddbd0] bg-white px-2 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-olive"
                      />
                      <span className="text-[12.5px] text-muted">%</span>
                    </span>
                    <span className="w-28 text-right text-[13.5px] font-semibold tabular-nums text-ink">
                      {centsFor(row.pct) === null ? "—" : formatMoney(centsFor(row.pct))}
                    </span>
                    <span className="flex-1 text-[12px] text-muted">
                      {row.isContingency
                        ? "Kept aside for surprises"
                        : row.benchmarkCents > 0
                          ? `${benchmarkLabel}: ${formatMoney(row.benchmarkCents)}`
                          : ""}
                    </span>
                  </div>
                ))}
              </div>

              {floorNote && (
                <p className="text-[12.5px] text-rose-deep">
                  {"Every wedding finds a surprise. We keep at least 5% aside."}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {sum === 100 ? (
                  <p className="text-[12.5px] font-medium text-olive-deep">
                    {`That’s all 100% — ${totalValueCents === null ? "your total" : formatMoney(totalValueCents)} accounted for.`}
                  </p>
                ) : sum < 100 ? (
                  <>
                    <p className="text-[12.5px] text-[#6b7167]">
                      {`${100 - sum}% left to allocate${totalValueCents === null ? "" : ` (${formatMoney(centsFor(100 - sum) ?? 0)})`}.`}
                    </p>
                    <button
                      type="button"
                      onClick={() => nudgeContingency(100 - sum)}
                      className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose"
                    >
                      Put the rest in contingency
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[12.5px] text-rose-deep">
                      {`You’re ${sum - 100}% over${totalValueCents === null ? "" : ` (${formatMoney(centsFor(sum - 100) ?? 0)} more than your total)`}.`}
                    </p>
                    <button
                      type="button"
                      disabled={
                        contingency === null || contingency.pct - (sum - 100) < CONTINGENCY_FLOOR
                      }
                      onClick={() => nudgeContingency(-(sum - 100))}
                      title={
                        contingency !== null && contingency.pct - (sum - 100) < CONTINGENCY_FLOOR
                          ? "Contingency can’t absorb that much. Trim a category instead."
                          : undefined
                      }
                      className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Trim it from contingency
                    </button>
                  </>
                )}
              </div>

              {seedState.fieldErrors?.form || seedState.fieldErrors?.total ? (
                <p
                  role="alert"
                  className="rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep"
                >
                  {seedState.fieldErrors.form ?? seedState.fieldErrors.total}
                </p>
              ) : null}

              <div>
                <button
                  type="submit"
                  disabled={sum !== 100 || totalValueCents === null || seedPending}
                  className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-olive-deep disabled:hover:shadow-none motion-reduce:transition-none"
                >
                  Save these targets
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
