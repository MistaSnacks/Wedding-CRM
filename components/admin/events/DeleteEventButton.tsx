"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { DeletionImpact } from "@/lib/data/event-rules";
import { deleteEvent, deletionCost } from "@/app/admin/(dashboard)/events/actions";

/**
 * The guarded delete — the most dangerous thing on this screen.
 *
 * A competitor is on record wiping RSVPs and meal choices during a routine
 * bulk action with no undo, so this never deletes on a single click and never
 * deletes silently. The cost is read from the database at the moment she asks,
 * not when the page rendered, and the same numbers are re-read on the server
 * before the row goes: a reply that lands in between still forces the guard.
 *
 * It follows ConfirmButton's convention — arm on the first click, fire on the
 * second — rather than reusing it, because that component's action returns
 * `void` and this one has a refusal to show and a name to take.
 */
export function DeleteEventButton({
  eventId,
  eventName,
  onDeleted,
}: {
  eventId: string;
  eventName: string;
  onDeleted: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "checking" | "armed" | "guarded" | "deleting">(
    "idle",
  );
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function disarmLater() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase("idle"), 4000);
  }

  function fire(confirmation: string) {
    setPhase("deleting");
    startTransition(async () => {
      try {
        const result = await deleteEvent(eventId, confirmation);
        if (result.ok) {
          onDeleted();
          return;
        }
        setPhase("idle");
        setError(result.message ?? "That didn't delete. Nothing was changed.");
      } catch {
        // The request never landed. Say so rather than letting the rejection
        // reach the error boundary — and be unambiguous that nothing went,
        // because "did my delete happen?" is the worst question to be left with.
        setPhase("idle");
        setError("Couldn't reach the server — the connection dropped. Nothing was deleted.");
      }
    });
  }

  function onClick() {
    setError(null);
    if (phase === "armed") {
      if (timer.current) clearTimeout(timer.current);
      fire("");
      return;
    }
    if (phase !== "idle") return;

    setPhase("checking");
    startTransition(async () => {
      try {
        const result = await deletionCost(eventId);
        if (!result.ok || !result.impact) {
          setPhase("idle");
          setError(result.message ?? "Couldn't check what this would remove.");
          return;
        }
        setImpact(result.impact);
        if (result.impact.replied > 0 || result.impact.mealsChosen > 0) {
          setTyped("");
          setPhase("guarded");
        } else {
          setPhase("armed");
          disarmLater();
        }
      } catch {
        // Never arm on a failed check: the whole guard rests on knowing what
        // would be destroyed, and an unread cost is not a cost of zero.
        setPhase("idle");
        setError("Couldn't check what this would remove — the connection dropped.");
      }
    });
  }

  const label =
    phase === "checking"
      ? "…"
      : phase === "deleting"
        ? "Deleting…"
        : phase === "armed"
          ? "Delete for good?"
          : "Delete";

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={phase === "checking" || phase === "deleting"}
        className={`text-[12px] font-medium transition-colors ${
          phase === "armed" ? "font-semibold text-rose" : "text-muted hover:text-rose"
        } ${phase === "checking" || phase === "deleting" ? "opacity-50" : ""}`}
      >
        {label}
      </button>

      {error && (
        <span role="alert" className="text-[12px] leading-snug text-rose-deep">
          {error}
        </span>
      )}

      {phase === "guarded" && impact && (
        <GuardDialog
          eventName={eventName}
          impact={impact}
          typed={typed}
          onTyped={setTyped}
          onCancel={() => setPhase("idle")}
          onConfirm={() => fire(typed)}
        />
      )}
    </>
  );
}

/**
 * The true cost, in the units the numbers are actually counted in.
 *
 * `replied` counts households — one reply per envelope is how she thinks about
 * it — while `mealsChosen` counts guests, because a meal is chosen per person
 * and one household can contribute several. Saying "and 3 have chosen meals"
 * after "14 households have replied" would read as 3 households and understate
 * what is being destroyed.
 */
export function deletionSentence(name: string, impact: DeletionImpact): string {
  const replied =
    impact.replied === 1
      ? `1 household has already replied to ${name}`
      : `${impact.replied} households have already replied to ${name}`;
  const meals =
    impact.mealsChosen === 1 ? "1 guest has chosen a meal" : `${impact.mealsChosen} guests have chosen meals`;

  if (impact.replied > 0 && impact.mealsChosen > 0) {
    return `${replied}, and ${meals}. Deleting it removes those replies permanently.`;
  }
  if (impact.replied > 0) {
    return `${replied}. Deleting it removes those replies permanently.`;
  }
  return `${meals} for ${name}. Deleting it removes those choices permanently.`;
}

function GuardDialog({
  eventName,
  impact,
  typed,
  onTyped,
  onCancel,
  onConfirm,
}: {
  eventName: string;
  impact: DeletionImpact;
  typed: string;
  onTyped: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const matches = typed.trim() === eventName.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1c231b]/35 px-6 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-event-heading"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[34rem] rounded-2xl border border-blush-border bg-cream p-7 shadow-[0_24px_60px_rgba(28,35,27,0.28)]"
      >
        <h2
          id="delete-event-heading"
          className="font-display text-[26px] leading-tight font-medium text-rose-deep"
        >
          {`Delete ${eventName}?`}
        </h2>

        <p className="mt-2.5 text-[13.5px] leading-relaxed text-[#4a5147]">
          {deletionSentence(eventName, impact)}
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          {`Their invitations to it go too — ${impact.households} ${
            impact.households === 1 ? "household" : "households"
          }. There is no undo.`}
        </p>

        <label htmlFor="delete-event-name" className="mt-5 block text-[12.5px] text-[#4a5147]">
          {"Type "}
          <b className="font-semibold text-ink">{eventName}</b>
          {" to confirm"}
        </label>
        <input
          id="delete-event-name"
          ref={inputRef}
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
          placeholder={eventName}
          className="mt-1.5 w-full rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-rose"
        />

        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches}
            className="rounded-lg bg-rose px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:bg-rose-deep active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
          >
            Delete permanently
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-[12.5px] font-medium text-muted transition-colors hover:text-olive-deep"
          >
            Keep it
          </button>
        </div>
      </div>
    </div>
  );
}
