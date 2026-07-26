"use client";

import { useState, useTransition } from "react";
import { setHouseholdInvite } from "@/app/admin/(dashboard)/events/actions";

/**
 * The same invite matrix from the other side: one household, every event.
 *
 * She asks the question both ways — "who's coming to the rehearsal?" and "what
 * are the Smiths invited to?" — so both are answerable, and both write the same
 * rows. There is no main event to belong to first: a household can be invited
 * to the rehearsal dinner and not the reception, and that is a normal thing to
 * want rather than an error.
 */
export function HouseholdEvents({
  householdId,
  events,
  invited,
}: {
  householdId: string;
  events: Array<{ id: string; name: string; whenLabel: string | null; rsvpEnabled: boolean }>;
  invited: string[];
}) {
  const [chosen, setChosen] = useState<string[]>(invited);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(eventId: string) {
    const nowInvited = !chosen.includes(eventId);
    const before = chosen;
    setError(null);
    setChosen(nowInvited ? [...chosen, eventId] : chosen.filter((id) => id !== eventId));
    startTransition(async () => {
      const result = await setHouseholdInvite(householdId, eventId, nowInvited);
      if (!result.ok) {
        setChosen(before);
        setError(result.message ?? "That didn't save. Nothing was changed.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-hairline p-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[14.5px] font-semibold text-ink">Invited to</h2>
        {pending && <span className="text-[11.5px] text-muted">saving…</span>}
      </div>

      {events.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">
          {"There are no events yet. Add one on the Events page and you can invite this household to it."}
        </p>
      ) : (
        <div className="mt-2.5 flex flex-col">
          {events.map((event) => {
            const isChosen = chosen.includes(event.id);
            return (
              <label
                key={event.id}
                className="-mx-2 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-paper"
              >
                <input
                  type="checkbox"
                  checked={isChosen}
                  onChange={() => toggle(event.id)}
                  className="h-4 w-4 accent-[#3b4823]"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[13px] font-medium ${isChosen ? "text-ink" : "text-[#8a8f86]"}`}
                  >
                    {event.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {event.whenLabel === null ? "No date yet" : event.whenLabel}
                  </span>
                </span>
                {!event.rsvpEnabled && (
                  <span className="flex-shrink-0 rounded-full bg-[#f1f0ea] px-2 py-0.5 text-[10px] font-semibold tracking-[0.05em] text-[#6b7167] uppercase">
                    No RSVPs
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-rose-deep">
          {error}
        </p>
      )}

      <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
        {"Saves as you tick. Unticking keeps any reply they've already sent, so you can put them back."}
      </p>
    </div>
  );
}
