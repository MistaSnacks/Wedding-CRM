"use client";

import { useState, useTransition } from "react";
import { addFirstBudgetItem, createStarterCategories } from "@/app/admin/(dashboard)/budget/actions";

/**
 * First run: an empty budget, and three doors out of it.
 *
 * Not one of them fills in a number. The reason is the same one that keeps
 * `budget_total_cents` null: a figure the app invented is indistinguishable, a
 * month later, from a figure she decided, and by then it is anchoring every
 * other estimate on the page. Structure — category names, a blank line — is
 * safe to offer. Money is not.
 *
 * The primary door is the total, because that is the one question the rest of
 * the screen needs an answer to before it can say anything useful.
 */
export type BudgetEmptyStateProps = {
  canEdit: boolean;
  /** True when categories exist but nothing is priced — the middle door is then pointless. */
  hasCategories: boolean;
};

export function BudgetEmptyState({ canEdit, hasCategories }: BudgetEmptyStateProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Something went wrong. Nothing was changed.");
    });
  };

  return (
    <section className="rounded-2xl border border-hairline bg-white/60 p-6 sm:p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9aa38f]">
        THE BUDGET
      </p>
      <h2 className="font-display mt-2 max-w-[22ch] text-[32px] font-medium leading-[1.15] text-olive-deep sm:text-[38px]">
        {"Let’s find out what this wedding costs"}
      </h2>
      <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-[#4a5147]">
        {"Nothing has been priced yet. Tell us what you can spend and we’ll suggest a way to split it, or start adding lines and the totals will build themselves as you go."}
      </p>

      {canEdit && (
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a
            href="#budget-setup"
            className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
          >
            {"Set a total and we’ll suggest a split"}
          </a>
          {!hasCategories && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(createStarterCategories)}
              className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose disabled:opacity-60"
            >
              Add the usual categories
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(addFirstBudgetItem)}
            className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose disabled:opacity-60"
          >
            Just add a line
          </button>
        </div>
      )}

      <p className="mt-4 text-[12px] text-muted">
        {"Adding the categories creates the names only — no targets, no estimates, nothing you didn’t choose."}
      </p>

      {error !== null && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep"
        >
          {error}
        </p>
      )}
    </section>
  );
}
