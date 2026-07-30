"use client";

import { formatDelta, formatMoneySigned } from "@/lib/format/money";
import type { BenchmarkDelta } from "@/lib/data/budget-rules";

/**
 * How this line compares to the reference wedding, in one glance.
 *
 * The colour is a *direction*, not a verdict. Rose is "more than they spent",
 * olive is "less" — and spending more on the photographer than a friend did is
 * a choice, not a mistake. The legend under the table says so in words, because
 * a colour alone will be read as a grade by anyone who has ever seen a
 * spreadsheet with conditional formatting.
 *
 * Three things carry the meaning, so no single one has to carry it alone:
 * the sign (`formatMoneySigned` always writes the `+`), the colour, and a
 * `title` holding the full sentence with the benchmark's real name in it. That
 * name is data — `weddings.budget_benchmark_label` — and never a constant here.
 *
 * `direction: "unknown"` is the case that matters most. It means one side has no
 * number, and it renders as an em dash rather than as a saving. Treating an
 * unpriced line as `$0` would report it as 100% under the benchmark, which is
 * the single most misleading thing this column could say.
 */
export function DeltaCell(props: { delta: BenchmarkDelta; benchmarkLabel: string }) {
  const { delta, benchmarkLabel } = props;

  if (delta.direction === "unknown" || delta.deltaCents === null) {
    return (
      <span className="text-[12.5px] text-muted" title={`Not priced against ${benchmarkLabel} yet`}>
        —
      </span>
    );
  }

  if (delta.direction === "even") {
    return (
      <span className="text-[12.5px] text-muted" title={`The same as ${benchmarkLabel}`}>
        even
      </span>
    );
  }

  const sentence = formatDelta(delta.benchmarkCents, delta.actualCents, benchmarkLabel).text;
  const tone = delta.direction === "over" ? "text-rose" : "text-olive-deep";

  return (
    <span className={`text-[12.5px] font-medium ${tone}`} title={sentence}>
      {formatMoneySigned(delta.deltaCents)}
    </span>
  );
}
