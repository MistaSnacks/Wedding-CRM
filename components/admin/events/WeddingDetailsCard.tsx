"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveWeddingDetails,
  type WeddingDetailsFormState,
} from "@/app/admin/(dashboard)/events/actions";
import type { DayMovePreview } from "@/lib/domain/wedding-details";

/**
 * The wedding day, the reply-by date and the city guests see, in one place.
 *
 * It opens as two sentences, the way she would say them, so she can check the
 * details without reading a form. Edit opens the fields. Every guest page and
 * email reads these values from the database, so a save here reaches guests
 * with no other step.
 *
 * The time zone is shown, not edited: changing it would move every event time
 * at once, which needs one atomic database step that does not exist yet.
 */

export type WeddingDetailsView = {
  /** "Saturday, September 18, 2027 in Guadalajara, México." */
  whenSentence: string;
  /** "Guests can reply until July 1, 2027." */
  replyBySentence: string;
  /** "Pacific Time (Los Angeles)" */
  timeZoneLabel: string;
  weddingDay: string;
  replyBy: string;
  locationLine: string;
  /** What a new wedding day does to the events. Computed by the page. */
  dayMove: DayMovePreview;
};

const INPUT =
  "admin-field rounded-lg border bg-white px-3 py-2 text-[13.5px] text-ink outline-none transition-colors focus:border-olive";

export function WeddingDetailsCard({ details }: { details: WeddingDetailsView }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);

  return (
    <section className="rounded-2xl border border-hairline bg-white/70">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 pt-5 pb-4 sm:px-7">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-[#9aa38f] uppercase">
            Wedding details
          </p>
          <p className="font-display mt-1.5 text-[22px] leading-snug font-medium text-olive-deep">
            {details.whenSentence}
          </p>
          <p className="mt-1 text-[13.5px] text-[#4a5147]">{details.replyBySentence}</p>
          <p className="mt-2 text-[12px] text-muted">
            Guests see these on the RSVP page and in every email. Event times use{" "}
            {details.timeZoneLabel}.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setSaved(null);
            }}
            className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2 text-[13px] font-semibold text-olive-deep transition-colors hover:border-rose hover:text-rose"
          >
            Edit
          </button>
        )}
      </div>

      {saved !== null && !editing && (
        <p
          role="status"
          className="mx-5 mb-5 rounded-lg bg-sage-band px-3.5 py-2.5 text-[12.5px] leading-relaxed text-olive-deep sm:mx-7"
        >
          {saved.length === 0
            ? "Saved. Guests see the new details now."
            : `Saved. ${joinNames(saved)} moved to the new day at the same ${saved.length === 1 ? "time" : "times"}. Guests see the new details now.`}
        </p>
      )}

      {editing && (
        <div className="border-t border-[#f1f0ea] bg-paper/50">
          <DetailsForm
            details={details}
            onSaved={(moved) => {
              setSaved(moved);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </section>
  );
}

function DetailsForm({
  details,
  onSaved,
  onCancel,
}: {
  details: WeddingDetailsView;
  onSaved: (moved: string[]) => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<WeddingDetailsFormState, FormData>(
    saveWeddingDetails,
    { ok: false },
  );
  const [weddingDay, setWeddingDay] = useState(details.weddingDay);

  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  useEffect(() => {
    if (state.ok) onSavedRef.current(state.moved ?? []);
  }, [state]);

  const dayChanges = details.weddingDay !== "" && weddingDay !== "" && weddingDay !== details.weddingDay;
  const { follow, stay } = details.dayMove;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-[46rem] flex-col gap-6 px-5 py-6 sm:px-7">
      <Field id="wedding-day" label="Wedding day" error={errors.weddingDay}>
        <input
          id="wedding-day"
          type="date"
          name="weddingDay"
          value={weddingDay}
          onChange={(e) => setWeddingDay(e.target.value)}
          aria-invalid={errors.weddingDay ? true : undefined}
          className={`${INPUT} ${errors.weddingDay ? "border-rose" : "border-[#dddbd0]"}`}
        />
        {dayChanges && (follow.length > 0 || stay.length > 0) && (
          <div className="mt-3 max-w-[52ch] rounded-lg border border-hairline bg-white px-3.5 py-3 text-[12.5px] leading-relaxed text-[#4a5147]">
            {follow.length > 0 && (
              <>
                <p className="font-semibold text-ink">When you save, these events move to the new day:</p>
                <ul className="mt-1 list-disc pl-5">
                  {follow.map((event) => (
                    <li key={event.id}>
                      {event.time === null
                        ? `${event.name} moves with it.`
                        : `${event.name} moves with it and stays at ${event.time}.`}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {stay.length > 0 && (
              <p className={follow.length > 0 ? "mt-2" : ""}>
                {stay.map((event) => `${event.name} stays on ${event.day}`).join(". ")}. To move{" "}
                {stay.length === 1 ? "it" : "them"} too, edit {stay.length === 1 ? "that event" : "each event"} below.
              </p>
            )}
          </div>
        )}
      </Field>
      <input type="hidden" name="expectedMoves" value={dayChanges ? follow.map((e) => e.id).join(",") : ""} />

      <Field
        id="reply-by"
        label="Reply-by date"
        hint="Guests can reply until the end of this day. Leave it blank to take replies at any time."
        error={errors.replyBy}
      >
        <input
          id="reply-by"
          type="date"
          name="replyBy"
          defaultValue={details.replyBy}
          aria-invalid={errors.replyBy ? true : undefined}
          className={`${INPUT} ${errors.replyBy ? "border-rose" : "border-[#dddbd0]"}`}
        />
      </Field>

      <Field id="city-line" label="City guests see" hint="For example: Guadalajara, México" error={errors.locationLine}>
        <input
          id="city-line"
          name="locationLine"
          defaultValue={details.locationLine}
          maxLength={80}
          aria-invalid={errors.locationLine ? true : undefined}
          className={`${INPUT} w-full max-w-[26rem] ${errors.locationLine ? "border-rose" : "border-[#dddbd0]"}`}
        />
      </Field>

      {state.needsPastConfirm && (
        <div
          role="alert"
          className="max-w-[60ch] rounded-lg border border-blush-border bg-blush px-3.5 py-3 text-[12.5px] leading-relaxed text-rose-deep"
        >
          <p>That wedding day is in the past. Check the day. If it is correct, save it anyway.</p>
          <button
            name="confirmPastDay"
            value="yes"
            disabled={pending}
            className="mt-2 font-semibold underline decoration-rose-deep/40 underline-offset-2 hover:decoration-rose-deep disabled:opacity-50"
          >
            Save this day anyway
          </button>
        </div>
      )}

      {errors.form && (
        <p
          role="alert"
          className="max-w-[60ch] rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] leading-relaxed text-rose-deep"
        >
          {errors.form}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          disabled={pending}
          className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
        >
          {pending ? "Saving…" : "Save wedding details"}
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

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="font-display block text-[18px] font-medium text-olive-deep">
        {label}
      </label>
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

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
