"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveEvent, type EventFormState } from "@/app/admin/(dashboard)/events/actions";

/**
 * Add or edit one event.
 *
 * Six questions in the order she'd ask them, no asterisks and no field names:
 * when something is missing the form says so in a sentence, next to the
 * question it belongs to. Only the name is genuinely required — a half-planned
 * event with no date and no venue is normal a year out.
 *
 * Every field posts on every save, including the hidden `endsAt`: the data
 * layer replaces the whole row rather than patching it, so a field left out of
 * the form would be blanked by an unrelated edit.
 */

const PRESETS = [
  "Welcome Party",
  "Rehearsal Dinner",
  "Ceremony",
  "Reception",
  "Farewell Brunch",
] as const;

/** The two most people run for the whole guest list; the rest usually don't. */
const EVERYONE_BY_DEFAULT = new Set<string>(["Ceremony", "Reception"]);

export type EventFormInitial = {
  name: string;
  date: string;
  time: string;
  endsAt: string | null;
  venueName: string;
  venueAddress: string;
  dressCode: string;
  everyone: boolean;
  rsvpEnabled: boolean;
};

export function EventForm({
  eventId,
  initial,
  repliedHouseholds,
  onSaved,
  onCancel,
}: {
  eventId: string | null;
  initial: EventFormInitial;
  /** Households that have already replied — the disable-RSVP warning needs it. */
  repliedHouseholds: number;
  onSaved: (result: EventFormState) => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<EventFormState, FormData>(
    saveEvent.bind(null, eventId),
    { ok: false },
  );
  const [name, setName] = useState(initial.name);
  const [everyone, setEveryone] = useState(initial.everyone);
  const [rsvp, setRsvp] = useState(initial.rsvpEnabled);

  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  useEffect(() => {
    if (state.ok) onSavedRef.current(state);
  }, [state]);

  const isNew = eventId === null;

  function applyPreset(preset: string) {
    setName(preset);
    // Only when adding: overriding a scope she already chose on an existing
    // event would be a change she didn't ask for.
    if (isNew) setEveryone(EVERYONE_BY_DEFAULT.has(preset));
  }

  return (
    <form action={formAction} className="flex max-w-[46rem] flex-col gap-6 px-5 py-6 sm:px-7">
      <Question label="What is it?" error={state.fieldErrors?.name}>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Rehearsal Dinner"
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          className={`font-display w-full max-w-[26rem] rounded-lg border bg-white px-3.5 py-2.5 text-[20px] font-medium text-ink outline-none transition-colors focus:border-olive ${
            state.fieldErrors?.name ? "border-rose" : "border-[#dddbd0]"
          }`}
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                name.trim().toLowerCase() === preset.toLowerCase()
                  ? "border-olive-deep bg-olive-deep text-cream"
                  : "border-[#dddbd0] text-[#4a5147] hover:border-rose hover:text-rose"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </Question>

      <Question
        label="When?"
        hint="Leave either one blank if it isn't decided."
        error={state.fieldErrors?.when}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            name="date"
            defaultValue={initial.date}
            className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-olive"
          />
          <input
            type="time"
            name="time"
            defaultValue={initial.time}
            className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-olive"
          />
        </div>
        <input type="hidden" name="endsAt" value={initial.endsAt ?? ""} />
      </Question>

      <Question label="Where?">
        <div className="flex flex-wrap gap-2">
          <input
            name="venueName"
            defaultValue={initial.venueName}
            placeholder="Venue name"
            className="w-[15rem] rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive"
          />
          <input
            name="venueAddress"
            defaultValue={initial.venueAddress}
            placeholder="Address"
            className="w-[21rem] rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive"
          />
        </div>
      </Question>

      <Question label="What should people wear?">
        <input
          name="dressCode"
          defaultValue={initial.dressCode}
          placeholder="Cocktail attire, garden party, come as you are…"
          className="w-full max-w-[26rem] rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] outline-none focus:border-olive"
        />
      </Question>

      {/* Not just today's list: `visibility` is what the importer reads when it
          decides whether a newly added household joins this event, so the
          question has to be asked about the future as well as the present. */}
      <Question label="Who's invited?">
        <div className="flex flex-wrap gap-2">
          <Choice
            name="everyone"
            value="yes"
            checked={everyone}
            onChange={() => setEveryone(true)}
            title="Everyone"
            note="Every household on your guest list — and new guests you add later are invited automatically."
          />
          <Choice
            name="everyone"
            value="no"
            checked={!everyone}
            onChange={() => setEveryone(false)}
            title="Just the people you pick"
            note={
              isNew
                ? "You'll pick them next. New guests you add later aren't invited to this."
                : "Pick them under “Who's invited”. New guests you add later aren't invited to this."
            }
          />
        </div>
      </Question>

      <Question label="Collect RSVPs for this?">
        <div className="flex flex-wrap gap-2">
          <Choice
            name="rsvp"
            value="yes"
            checked={rsvp}
            onChange={() => setRsvp(true)}
            title="Yes"
            note="Guests reply to this one"
          />
          <Choice
            name="rsvp"
            value="no"
            checked={!rsvp}
            onChange={() => setRsvp(false)}
            title="No"
            note="Just part of the weekend"
          />
        </div>
        {!rsvp && repliedHouseholds > 0 && (
          <p className="mt-2.5 max-w-[52ch] rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] leading-relaxed text-rose-deep">
            {repliedHouseholds === 1
              ? "1 household has already replied. Turning this off keeps their reply — it only stops collecting new ones."
              : `${repliedHouseholds} households have already replied. Turning this off keeps their replies — it only stops collecting new ones.`}
          </p>
        )}
      </Question>

      {state.fieldErrors?.form && (
        <p
          role="alert"
          className="max-w-[60ch] rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] leading-relaxed text-rose-deep"
        >
          {state.fieldErrors.form}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          disabled={pending}
          className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
        >
          {pending ? "Saving…" : isNew ? "Add this event" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-[12.5px] font-medium text-muted transition-colors hover:text-rose disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Question({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-display text-[18px] font-medium text-olive-deep">{label}</p>
      {hint && <p className="mt-0.5 mb-2 text-[12.5px] text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] font-medium text-rose">
          {error}
        </p>
      )}
    </div>
  );
}

/** A radio that reads as a sentence rather than a dot with a word next to it. */
function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  note,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  note: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 transition-colors ${
        checked ? "border-olive bg-sage-band/60" : "border-[#dddbd0] hover:border-[#c9cdbf]"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 accent-[#3b4823]"
      />
      <span className="block max-w-[34ch]">
        <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
        <span className="block text-[12px] leading-relaxed text-[#6b7167]">{note}</span>
      </span>
    </label>
  );
}
