"use client";

import { useTransition } from "react";
import { adminSetResponse } from "@/app/admin/(dashboard)/guests/actions";
import type { Attending, MealOptionRow } from "@/lib/types";

export function ResponseCell(props: {
  householdId: string;
  guestId: string;
  eventId: string;
  eventName: string;
  attending: Attending;
  mealOptionId: string | null;
  meals: MealOptionRow[];
  isChild: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function set(attending: Attending, mealOptionId?: string | null) {
    startTransition(() =>
      adminSetResponse(
        props.householdId,
        props.guestId,
        props.eventId,
        attending,
        mealOptionId === undefined ? props.mealOptionId : mealOptionId,
      ),
    );
  }

  return (
    <div className={`w-[168px] flex-shrink-0 ${pending ? "opacity-50" : ""}`}>
      <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted uppercase">
        {props.eventName}
      </p>
      <select
        disabled={pending}
        aria-label={`Reply for ${props.eventName}`}
        value={props.attending}
        onChange={(e) => set(e.target.value as Attending)}
        className={`admin-field mt-1 w-full rounded-lg border border-[#dddbd0] bg-white px-2.5 py-1.5 text-[13px] font-semibold outline-none focus:border-olive ${
          props.attending === "yes"
            ? "text-olive"
            : props.attending === "no"
              ? "text-rose"
              : "text-muted"
        }`}
      >
        <option value="pending">No reply yet</option>
        <option value="yes">Coming</option>
        <option value="no">Not coming</option>
      </select>
      {props.attending === "yes" && (
        <select
          disabled={pending}
          aria-label={`Meal for ${props.eventName}`}
          value={props.mealOptionId ?? ""}
          onChange={(e) => set("yes", e.target.value || null)}
          className={`admin-field mt-1 w-full rounded-lg border bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-olive ${
            props.mealOptionId ? "border-[#dddbd0] text-[#4a5147]" : "border-rose/60 font-medium text-rose-deep"
          }`}
        >
          <option value="">Choose a meal…</option>
          {props.meals
            .filter(
              (m) =>
                (!m.event_id || m.event_id === props.eventId) &&
                (props.isChild || !m.is_kids_meal),
            )
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}
