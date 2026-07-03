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
      adminSetResponse(props.householdId, props.guestId, props.eventId, attending, mealOptionId ?? props.mealOptionId),
    );
  }

  return (
    <div className={`w-[150px] flex-shrink-0 ${pending ? "opacity-50" : ""}`}>
      <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted uppercase">{props.eventName}</p>
      <select
        value={props.attending}
        onChange={(e) => set(e.target.value as Attending)}
        className={`mt-1 w-full rounded-md border border-transparent bg-transparent text-[13px] font-semibold outline-none hover:border-[#dddbd0] ${
          props.attending === "yes" ? "text-olive" : props.attending === "no" ? "text-rose" : "text-muted"
        }`}
      >
        <option value="pending">No response</option>
        <option value="yes">Attending</option>
        <option value="no">Declined</option>
      </select>
      {props.attending === "yes" && (
        <select
          value={props.mealOptionId ?? ""}
          onChange={(e) => set("yes", e.target.value || null)}
          className={`mt-0.5 w-full rounded-md border border-transparent bg-transparent text-[12px] outline-none hover:border-[#dddbd0] ${
            props.mealOptionId ? "text-[#4a5147]" : "font-medium text-rose"
          }`}
        >
          <option value="">— meal missing</option>
          {props.meals
            .filter((m) => (props.isChild ? true : !m.is_kids_meal))
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
