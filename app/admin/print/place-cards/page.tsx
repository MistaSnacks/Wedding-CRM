import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import type { SeatAssignmentRow, SeatingTableRow, ResponseRow, MealOptionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Place cards: name + seat + meal marker, grouped by table. */
export default async function PlaceCardsPage() {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const [hhs, { data: seats }, { data: tables }, { data: responses }, { data: meals }] = await Promise.all([
    households.list(scope),
    scope.db.from("seat_assignments").select("guest_id, event_id, table_id, seat_number").eq("wedding_id", scope.weddingId),
    scope.db.from("seating_tables").select("id, event_id, name, capacity, shape, pos_x, pos_y").eq("wedding_id", scope.weddingId),
    scope.db.from("guest_event_responses").select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via").eq("wedding_id", scope.weddingId),
    scope.db.from("meal_options").select("id, name, is_kids_meal, sort_order, event_id").eq("wedding_id", scope.weddingId),
  ]);

  const guests = hhs.flatMap((h) => h.guests);
  const byTable = new Map<string, Array<{ name: string; meal: string; seat: number | null }>>();
  for (const s of (seats ?? []) as SeatAssignmentRow[]) {
    const g = guests.find((x) => x.id === s.guest_id);
    const t = ((tables ?? []) as SeatingTableRow[]).find((x) => x.id === s.table_id);
    if (!g || !t) continue;
    const mealId = ((responses ?? []) as ResponseRow[]).find((r) => r.guest_id === g.id && r.meal_option_id)?.meal_option_id;
    const meal = ((meals ?? []) as MealOptionRow[]).find((m) => m.id === mealId)?.name ?? "";
    if (!byTable.has(t.name)) byTable.set(t.name, []);
    byTable.get(t.name)!.push({ name: `${g.first_name} ${g.last_name}`, meal, seat: s.seat_number });
  }

  const sorted = [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="bg-white p-8">
      <div className="no-print mb-6 flex items-center gap-3">
        <h1 className="flex-1 text-lg font-semibold text-ink">Place cards</h1>
        <p className="text-sm text-muted">Print (⌘P) → Save as PDF</p>
      </div>
      {sorted.map(([tableName, cards]) => (
        <div key={tableName} className="mb-8" style={{ breakInside: "avoid" }}>
          <h2 className="no-print mb-3 text-sm font-semibold tracking-wider text-muted uppercase">{tableName}</h2>
          <div className="grid grid-cols-4 gap-4">
            {cards.map((c, i) => (
              <div
                key={i}
                className="flex aspect-[3.5/2] flex-col items-center justify-center gap-1 rounded border border-[#d8d4c2] p-4 text-center"
                style={{ breakInside: "avoid" }}
              >
                <span className="font-display text-lg font-medium text-olive-deep">{c.name}</span>
                <span className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
                  {tableName}
                  {c.seat ? ` · Seat ${c.seat}` : ""}
                </span>
                {c.meal && <span className="text-[10px] font-medium text-rose">{c.meal}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
