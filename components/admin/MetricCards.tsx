"use client";

import type { OverviewMetrics } from "@/lib/types";

export function MetricCards({ m }: { m: OverviewMetrics }) {
  const cards = [
    {
      label: "GUESTS ATTENDING",
      value: String(m.guestsAttending),
      accent: `of ${m.guestsInvited} invited`,
      sub: `${m.adultsAttending} adults · ${m.childrenAttending} children · ${m.infantsAttending} infants`,
      rose: false,
    },
    {
      label: "HOUSEHOLDS RESPONDED",
      value: String(m.householdsResponded),
      accent: `of ${m.householdsInvited} invited`,
      sub: `${m.householdsPending} pending`,
      rose: false,
    },
    {
      label: "RSVP COMPLETION",
      value: `${m.completionPct}%`,
      accent: `${m.plusOnesAdded} plus ones added`,
      sub: `${m.guestsDeclined} guests declined so far`,
      rose: false,
    },
    {
      label: "NEEDS ATTENTION",
      value: String(m.guestsWithoutTable + m.dietaryCount === 0 ? 0 : m.guestsWithoutTable),
      accent: "guests without a table",
      sub: `${m.dietaryCount} dietary · ${m.accessibilityCount} accessibility`,
      rose: true,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2 max-md:gap-2.5">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-2 rounded-[14px] border border-hairline p-5 max-md:p-4"
        >
          <span className="text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]">{c.label}</span>
          <span className="flex items-baseline gap-2">
            <span className={`text-[34px] font-semibold leading-none ${c.rose ? "text-rose" : "text-ink"}`}>
              {c.value}
            </span>
            <span className="text-[13px] font-medium text-olive">{c.accent}</span>
          </span>
          <span className="text-[12.5px] text-muted">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}
