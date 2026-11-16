"use client";
import { useState, useTransition } from "react";
import { saveMeal } from "@/app/admin/(dashboard)/meals/actions";
import type { MealNameTranslations } from "@/lib/types";

type Meal = {
  id: string;
  name: string;
  event_id: string | null;
  is_kids_meal: boolean;
  is_active: boolean;
  name_i18n: MealNameTranslations;
};

const field =
  "rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13.5px] text-ink outline-none transition-colors focus:border-olive";

export function MenuEditor({ meals, events }: { meals: Meal[]; events: Array<{ id: string; name: string }> }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(form: FormData) {
    if (pending) return;
    start(async () => {
      try {
        const result = await saveMeal(form);
        setMessage({ ok: result.ok, text: result.message });
      } catch {
        setMessage({ ok: false, text: "Please reload to check the menu before you try again." });
      }
    });
  }

  const blank: Meal = { id: "", name: "", event_id: null, is_kids_meal: false, is_active: true, name_i18n: {} };

  return (
    <details className="rounded-2xl border border-hairline bg-white/75 p-5 max-md:p-4">
      <summary className="cursor-pointer text-[14.5px] font-semibold text-ink">
        Change the menu
        <span className="ml-2 text-[13px] font-normal text-muted">
          {meals.filter((m) => m.is_active).length} dishes guests can pick from
        </span>
      </summary>
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted">
        Guests choose from these dishes when they reply. You can rename a dish at any time. A dish that a guest already
        picked cannot be removed; add a new one instead. A renamed dish shows its new English name to every guest until
        its Spanish and Vietnamese names are added again.
      </p>
      {message && (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-[13px] font-medium ${
            message.ok ? "bg-sage-band text-olive-deep" : "bg-blush text-rose-deep"
          }`}
        >
          {message.text}
        </p>
      )}
      <ul className="mt-3 divide-y divide-hairline">
        {[...meals, blank].map((m) => {
          const translations = [m.name_i18n.es && `Español: ${m.name_i18n.es}`, m.name_i18n.vi && `Tiếng Việt: ${m.name_i18n.vi}`]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={`${m.id}:${m.name}:${m.event_id}`} className="py-3">
              {!m.id && <p className="mb-2 text-[13px] font-semibold text-ink">Add a dish</p>}
              <form action={submit} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={m.id} />
                <input
                  name="name"
                  required
                  maxLength={120}
                  aria-label={m.id ? `Name of ${m.name}` : "Name of the new dish"}
                  defaultValue={m.name}
                  placeholder="For example: Salmon"
                  className={`${field} min-w-0 flex-1 basis-44`}
                />
                <select
                  name="event"
                  aria-label={`Event for ${m.name || "the new dish"}`}
                  defaultValue={m.event_id ?? ""}
                  className={`${field} admin-field`}
                >
                  <option value="">Every event</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} only
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-[13px] text-ink">
                  <input type="checkbox" name="kids" defaultChecked={m.is_kids_meal} className="h-4 w-4 accent-[#3b4823]" />
                  Kids only
                </label>
                <button
                  disabled={pending}
                  className="rounded-lg bg-olive-deep px-3.5 py-2 text-[13px] font-semibold text-cream transition-colors hover:bg-olive-deeper disabled:opacity-50"
                >
                  {m.id ? "Save" : "Add dish"}
                </button>
                {m.id && m.is_active && (
                  <button
                    name="remove"
                    value="true"
                    disabled={pending}
                    className="rounded-lg px-2 py-2 text-[13px] font-medium text-rose-deep underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
                {!m.is_active && <span className="text-[12.5px] text-muted">Hidden from guests</span>}
                {translations && <span className="w-full text-[12px] text-muted">{translations}</span>}
              </form>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
