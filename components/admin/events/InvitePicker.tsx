"use client";

import { useMemo, useState, useTransition } from "react";
import { setEventInvites, setEventScope } from "@/app/admin/(dashboard)/events/actions";
import { inviteDiff } from "@/lib/data/event-rules";

/**
 * The invite matrix, from the event's side.
 *
 * Groups are a shortcut, not a rule: picking one ticks those households'
 * boxes and stops there, so what's on screen is the whole of the state and any
 * one of them can be unticked straight afterwards. The alternative — storing
 * "everyone tagged A List" — means she has to invent and maintain that tag
 * forever, and can never make an exception without breaking it.
 *
 * Above the list sits the one thing that *is* a standing rule: whether guests
 * added after today are invited to this event automatically. It is a door that
 * opens both ways, and it moves only when she moves it — un-ticking a
 * household changes who is invited today and says nothing about next year's
 * import.
 *
 * Every change saves immediately and is reversible. Un-inviting a household
 * keeps any reply it already gave, so re-inviting it brings the reply back.
 */

export type HouseholdView = {
  id: string;
  name: string;
  /** Guest names, for search and for recognising the household. */
  people: string;
  tags: string[];
};

export function InvitePicker({
  eventId,
  eventName,
  households,
  selected,
  everyone,
  onChange,
  onEveryoneChange,
}: {
  eventId: string;
  eventName: string;
  households: HouseholdView[];
  selected: string[];
  /** The standing rule: are guests added later invited automatically? */
  everyone: boolean;
  onChange: (next: string[]) => void;
  onEveryoneChange: (next: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The change that failed, kept so "Try again" has something to retry. */
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = useMemo(() => new Set(selected), [selected]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of households) {
      for (const tag of h.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, [households]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return households;
    return households.filter((h) =>
      `${h.name} ${h.people} ${h.tags.join(" ")}`.toLowerCase().includes(q),
    );
  }, [households, query]);

  /**
   * Optimistic, with both failure modes covered.
   *
   * A server-side refusal comes back as `ok:false`; a dropped connection
   * *rejects* instead, and an uncaught rejection inside a transition escapes to
   * the route's error boundary, which replaces the entire page — the list, the
   * search box and this open picker — with "This page couldn't load". Catching
   * it here keeps her work on screen and offers the retry.
   */
  function apply(next: string[]) {
    const before = selected;
    // Only what this gesture changed goes to the server. Sending the whole
    // selection would commit a render-time snapshot — and un-invite anyone a
    // concurrent import (or another editor) added since the page loaded.
    const { toAdd, toRemove } = inviteDiff(before, next);
    if (toAdd.length === 0 && toRemove.length === 0) return;
    setError(null);
    setRetry(null);
    onChange(next);
    startTransition(async () => {
      try {
        const result = await setEventInvites(eventId, { add: toAdd, remove: toRemove });
        if (!result.ok) {
          onChange(before);
          setError(result.message ?? "That didn't save. Nothing was changed.");
          setRetry(() => () => apply(next));
        }
      } catch {
        onChange(before);
        setError("That didn't save — the connection dropped. Nothing was changed.");
        setRetry(() => () => apply(next));
      }
    });
  }

  function applyScope(next: boolean) {
    // Choosing the rule that is already in force is a no-op, and must be:
    // replaying "Everyone" would re-tick any household she has un-ticked by
    // hand, which the banner promises stays out.
    if (next === everyone) return;
    const before = everyone;
    const beforeSelected = selected;
    setError(null);
    setRetry(null);
    onEveryoneChange(next);
    // "Everyone" is the only direction that also moves the ticks: it means
    // every household, so show that immediately. Narrowing leaves the list
    // exactly as it is — that is the whole point of making it a choice.
    if (next) onChange(households.map((h) => h.id));
    startTransition(async () => {
      function revert() {
        onEveryoneChange(before);
        onChange(beforeSelected);
      }
      try {
        const result = await setEventScope(eventId, next);
        if (!result.ok) {
          revert();
          setError(result.message ?? "That didn't save. Nothing was changed.");
          setRetry(() => () => applyScope(next));
        }
      } catch {
        revert();
        setError("That didn't save — the connection dropped. Nothing was changed.");
        setRetry(() => () => applyScope(next));
      }
    });
  }

  function toggle(id: string) {
    apply(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  function toggleGroup(tag: string) {
    const inGroup = households.filter((h) => h.tags.includes(tag)).map((h) => h.id);
    const allIn = inGroup.every((id) => chosen.has(id));
    apply(
      allIn
        ? selected.filter((id) => !inGroup.includes(id))
        : [...new Set([...selected, ...inGroup])],
    );
  }

  const shownIds = shown.map((h) => h.id);
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => chosen.has(id));

  return (
    <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-display text-[18px] font-medium text-olive-deep">
          {`Who's coming to ${eventName}?`}
        </p>
        <p className="text-[12.5px] text-muted">
          {`${selected.length} of ${households.length} ${
            households.length === 1 ? "household" : "households"
          } invited${pending ? " · saving…" : ""}`}
        </p>
      </div>

      <div>
        <p className="text-[11px] font-semibold tracking-[0.1em] text-[#9aa38f] uppercase">
          {"As you add guests"}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <Scope
            chosen={everyone}
            onChoose={() => applyScope(true)}
            title="Everyone"
            note="Every household, and anyone you add or import later is invited automatically."
          />
          <Scope
            chosen={!everyone}
            onChoose={() => applyScope(false)}
            title="Just the people you pick"
            note="Only the households ticked below. Guests you add later aren't invited to this."
          />
        </div>
        {everyone && selected.length < households.length && (
          <p className="mt-1.5 max-w-[62ch] rounded-lg border border-blush-border bg-blush px-3.5 py-2 text-[12px] leading-relaxed text-rose-deep">
            {`${households.length - selected.length === 1 ? "One household is" : `${households.length - selected.length} households are`} unticked, and they stay out. Everyone you add from now on still comes in automatically — choose “Just the people you pick” if you'd rather decide each one.`}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search households"
          placeholder="Search a name…"
          className="w-[17rem] rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2 text-[13px] outline-none focus:border-olive"
        />
        <button
          type="button"
          onClick={() => apply(allShownChosen ? [] : [...new Set([...selected, ...shownIds])])}
          className="rounded-full border border-[#dddbd0] px-3.5 py-1.5 text-[12.5px] font-medium text-[#4a5147] transition-colors hover:border-rose hover:text-rose"
        >
          {allShownChosen
            ? "Clear the list"
            : query.trim().length > 0
              ? `Select all ${shown.length} shown`
              : "Select all"}
        </button>
      </div>

      {groups.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] text-[#9aa38f] uppercase">
            Pick a group
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {groups.map((g) => {
              const inGroup = households.filter((h) => h.tags.includes(g.tag)).map((h) => h.id);
              const allIn = inGroup.every((id) => chosen.has(id));
              return (
                <button
                  key={g.tag}
                  type="button"
                  onClick={() => toggleGroup(g.tag)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                    allIn
                      ? "border-olive bg-sage-band text-olive-deep"
                      : "border-[#dddbd0] text-[#4a5147] hover:border-rose hover:text-rose"
                  }`}
                >
                  {`${g.tag} · ${g.count}`}
                </button>
              );
            })}
          </div>
          {/* One expression, not text wrapped over two source lines: this
              toolchain drops the leading space of a JSX text node that wraps,
              which once silently shipped "seats areheld". */}
          <p className="mt-1.5 max-w-[62ch] text-[12px] leading-relaxed text-muted">
            {"Picking a group just ticks those boxes. Nothing is remembered, so you can untick anyone afterwards and they stay unticked."}
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep"
        >
          <span>{error}</span>
          {retry && (
            <button
              type="button"
              onClick={retry}
              className="font-semibold underline decoration-rose-deep/40 underline-offset-2 transition-colors hover:decoration-rose-deep"
            >
              Try again
            </button>
          )}
        </p>
      )}

      <div className="max-h-[22rem] overflow-y-auto rounded-xl border border-hairline bg-paper/60">
        <ul className="divide-y divide-[#f1f0ea]">
          {shown.map((h) => {
            const isChosen = chosen.has(h.id);
            return (
              <li key={h.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/70">
                  <input
                    type="checkbox"
                    checked={isChosen}
                    onChange={() => toggle(h.id)}
                    className="h-4 w-4 accent-[#3b4823]"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`font-display block text-[16px] font-medium ${
                        isChosen ? "text-olive-deep" : "text-[#6b7167]"
                      }`}
                    >
                      {h.name}
                    </span>
                    {h.people.length > 0 && (
                      <span className="block truncate text-[12px] text-muted">{h.people}</span>
                    )}
                  </span>
                  {h.tags.length > 0 && (
                    <span className="flex flex-shrink-0 flex-wrap justify-end gap-1">
                      {h.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-medium text-[#6b7167]"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="px-4 py-8 text-center text-[13px] text-muted">
              {households.length === 0
                ? "There are no households yet — import your guest list first."
                : "Nobody matches that search."}
            </li>
          )}
        </ul>
      </div>

      <p className="text-[12px] text-muted">
        {"Changes save as you tick. Un-inviting someone keeps any reply they already sent, so you can put them back."}
      </p>
    </div>
  );
}

/**
 * One half of the standing rule, shaped like the form's radios so the two
 * places she can set it read as the same control. A button rather than a radio
 * because choosing it saves at once — there is no form to submit.
 */
function Scope({
  chosen,
  onChoose,
  title,
  note,
}: {
  chosen: boolean;
  onChoose: () => void;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={`flex max-w-[24rem] flex-1 items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
        chosen
          ? "border-olive bg-sage-band/60"
          : "border-[#dddbd0] bg-white/50 hover:border-[#c9cdbf]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-[3px] flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
          chosen ? "border-[#3b4823]" : "border-[#c9cdbf]"
        }`}
      >
        {chosen && <span className="h-1.5 w-1.5 rounded-full bg-[#3b4823]" />}
      </span>
      <span className="block">
        <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
        <span className="block text-[12px] leading-relaxed text-[#6b7167]">{note}</span>
      </span>
    </button>
  );
}
