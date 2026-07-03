import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import type { ResponseRow, MealOptionRow, EventRow, SeatAssignmentRow, SeatingTableRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MealsPage() {
  const scope = defaultScope();
  const [hhs, { data: responses }, { data: meals }, { data: events }, { data: seats }, { data: tables }] =
    await Promise.all([
      households.list(scope),
      scope.db.from("guest_event_responses").select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via").eq("wedding_id", scope.weddingId),
      scope.db.from("meal_options").select("id, name, is_kids_meal, sort_order, event_id").eq("wedding_id", scope.weddingId).order("sort_order"),
      scope.db.from("events").select("id, name, starts_at, venue_name, rsvp_enabled, seating_published_at, sort_order").eq("wedding_id", scope.weddingId).order("sort_order"),
      scope.db.from("seat_assignments").select("guest_id, event_id, table_id, seat_number").eq("wedding_id", scope.weddingId),
      scope.db.from("seating_tables").select("id, event_id, name, capacity, shape, pos_x, pos_y").eq("wedding_id", scope.weddingId),
    ]);

  const rs = (responses ?? []) as ResponseRow[];
  const guests = hhs.flatMap((h) => h.guests.map((g) => ({ ...g, household: h.display_name })));
  const tableOf = (guestId: string) => {
    const seat = ((seats ?? []) as SeatAssignmentRow[]).find((s) => s.guest_id === guestId);
    return seat ? ((tables ?? []) as SeatingTableRow[]).find((t) => t.id === seat.table_id)?.name ?? "—" : "—";
  };

  const missing = guests.filter((g) =>
    rs.some((r) => r.guest_id === g.id && r.attending === "yes" && !r.meal_option_id),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold text-ink">Meals</h1>
          <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
            Tracked per guest · {missing.length} attending guests still missing a meal
          </p>
        </div>
        <a
          href="/api/export/caterer"
          className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
        >
          Caterer export
        </a>
      </div>

      {((events ?? []) as EventRow[]).map((event) => {
        const eventResponses = rs.filter((r) => r.event_id === event.id && r.attending === "yes");
        return (
          <div key={event.id} className="rounded-xl border border-hairline p-5">
            <h2 className="text-[14.5px] font-semibold text-ink">
              {event.name} <span className="font-normal text-muted">· {eventResponses.length} attending</span>
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              {((meals ?? []) as MealOptionRow[]).map((m) => {
                const chosen = eventResponses.filter((r) => r.meal_option_id === m.id);
                if (!chosen.length && m.event_id && m.event_id !== event.id) return null;
                return (
                  <details key={m.id} className="group rounded-[10px] border border-[#f1f0ea] px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <span className="w-28 text-[13.5px] font-medium text-ink">{m.name}</span>
                      <span className="h-1.5 flex-1 rounded-full bg-[#f0efe3]">
                        <span
                          className="block h-1.5 rounded-full bg-olive"
                          style={{ width: `${Math.min(100, (chosen.length / Math.max(1, eventResponses.length)) * 100)}%` }}
                        />
                      </span>
                      <span className="w-8 text-right text-[14px] font-semibold text-ink">{chosen.length}</span>
                    </summary>
                    <div className="mt-2.5 flex flex-col gap-1 border-t border-[#f1f0ea] pt-2.5">
                      {chosen.map((r) => {
                        const g = guests.find((x) => x.id === r.guest_id);
                        if (!g) return null;
                        return (
                          <div key={r.guest_id} className="flex items-center gap-3 text-[12.5px]">
                            <span className="w-44 font-medium text-ink">{g.first_name} {g.last_name}</span>
                            <span className="w-24 text-muted">{tableOf(g.id)}</span>
                            <span className="text-rose-deep">
                              {[g.dietary_restrictions, g.allergies].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                        );
                      })}
                      {!chosen.length && <p className="text-[12.5px] text-muted">No one yet.</p>}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        );
      })}

      {missing.length > 0 && (
        <div className="rounded-xl border border-blush-border bg-blush p-5">
          <h2 className="text-[14.5px] font-semibold text-rose-deep">Missing meal choices</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((g) => (
              <a
                key={g.id}
                href={`/admin/guests/${g.household_id}`}
                className="rounded-full bg-white px-3 py-1.5 text-[12.5px] font-medium text-rose-deep hover:text-rose"
              >
                {g.first_name} {g.last_name}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
