"use client";

import type { OverviewMetrics } from "@/lib/types";

export function MetricCards({ m }: { m: OverviewMetrics }) {
  const cards = [
    {
      label: "GUESTS COMING",
      value: String(m.guestsAttending),
      accent: `of ${m.guestsInvited} invited`,
      sub: `${m.adultsAttending} ${m.adultsAttending === 1 ? "adult" : "adults"} · ${m.childrenAttending} ${m.childrenAttending === 1 ? "child" : "children"} · ${m.infantsAttending} ${m.infantsAttending === 1 ? "infant" : "infants"}`,
      rose: false,
    },
    {
      label: "NOT COMING",
      value: String(m.guestsDeclined),
      accent: m.guestsDeclined === 1 ? "guest" : "guests",
      sub: `${m.guestsPending} guests have not answered yet`,
      rose: false,
    },
    {
      label: "REPLIES FINISHED",
      value: `${m.completionPct}%`,
      accent: `${m.householdsResponded} of ${m.householdsInvited} households`,
      sub: `${m.plusOnesAdded} plus-one${m.plusOnesAdded === 1 ? "" : "s"} added by guests`,
      rose: false,
    },
    {
      label: "STILL TO SEAT",
      value: String(m.guestsWithoutTable),
      accent: m.guestsWithoutTable === 1 ? "guest coming, no table" : "guests coming, no table",
      sub: `${m.dietaryCount} dietary note${m.dietaryCount === 1 ? "" : "s"} · ${m.accessibilityCount} accessibility request${m.accessibilityCount === 1 ? "" : "s"}`,
      rose: m.guestsWithoutTable > 0,
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
