import { formatMoney, formatMoneySigned } from "@/lib/format/money";
import type { CategoryRollup } from "@/lib/data/budget-rules";

/**
 * Where the money goes: one bar per category, three segments deep.
 *
 * Hand-built `<div>`s on a `#f0efe3` track, the same track the meal bars use.
 * There is no chart library in this project and there is not going to be one —
 * a bar is a box with a width, and a dependency that renders one costs more to
 * keep than it saves.
 *
 * The three segments say something a single "spent so far" bar cannot: how much
 * of a category is **paid**, how much is **signed but not yet paid**, and how
 * much is still only somebody's estimate. The last of those is the number that
 * moves, and seeing how much of a category is made of it is the difference
 * between a forecast and a wish.
 *
 * Every row shares one scale, so the bars are comparable across categories
 * rather than each being a percentage of itself.
 */
export type CategoryBarsProps = {
  categories: CategoryRollup[];
  benchmarkLabel: string;
};

/** Percent of the shared scale, never outside `[0, 100]`. */
function pctOf(cents: number, scaleMax: number): number {
  if (scaleMax <= 0) return 0;
  return Math.max(0, Math.min(100, (cents / scaleMax) * 100));
}

export function CategoryBars({ categories, benchmarkLabel }: CategoryBarsProps) {
  if (categories.length === 0) return null;

  const scaleMax = categories.reduce(
    (max, c) => Math.max(max, c.forecastCents, c.category.target_cents ?? 0),
    0,
  );

  return (
    <section className="rounded-xl border border-hairline p-5">
      <h2 className="text-[14.5px] font-semibold text-ink">Where the money goes</h2>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-olive-deep" />
          Paid
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-olive" />
          {"Contracted, not yet paid"}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#c9cdbf]" />
          {"Still an estimate"}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-[2px] bg-rose" />
          Target
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {categories.map((c) => {
          const target = c.category.target_cents;
          const paidPct = pctOf(c.paidCents, scaleMax);
          const committedPct = pctOf(Math.max(0, c.contractedCents - c.paidCents), scaleMax);
          const estimatedPct = pctOf(
            Math.max(0, c.forecastCents - Math.max(c.contractedCents, c.paidCents)),
            scaleMax,
          );
          // A runaway category must not paint past the end of its own track.
          const capped = Math.min(100, paidPct + committedPct + estimatedPct);
          const estimatedDrawn = Math.max(0, capped - paidPct - committedPct);
          const overTarget = target !== null && c.forecastCents > target;

          return (
            <div key={c.category.id} className="flex items-center gap-3 max-md:flex-wrap">
              <span className="w-40 shrink-0 truncate text-[13px] font-medium text-ink max-md:w-full">
                {c.category.name}
              </span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#f0efe3] max-md:order-3 max-md:w-full max-md:flex-none">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-olive-deep"
                  style={{ width: `${paidPct}%` }}
                />
                <span
                  className="absolute inset-y-0 rounded-full bg-olive"
                  style={{ left: `${paidPct}%`, width: `${committedPct}%` }}
                />
                <span
                  className="absolute inset-y-0 rounded-full bg-[#c9cdbf]"
                  style={{ left: `${paidPct + committedPct}%`, width: `${estimatedDrawn}%` }}
                />
                {target !== null && (
                  <span
                    aria-hidden
                    className="absolute inset-y-[-3px] w-[2px] bg-rose"
                    style={{ left: `${pctOf(target, scaleMax)}%` }}
                  />
                )}
              </span>
              <span className="flex w-[188px] shrink-0 flex-col items-end gap-0.5 max-md:w-auto max-md:flex-1">
                <span
                  className={`text-[12.5px] tabular-nums ${overTarget ? "text-rose" : "text-[#4a5147]"}`}
                >
                  {formatMoney(c.forecastCents)}
                  {target === null ? "" : ` of ${formatMoney(target)}`}
                </span>
                <span className="text-[11.5px] tabular-nums">
                  {c.benchmark.deltaCents === null ? (
                    <span className="text-muted">{`${benchmarkLabel} — no figure`}</span>
                  ) : c.benchmark.deltaCents === 0 ? (
                    <span className="text-muted">{`Even with ${benchmarkLabel}`}</span>
                  ) : (
                    <span
                      className={
                        c.benchmark.direction === "over"
                          ? "font-medium text-rose"
                          : "font-medium text-olive-deep"
                      }
                    >
                      {`${formatMoneySigned(c.benchmark.deltaCents)} vs ${benchmarkLabel}`}
                    </span>
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
        {`The second figure on the right compares this category with ${benchmarkLabel}. It’s a reference point from a real wedding, not a target.`}
      </p>
    </section>
  );
}
