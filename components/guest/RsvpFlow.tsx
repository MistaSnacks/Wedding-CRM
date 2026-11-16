"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { saveRsvp } from "@/app/(guest)/rsvp/h/[token]/actions";
import { eligibleMeals, type GuestRsvpDto } from "@/lib/domain/rsvp-validation";
import { mealName } from "@/lib/domain/meal-name";
import type {
  EventRow,
  MealOptionRow,
  QuestionRow,
  ResponseRow,
  Attending,
} from "@/lib/types";
import type { GuestTableInfo } from "@/app/(guest)/rsvp/h/[token]/page";

type Person = GuestRsvpDto & {
  draft?: boolean;
  responses: Record<
    string,
    { attending: Attending; meal_option_id: string | null }
  >;
};
type Step = "guests" | "meals" | "extras" | "review" | "confirmed";
const input =
  "w-full rounded-lg border border-[#d8d4c2] bg-white px-3 py-2 text-sm";
const button =
  "rounded-xl bg-olive-deep px-5 py-3 text-sm font-semibold text-cream disabled:opacity-50";
function hydrate(
  guests: GuestRsvpDto[],
  responses: ResponseRow[],
  events: EventRow[],
): Person[] {
  return guests.map((g) => ({
    ...g,
    responses: Object.fromEntries(
      events.map((e) => {
        const r = responses.find(
          (r) => r.guest_id === g.id && r.event_id === e.id,
        );
        return [
          e.id,
          {
            attending: r?.attending ?? "pending",
            meal_option_id: r?.meal_option_id ?? null,
          },
        ];
      }),
    ),
  }));
}
export function RsvpFlow(props: {
  token: string;
  locale: string;
  household: {
    displayName: string;
    maxPartySize: number;
    plusOneSlots: number;
    rsvpStatus: string;
  };
  guests: GuestRsvpDto[];
  events: EventRow[];
  meals: MealOptionRow[];
  questions: QuestionRow[];
  responses: ResponseRow[];
  answers: Array<{ question_id: string; value: string | boolean }>;
  deadline: string | null;
  deadlinePassed: boolean;
  timeZone: string;
  tables: GuestTableInfo[];
}) {
  const t = useTranslations("flow");
  const locale = useLocale();
  const [people, setPeople] = useState(() =>
    hydrate(props.guests, props.responses, props.events),
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(props.answers.map((a) => [a.question_id, a.value])),
  );
  const [step, setStep] = useState<Step>("guests");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(props.household.rsvpStatus);
  const deadline = props.deadline
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeZone: props.timeZone,
      }).format(new Date(props.deadline))
    : "";
  const closed = props.deadlinePassed;
  const hasMeals = people.some((g) =>
    props.events.some(
      (e) =>
        g.responses[e.id]?.attending === "yes" &&
        eligibleMeals(props.meals, e.id, g.age_type).length,
    ),
  );
  function patch(id: string, value: Partial<Person>) {
    setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...value } : p)));
  }
  function answer(
    g: Person,
    e: EventRow,
    attending: Attending,
    meal = g.responses[e.id]?.meal_option_id ?? null,
  ) {
    patch(g.id, {
      responses: {
        ...g.responses,
        [e.id]: {
          attending,
          meal_option_id: attending === "yes" ? meal : null,
        },
      },
    });
  }
  function remove(g: Person) {
    if (!g.draft) setRemoved((ids) => [...ids, g.id]);
    setPeople((ps) => ps.filter((p) => p.id !== g.id));
  }
  function add() {
    const id = crypto.randomUUID();
    setPeople((ps) => [
      ...ps,
      {
        id,
        rsvp_client_id: id,
        draft: true,
        first_name: "",
        last_name: "",
        age_type: "adult",
        origin: "plus_one",
        dietary_restrictions: "",
        allergies: "",
        responses: Object.fromEntries(
          props.events.map((e) => [
            e.id,
            { attending: "pending" as Attending, meal_option_id: null },
          ]),
        ),
      },
    ]);
  }
  function save(next: Step, complete = false) {
    setError(null);
    if (people.some((g) => !g.first_name.trim() || !g.last_name.trim())) {
      setError("empty_name");
      return;
    }
    const responseFor = (g: Person) =>
      props.events.map((e) => ({ event_id: e.id, ...g.responses[e.id] }));
    startTransition(async () => {
      try {
        const result = await saveRsvp(props.token, {
          responses: people
            .filter((g) => g.origin === "named")
            .flatMap((g) =>
              responseFor(g).map((r) => ({ ...r, guest_id: g.id })),
            ),
          new_plus_ones: people
            .filter((g) => g.origin === "plus_one")
            .map((g) => ({
              guest_id: g.draft ? undefined : g.id,
              client_id: g.rsvp_client_id ?? undefined,
              first_name: g.first_name,
              last_name: g.last_name,
              responses: responseFor(g),
            })),
          remove_plus_one_ids: removed,
          guest_fields: people
            .filter((g) => !g.draft)
            .map((g) => ({
              guest_id: g.id,
              dietary_restrictions: g.dietary_restrictions ?? "",
              allergies: g.allergies ?? "",
            })),
          answers: props.questions
            .filter((q) => answers[q.id] !== undefined)
            .map((q) => ({ question_id: q.id, value: answers[q.id] })),
          complete,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPeople(hydrate(result.guests, result.responses, props.events));
        setRemoved([]);
        setStatus(result.status);
        if (complete && !["completed", "declined"].includes(result.status)) {
          setError("incomplete_rsvp");
          return;
        }
        setStep(next);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        setError("unknown");
      }
    });
  }
  function summary() {
    return (
      <div className="flex flex-col gap-4">
        {people.map((g) => (
          <section
            key={g.id}
            className="rounded-xl border border-[#e7e3d2] bg-white p-4"
          >
            <h3 className="font-display text-xl font-semibold">
              {g.first_name} {g.last_name}
            </h3>
            {props.events.map((e) => {
              const r = g.responses[e.id];
              return (
                <div
                  key={e.id}
                  className="mt-3 border-t border-hairline pt-2 text-sm"
                >
                  <p className="font-semibold">{e.name}</p>
                  <p>
                    {r?.attending === "yes"
                      ? t("reviewAttending")
                      : r?.attending === "no"
                        ? t("reviewDeclining")
                        : t("reviewPending")}
                  </p>
                  {r?.attending === "yes" &&
                    eligibleMeals(props.meals, e.id, g.age_type).length > 0 && (
                      <p>
                        {mealName(
                          props.meals.find((m) => m.id === r.meal_option_id),
                          locale,
                        ) ?? t("reviewNoMeal")}
                      </p>
                    )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-xl px-5 py-10 text-olive-deep">
      <p className="text-center text-xs font-semibold tracking-widest text-rose">
        {t("welcome")}
      </p>
      <h1 className="font-display mt-2 text-center text-4xl">
        {props.household.displayName}
      </h1>
      <div className="my-5 space-y-2 text-center text-sm">
        {props.events.map((e) => (
          <div key={e.id}>
            <strong>{e.name}</strong>
            {e.starts_at && (
              // Node and browsers join a Spanish date and time differently.
              <p suppressHydrationWarning>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "long",
                  timeStyle: "short",
                  timeZone: props.timeZone,
                }).format(new Date(e.starts_at))}
              </p>
            )}
            {e.venue_name && <p>{e.venue_name}</p>}
            {e.venue_address && <p>{e.venue_address}</p>}
            {e.dress_code && <p>{e.dress_code}</p>}
          </div>
        ))}
        {deadline && !closed && <p>{t("deadline", { date: deadline })}</p>}
      </div>
      {props.events.some((e) => e.starts_at) && (
        <a
          href={`/rsvp/h/${encodeURIComponent(props.token)}/calendar`}
          className="mb-5 block text-center text-sm underline"
        >
          {t("addCalendar")}
        </a>
      )}
      {props.tables.length > 0 && (
        <section className="mb-6 rounded-xl border border-hairline bg-white p-4">
          <h2 className="font-display text-2xl">{t("yourTable")}</h2>
          {props.tables.map((table, i) => (
            <div key={i} className="mt-3 text-sm">
              <strong>{table.eventName}</strong>
              <p>
                {t("yourTableTitle", {
                  name: table.guestName,
                  table: table.tableName,
                })}
              </p>
              {table.mates.length > 0 && (
                <p className="mt-1">
                  {t("seatedWith")}:{" "}
                  {table.mates
                    .map((m) => `${m.first_name} ${m.last_name}`)
                    .join(", ")}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      {closed ? (
        <>
          <p className="mb-5 rounded-xl bg-paper p-4 text-sm">
            {t("deadlinePassed")}
          </p>
          {summary()}
        </>
      ) : step === "confirmed" ? (
        <>
          <h2 className="font-display text-center text-3xl">
            {t("confirmedTitle")}
          </h2>
          <p className="my-4 text-center text-sm">
            {status === "declined" ? t("declinedBody") : t("confirmedBody")}
          </p>
          {summary()}
          <button
            className={`${button} mt-5`}
            onClick={() => setStep("guests")}
          >
            {t("editResponse")}
          </button>
        </>
      ) : (
        <fieldset disabled={pending} className="space-y-4">
          {step === "guests" && (
            <>
              {people.map((g) => (
                <section
                  key={g.id}
                  className="rounded-xl border border-hairline bg-white p-4"
                >
                  {g.origin === "plus_one" ? (
                    <div className="space-y-2">
                      <label className="block text-sm">
                        {t("firstName")}
                        <input
                          className={input}
                          value={g.first_name}
                          maxLength={120}
                          onChange={(e) =>
                            patch(g.id, { first_name: e.target.value })
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        {t("lastName")}
                        <input
                          className={input}
                          value={g.last_name}
                          maxLength={120}
                          onChange={(e) =>
                            patch(g.id, { last_name: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="text-sm text-rose underline"
                        onClick={() => remove(g)}
                      >
                        {t("removeGuest")}
                      </button>
                    </div>
                  ) : (
                    <h2 className="font-display text-2xl">
                      {g.first_name} {g.last_name}
                    </h2>
                  )}
                  {props.events.map((e) => (
                    <div key={e.id} className="mt-4">
                      <p className="mb-2 text-sm font-semibold">{e.name}</p>
                      <div
                        className="flex gap-2"
                        role="group"
                        aria-label={`${g.first_name} — ${e.name}`}
                      >
                        {(["yes", "no"] as const).map((v) => (
                          <button
                            key={v}
                            aria-pressed={g.responses[e.id]?.attending === v}
                            onClick={() => answer(g, e, v)}
                            className={`flex-1 rounded-lg border p-3 text-sm ${g.responses[e.id]?.attending === v ? "bg-olive-deep text-cream" : "border-hairline"}`}
                          >
                            {t(v === "yes" ? "attending" : "declining")}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
              {people.length < props.household.maxPartySize &&
                people.filter((g) => g.origin === "plus_one").length <
                  props.household.plusOneSlots && (
                  <button
                    className="w-full rounded-xl border border-dashed border-rose p-4 text-sm"
                    onClick={add}
                  >
                    {t("addGuest")}
                  </button>
                )}
              <button
                className={`${button} w-full`}
                onClick={() =>
                  save(
                    hasMeals
                      ? "meals"
                      : props.questions.length
                        ? "extras"
                        : "review",
                  )
                }
              >
                {t("continue")}
              </button>
              <p className="text-center text-xs">{t("autosave")}</p>
            </>
          )}
          {step === "meals" && (
            <>
              <h2 className="font-display text-2xl">{t("mealsTitle")}</h2>
              {people.map((g) => (
                <section
                  key={g.id}
                  className="rounded-xl border border-hairline bg-white p-4"
                >
                  <h3 className="font-display text-xl">
                    {g.first_name} {g.last_name}
                  </h3>
                  {props.events
                    .filter(
                      (e) =>
                        g.responses[e.id]?.attending === "yes" &&
                        eligibleMeals(props.meals, e.id, g.age_type).length,
                    )
                    .map((e) => (
                      <label key={e.id} className="mt-3 block text-sm">
                        {e.name}
                        <select
                          className={input}
                          value={g.responses[e.id]?.meal_option_id ?? ""}
                          onChange={(ev) =>
                            answer(g, e, "yes", ev.target.value || null)
                          }
                        >
                          <option value="">{t("reviewNoMeal")}</option>
                          {eligibleMeals(props.meals, e.id, g.age_type)
                            .filter(
                              (m) =>
                                m.is_active ||
                                m.id === g.responses[e.id]?.meal_option_id,
                            )
                            .map((m) => (
                              <option value={m.id} key={m.id}>
                                {mealName(m, locale)}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                  <label className="mt-3 block text-sm">
                    {t("dietaryPlaceholder")}
                    <textarea
                      className={input}
                      value={g.dietary_restrictions ?? ""}
                      maxLength={2000}
                      onChange={(e) =>
                        patch(g.id, { dietary_restrictions: e.target.value })
                      }
                    />
                  </label>
                </section>
              ))}
              <button
                className={button}
                onClick={() =>
                  save(props.questions.length ? "extras" : "review")
                }
              >
                {t("continue")}
              </button>
              <button
                className="ml-4 underline"
                onClick={() => setStep("guests")}
              >
                {t("back")}
              </button>
            </>
          )}
          {step === "extras" && (
            <>
              {props.questions.map((q) => (
                <label className="block text-sm" key={q.id}>
                  {q.label[locale as "en" | "es" | "vi"] ?? q.label.en}
                  {q.type === "boolean" ? (
                    <select
                      className={input}
                      value={
                        answers[q.id] === undefined ? "" : String(answers[q.id])
                      }
                      onChange={(e) =>
                        setAnswers((a) => ({
                          ...a,
                          [q.id]: e.target.value === "true",
                        }))
                      }
                    >
                      <option value="">—</option>
                      <option value="true">{t("yes")}</option>
                      <option value="false">{t("no")}</option>
                    </select>
                  ) : q.type === "select" ? (
                    <select
                      className={input}
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) =>
                        setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                      }
                    >
                      <option value="">—</option>
                      {(Array.isArray(q.options) ? q.options : [])
                        .filter((x) => typeof x === "string")
                        .map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                    </select>
                  ) : (
                    <textarea
                      className={input}
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) =>
                        setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
              <button className={button} onClick={() => save("review")}>
                {t("continue")}
              </button>
            </>
          )}
          {step === "review" && (
            <>
              <h2 className="font-display text-2xl">{t("reviewTitle")}</h2>
              {summary()}
              <button
                className={`${button} w-full`}
                onClick={() => save("confirmed", true)}
              >
                {t("submit")}
              </button>
              <button className="underline" onClick={() => setStep("guests")}>
                {t("back")}
              </button>
            </>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose bg-white p-3 text-sm text-rose"
            >
              {t.has(`errors.${error}`)
                ? t(`errors.${error}`)
                : t("errors.unknown")}
            </p>
          )}
          {pending && (
            <p role="status" className="text-sm">
              …
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
