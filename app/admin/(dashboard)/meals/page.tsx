import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { loadReportData, buildGuestReport } from "@/lib/reports/guest-reports";
import { MenuEditor } from "@/components/admin/MenuEditor";

export const dynamic = "force-dynamic";

/** The report marks gaps in capitals for spreadsheets; on screen they read as sentences. */
const NO_MEAL = "MISSING";
const NO_TABLE = "UNASSIGNED";

export default async function MealsPage() {
  const admin = await requireAdmin();
  const data = await loadReportData(forWedding(admin.weddingId));
  const householdOf = new Map(data.hhs.flatMap((h) => h.guests.map((g) => [g.id, h.id] as const)));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">Meals</h1>
        <p className="mt-0.5 text-[13.5px] text-muted">
          What each guest who is coming will eat, for each event. This is the list your caterer needs.
        </p>
      </div>

      {data.events.map((event) => {
        const rows = buildGuestReport(data, "caterer", event.id).rows;
        const counts = buildGuestReport(data, "meals", event.id).rows.map((r) => ({
          meal: String(r.Meal),
          count: Number(r.Count),
        }));
        const missing = counts.find((c) => c.meal === NO_MEAL)?.count ?? 0;
        const chosen = counts.filter((c) => c.meal !== NO_MEAL).sort((a, b) => b.count - a.count);
        const max = Math.max(1, ...counts.map((c) => c.count));
        const sorted = [...rows].sort(
          (a, b) => Number(b.Meal === NO_MEAL) - Number(a.Meal === NO_MEAL) || String(a.Guest).localeCompare(String(b.Guest)),
        );
        return (
          <section
            key={event.id}
            aria-labelledby={`meals-${event.id}`}
            className="rounded-2xl border border-hairline bg-white/75 p-5 max-md:p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 basis-56">
                <h2 id={`meals-${event.id}`} className="font-display text-2xl font-medium text-olive-deep">
                  {event.name}
                </h2>
                <p className="text-[13px] text-muted">
                  {rows.length} {rows.length === 1 ? "guest is" : "guests are"} coming
                  {missing > 0 && (
                    <span className="font-medium text-rose-deep">
                      {" "}
                      · {missing} still {missing === 1 ? "needs" : "need"} a meal
                    </span>
                  )}
                </p>
              </div>
              <a
                href={`/api/export/caterer?event=${event.id}&format=xlsx`}
                className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-olive hover:text-olive-deep"
              >
                Download for the caterer
              </a>
            </div>

            {rows.length === 0 ? (
              <p className="mt-4 rounded-xl bg-paper p-4 text-[13.5px] text-muted">
                No one has said yes to {event.name} yet. Meal choices appear here as replies come in.
              </p>
            ) : (
              <>
                <div className="mt-4 grid max-w-xl gap-2.5">
                  {chosen.map((c) => (
                    <div key={c.meal} className="flex items-center gap-3">
                      <span className="w-36 shrink-0 text-[13px] font-medium text-ink">{c.meal}</span>
                      <span className="h-1.5 flex-1 rounded-full bg-[#f0efe3]">
                        <span className="block h-1.5 rounded-full bg-olive" style={{ width: `${(c.count / max) * 100}%` }} />
                      </span>
                      <span className="w-7 shrink-0 text-right text-[13px] font-semibold text-ink">{c.count}</span>
                    </div>
                  ))}
                  {missing > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="w-36 shrink-0 text-[13px] font-medium text-rose-deep">No meal yet</span>
                      <span className="h-1.5 flex-1 rounded-full bg-[#f0efe3]">
                        <span className="block h-1.5 rounded-full bg-rose" style={{ width: `${(missing / max) * 100}%` }} />
                      </span>
                      <span className="w-7 shrink-0 text-right text-[13px] font-semibold text-rose-deep">{missing}</span>
                    </div>
                  )}
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[13.5px]">
                    <thead>
                      <tr className="border-b border-hairline text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                        <th scope="col" className="py-2 pr-4 font-semibold">Guest</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Meal</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Table</th>
                        <th scope="col" className="py-2 font-semibold">Dietary notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {sorted.map((r) => {
                        const guestId = String(r["Guest ID"]);
                        const noMeal = r.Meal === NO_MEAL;
                        const noTable = r.Table === NO_TABLE;
                        return (
                          <tr key={guestId}>
                            <td className="py-2.5 pr-4">
                              <Link
                                href={`/admin/guests/${householdOf.get(guestId) ?? ""}`}
                                className="font-medium text-ink underline decoration-[#cfd3c4] underline-offset-2 hover:text-olive-deep hover:decoration-olive"
                              >
                                {r.Guest}
                              </Link>
                              {r["Age Type"] !== "adult" && (
                                <span className="ml-2 text-[12px] capitalize text-muted">{r["Age Type"]}</span>
                              )}
                            </td>
                            <td className={`py-2.5 pr-4 ${noMeal ? "font-medium text-rose-deep" : "text-ink"}`}>
                              {noMeal ? "No meal yet" : r.Meal}
                            </td>
                            <td className={`py-2.5 pr-4 ${noTable ? "text-muted" : "text-ink"}`}>
                              {noTable ? "No table yet" : r.Table}
                            </td>
                            <td className="break-words py-2.5 text-rose-deep">{r.Dietary}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[12.5px] text-muted">
                  To choose a meal for someone, open their name. Guests can also change their own meal from their RSVP
                  link until replies close.
                </p>
              </>
            )}
          </section>
        );
      })}

      {admin.role !== "viewer" && <MenuEditor meals={data.meals} events={data.events} />}
    </div>
  );
}
