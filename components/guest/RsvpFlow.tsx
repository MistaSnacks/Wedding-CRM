"use client";

import { useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { saveRsvp, rememberLocale } from "@/app/(guest)/rsvp/h/[token]/actions";
import type { GuestRow, EventRow, MealOptionRow, QuestionRow, ResponseRow, Attending, Locale } from "@/lib/types";
import type { GuestTableInfo } from "@/app/(guest)/rsvp/h/[token]/page";

type Step = "guests" | "extras" | "review" | "confirmed";

type GuestState = {
  byEvent: Record<string, { attending: Attending; mealOptionId: string | null }>;
  dietary: string;
};

type PlusOneState = {
  firstName: string;
  lastName: string;
  byEvent: Record<string, { attending: Attending; mealOptionId: string | null }>;
};

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

export function RsvpFlow(props: {
  token: string;
  locale: string;
  household: { displayName: string; maxPartySize: number; plusOneSlots: number; rsvpStatus: string };
  guests: GuestRow[];
  events: EventRow[];
  meals: MealOptionRow[];
  questions: QuestionRow[];
  responses: ResponseRow[];
  deadline: string | null;
  deadlinePassed: boolean;
  tableInfo: GuestTableInfo;
}) {
  const t = useTranslations("flow");
  const locale = useLocale() as Locale;
  const [step, setStep] = useState<Step>("guests");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const existingPlusOnes = props.guests.filter((g) => g.origin === "plus_one").length;
  const openSlots = Math.max(0, props.household.plusOneSlots - existingPlusOnes);

  const [guestState, setGuestState] = useState<Record<string, GuestState>>(() => {
    const init: Record<string, GuestState> = {};
    for (const g of props.guests) {
      const byEvent: GuestState["byEvent"] = {};
      for (const e of props.events) {
        const r = props.responses.find((r) => r.guest_id === g.id && r.event_id === e.id);
        byEvent[e.id] = { attending: r?.attending ?? "pending", mealOptionId: r?.meal_option_id ?? null };
      }
      init[g.id] = { byEvent, dietary: g.dietary_restrictions ?? "" };
    }
    return init;
  });

  const [plusOnes, setPlusOnes] = useState<PlusOneState[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});

  const deadlineText = useMemo(() => {
    if (!props.deadline) return "";
    return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : locale === "es" ? "es-MX" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(props.deadline));
  }, [props.deadline, locale]);

  const eventNames = props.events.map((e) => e.name).join(t("and"));

  function setAttending(guestId: string, attending: Attending) {
    setGuestState((s) => {
      const next = { ...s[guestId], byEvent: { ...s[guestId].byEvent } };
      for (const e of props.events) {
        next.byEvent[e.id] = { ...next.byEvent[e.id], attending };
      }
      return { ...s, [guestId]: next };
    });
  }

  function setMeal(guestId: string, mealOptionId: string) {
    setGuestState((s) => {
      const next = { ...s[guestId], byEvent: { ...s[guestId].byEvent } };
      for (const e of props.events) next.byEvent[e.id] = { ...next.byEvent[e.id], mealOptionId };
      return { ...s, [guestId]: next };
    });
  }

  function buildPayload(complete: boolean) {
    return {
      responses: props.guests.flatMap((g) =>
        props.events.map((e) => ({
          guest_id: g.id,
          event_id: e.id,
          attending: guestState[g.id].byEvent[e.id].attending,
          meal_option_id: guestState[g.id].byEvent[e.id].mealOptionId,
        })),
      ),
      new_plus_ones: plusOnes
        .filter((p) => p.firstName.trim() && p.lastName.trim())
        .map((p) => ({
          first_name: p.firstName,
          last_name: p.lastName,
          responses: props.events.map((e) => ({
            event_id: e.id,
            attending: (p.byEvent[e.id]?.attending ?? "yes") as Attending,
            meal_option_id: p.byEvent[e.id]?.mealOptionId ?? null,
          })),
        })),
      guest_fields: props.guests.map((g) => ({ guest_id: g.id, dietary_restrictions: guestState[g.id].dietary })),
      answers: props.questions.map((q) => ({
        question_id: q.id,
        value: answers[q.id] ?? null,
      })).filter((a) => a.value !== null && a.value !== ""),
      complete,
    };
  }

  function advance(next: Step, complete = false) {
    setError(null);
    startTransition(async () => {
      const result = await saveRsvp(props.token, buildPayload(complete));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep(next);
      if (complete) window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const anyoneAttending = props.guests.some((g) =>
    props.events.some((e) => guestState[g.id].byEvent[e.id].attending === "yes"),
  );

  if (props.deadlinePassed && props.household.rsvpStatus !== "completed") {
    return (
      <Shell displayName={props.household.displayName} sub={t("deadlinePassed")} eventNames={eventNames} deadlineText="" />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col items-center px-6 pt-10 pb-6">
      <p className="text-[11px] font-medium tracking-[0.28em] text-rose">{t("welcome")}</p>
      <h1 className="font-display mt-2 text-center text-4xl font-medium text-olive-deep">
        {props.household.displayName}
      </h1>
      <p className="mt-2 text-center text-[13.5px] leading-relaxed text-[#5c6151]">
        {t("invitedTo", { events: eventNames })}
        <br />
        {deadlineText && t("deadline", { date: deadlineText })}
      </p>

      {props.tableInfo && step !== "confirmed" && (
        <TableReveal info={props.tableInfo} />
      )}

      <AnimatePresence mode="wait" initial={false}>
        {step === "guests" && (
          <motion.div key="guests" {...stepMotion} className="mt-7 flex w-full flex-col gap-4">
            {props.guests.map((g) => (
              <div key={g.id} className="rounded-2xl border border-[#e7e3d2] bg-white p-5">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-display flex-1 text-xl font-semibold text-olive-deep">
                    {g.first_name} {g.last_name}
                  </h3>
                  <span className="rounded-full bg-sage-band px-2.5 py-1 text-[10.5px] font-semibold tracking-wider text-olive">
                    {t(g.age_type)}
                  </span>
                </div>
                <div className="mt-3.5 flex gap-2">
                  {(["yes", "no"] as const).map((v) => {
                    const active = props.events.every((e) => guestState[g.id].byEvent[e.id].attending === v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setAttending(g.id, v)}
                        className={`flex-1 rounded-[10px] py-3 text-[13.5px] font-semibold transition-all duration-200 active:scale-[0.98] ${
                          active
                            ? v === "yes"
                              ? "bg-olive-deep text-cream"
                              : "bg-rose text-blush"
                            : "border-[1.5px] border-[#d8d4c2] text-[#4a5147] hover:border-rose"
                        }`}
                      >
                        {v === "yes" ? t("attending") : t("declining")}
                      </button>
                    );
                  })}
                </div>
                {props.events.some((e) => guestState[g.id].byEvent[e.id].attending === "yes") && (
                  <div className="mt-4">
                    <p className="text-[11px] font-semibold tracking-widest text-muted">{t("mealLabel")}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {props.meals
                        .filter((m) => (g.age_type === "adult" ? !m.is_kids_meal : true))
                        .map((m) => {
                          const selected = guestState[g.id].byEvent[props.events[0].id]?.mealOptionId === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setMeal(g.id, m.id)}
                              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-colors duration-150 ${
                                selected
                                  ? "bg-olive-deep text-cream"
                                  : "border border-[#d8d4c2] text-[#4a5147] hover:border-rose hover:text-rose"
                              }`}
                            >
                              {m.name}
                            </button>
                          );
                        })}
                    </div>
                    <input
                      value={guestState[g.id].dietary}
                      onChange={(ev) =>
                        setGuestState((s) => ({ ...s, [g.id]: { ...s[g.id], dietary: ev.target.value } }))
                      }
                      placeholder={t("dietaryPlaceholder")}
                      className="mt-3 w-full rounded-[10px] border border-[#ddd9c4] bg-cream px-3.5 py-3 text-[13px] outline-none focus:border-olive"
                    />
                  </div>
                )}
              </div>
            ))}

            {plusOnes.map((p, i) => (
              <div key={i} className="rounded-2xl border border-[#e7e3d2] bg-white p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl font-semibold text-olive-deep">{t("addGuest")}</h3>
                  <button
                    type="button"
                    onClick={() => setPlusOnes((ps) => ps.filter((_, j) => j !== i))}
                    className="text-[12px] font-medium text-rose underline underline-offset-2"
                  >
                    {t("removeGuest")}
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={p.firstName}
                    onChange={(ev) =>
                      setPlusOnes((ps) => ps.map((x, j) => (j === i ? { ...x, firstName: ev.target.value } : x)))
                    }
                    placeholder={t("firstName")}
                    className="w-1/2 rounded-[10px] border border-[#ddd9c4] bg-cream px-3.5 py-3 text-[13px] outline-none focus:border-olive"
                  />
                  <input
                    value={p.lastName}
                    onChange={(ev) =>
                      setPlusOnes((ps) => ps.map((x, j) => (j === i ? { ...x, lastName: ev.target.value } : x)))
                    }
                    placeholder={t("lastName")}
                    className="w-1/2 rounded-[10px] border border-[#ddd9c4] bg-cream px-3.5 py-3 text-[13px] outline-none focus:border-olive"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {props.meals
                    .filter((m) => !m.is_kids_meal)
                    .map((m) => {
                      const selected = p.byEvent[props.events[0]?.id]?.mealOptionId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setPlusOnes((ps) =>
                              ps.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      byEvent: Object.fromEntries(
                                        props.events.map((e) => [e.id, { attending: "yes" as Attending, mealOptionId: m.id }]),
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                          className={`whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-colors ${
                            selected
                              ? "bg-olive-deep text-cream"
                              : "border border-[#d8d4c2] text-[#4a5147] hover:border-rose hover:text-rose"
                          }`}
                        >
                          {m.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}

            {plusOnes.length < openSlots && (
              <button
                type="button"
                onClick={() =>
                  setPlusOnes((ps) => [
                    ...ps,
                    {
                      firstName: "",
                      lastName: "",
                      byEvent: Object.fromEntries(
                        props.events.map((e) => [e.id, { attending: "yes" as Attending, mealOptionId: null }]),
                      ),
                    },
                  ])
                }
                className="flex items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-[#c68e86] p-4 text-left transition-colors hover:bg-blush/50"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blush text-xl font-light text-rose">
                  +
                </span>
                <span>
                  <span className="block text-[14.5px] font-semibold text-olive-deep">{t("addGuest")}</span>
                  <span className="block text-[12.5px] text-rose">
                    {openSlots === 1 ? t("plusOneNote") : t("plusOneNotes", { count: openSlots })}
                  </span>
                </span>
              </button>
            )}

            {error && <p className="text-center text-sm text-rose">{error}</p>}
            <button
              type="button"
              disabled={pending}
              onClick={() => advance(props.questions.length ? "extras" : "review")}
              className="mt-2 w-full rounded-xl bg-olive-deep py-4 text-[15px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none"
            >
              {pending ? "…" : props.questions.length ? t("questionsLeft", { count: props.questions.length }) : t("continue")}
            </button>
            <p className="text-center text-xs text-[#75796a]">{t("autosave")}</p>
          </motion.div>
        )}

        {step === "extras" && (
          <motion.div key="extras" {...stepMotion} className="mt-7 flex w-full flex-col gap-4">
            <h2 className="font-display text-center text-2xl font-semibold text-olive-deep">{t("extrasTitle")}</h2>
            {props.questions.map((q) => (
              <div key={q.id} className="rounded-2xl border border-[#e7e3d2] bg-white p-5">
                <p className="text-[14px] font-medium text-ink">{q.label[locale] ?? q.label.en}</p>
                {q.type === "boolean" ? (
                  <div className="mt-3 flex gap-2">
                    {[true, false].map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                        className={`flex-1 rounded-[10px] py-2.5 text-[13.5px] font-semibold transition-colors ${
                          answers[q.id] === v
                            ? "bg-olive-deep text-cream"
                            : "border-[1.5px] border-[#d8d4c2] text-[#4a5147] hover:border-rose"
                        }`}
                      >
                        {v ? t("yes") : t("no")}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    value={(answers[q.id] as string) ?? ""}
                    onChange={(ev) => setAnswers((a) => ({ ...a, [q.id]: ev.target.value }))}
                    placeholder={t("answerPlaceholder")}
                    className="mt-3 w-full rounded-[10px] border border-[#ddd9c4] bg-cream px-3.5 py-3 text-[13px] outline-none focus:border-olive"
                  />
                )}
              </div>
            ))}
            {error && <p className="text-center text-sm text-rose">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("guests")}
                className="rounded-xl border-[1.5px] border-[#d8d4c2] px-6 py-4 text-[15px] font-medium text-[#4a5147] transition-colors hover:border-rose hover:text-rose"
              >
                {t("back")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => advance("review")}
                className="flex-1 rounded-xl bg-olive-deep py-4 text-[15px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none"
              >
                {pending ? "…" : t("continue")}
              </button>
            </div>
          </motion.div>
        )}

        {step === "review" && (
          <motion.div key="review" {...stepMotion} className="mt-7 flex w-full flex-col gap-4">
            <h2 className="font-display text-center text-2xl font-semibold text-olive-deep">{t("reviewTitle")}</h2>
            <div className="rounded-2xl border border-[#e7e3d2] bg-white p-5">
              {props.guests.map((g) => {
                const attending = props.events.some((e) => guestState[g.id].byEvent[e.id].attending === "yes");
                const mealId = guestState[g.id].byEvent[props.events[0]?.id]?.mealOptionId;
                const meal = props.meals.find((m) => m.id === mealId);
                return (
                  <div key={g.id} className="flex items-center justify-between border-b border-[#f1f0ea] py-3 last:border-0">
                    <span className="text-[14px] font-medium text-ink">
                      {g.first_name} {g.last_name}
                    </span>
                    <span className={`text-[13px] font-medium ${attending ? "text-olive" : "text-rose"}`}>
                      {attending ? `${t("reviewAttending")}${meal ? ` · ${meal.name}` : ` · ${t("reviewNoMeal")}`}` : t("reviewDeclining")}
                    </span>
                  </div>
                );
              })}
              {plusOnes
                .filter((p) => p.firstName.trim())
                .map((p, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-[#f1f0ea] py-3 last:border-0">
                    <span className="text-[14px] font-medium text-ink">
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="text-[13px] font-medium text-olive">{t("reviewAttending")}</span>
                  </div>
                ))}
            </div>
            {error && <p className="text-center text-sm text-rose">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("guests")}
                className="rounded-xl border-[1.5px] border-[#d8d4c2] px-6 py-4 text-[15px] font-medium text-[#4a5147] transition-colors hover:border-rose hover:text-rose"
              >
                {t("back")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => advance("confirmed", true)}
                className="flex-1 rounded-xl bg-olive-deep py-4 text-[15px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none"
              >
                {pending ? "…" : t("submit")}
              </button>
            </div>
          </motion.div>
        )}

        {step === "confirmed" && (
          <motion.div
            key="confirmed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={spring}
            className="mt-10 flex w-full flex-col items-center gap-3 text-center"
          >
            <Petals />
            <h2 className="font-display text-4xl font-medium text-olive-deep">{t("confirmedTitle")}</h2>
            <p className="max-w-[300px] text-[14px] leading-relaxed text-[#5c6151]">
              {anyoneAttending ? t("confirmedBody") : t("confirmedBody")}
            </p>
            {deadlineText && (
              <p className="text-[12.5px] text-[#75796a]">{t("confirmedEdit", { date: deadlineText })}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <LocaleSaver token={props.token} />
    </div>
  );
}

const stepMotion = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: spring,
};

function Shell(props: { displayName: string; sub: string; eventNames: string; deadlineText: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col items-center px-6 pt-16 text-center">
      <h1 className="font-display text-4xl font-medium text-olive-deep">{props.displayName}</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-[#5c6151]">{props.sub}</p>
    </div>
  );
}

function TableReveal({ info }: { info: NonNullable<GuestTableInfo> }) {
  const t = useTranslations("flow");
  const shown = info.mates.slice(0, 4);
  const extra = info.mates.length - shown.length;
  return (
    <div className="mt-6 w-full rounded-2xl border border-[#e7e3d2] bg-white p-5 text-center">
      <p className="text-[10.5px] font-semibold tracking-[0.18em] text-rose">{t("yourTable")}</p>
      <p className="font-display mt-1 text-2xl font-medium text-olive-deep">
        {t("yourTableTitle", { name: info.guestName, table: info.tableName })}
      </p>
      {shown.length > 0 && (
        <>
          <p className="mt-3 text-[10.5px] font-semibold tracking-widest text-muted">{t("seatedWith")}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {shown.map((m, i) => (
              <span key={i} className="rounded-full bg-cream px-3 py-1.5 text-[12px] font-medium text-olive-deep">
                {m.first_name} {m.last_name}
              </span>
            ))}
            {extra > 0 && (
              <span className="rounded-full border border-dashed border-[#d8d4c2] px-3 py-1.5 text-[12px] text-[#75796a]">
                {t("more", { count: extra })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One-time drifting petals on the confirmation screen (skipped under reduced motion). */
function Petals() {
  const petals = [0, 1, 2, 3, 4, 5];
  return (
    <div aria-hidden className="pointer-events-none relative h-0 w-full motion-reduce:hidden">
      {petals.map((i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: -30, x: (i - 2.5) * 44, rotate: 0 }}
          animate={{ opacity: [0, 1, 1, 0], y: 130, rotate: i % 2 ? 100 : -80 }}
          transition={{ duration: 2.6 + i * 0.25, delay: i * 0.12, ease: "easeInOut" }}
          className="absolute left-1/2 top-0 block h-3 w-2.5 rounded-full"
          style={{ backgroundColor: i % 2 ? "#C68E86" : "#E9B7AC", borderRadius: "60% 40% 55% 45%" }}
        />
      ))}
    </div>
  );
}

function LocaleSaver({ token }: { token: string }) {
  const locale = useLocale();
  const [saved, setSaved] = useState<string | null>(null);
  if (saved !== locale) {
    setSaved(locale);
    void rememberLocale(token, locale);
  }
  return null;
}
