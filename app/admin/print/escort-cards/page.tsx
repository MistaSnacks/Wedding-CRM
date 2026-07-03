import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import type { SeatAssignmentRow, SeatingTableRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Escort cards: guest name + table. Print with browser → Save as PDF. */
export default async function EscortCardsPage() {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const [hhs, { data: seats }, { data: tables }] = await Promise.all([
    households.list(scope),
    scope.db.from("seat_assignments").select("guest_id, event_id, table_id, seat_number").eq("wedding_id", scope.weddingId),
    scope.db.from("seating_tables").select("id, event_id, name, capacity, shape, pos_x, pos_y").eq("wedding_id", scope.weddingId),
  ]);

  const cards = hhs
    .flatMap((h) => h.guests)
    .map((g) => {
      const seat = ((seats ?? []) as SeatAssignmentRow[]).find((s) => s.guest_id === g.id);
      const table = seat ? ((tables ?? []) as SeatingTableRow[]).find((t) => t.id === seat.table_id) : null;
      return table ? { name: `${g.first_name} ${g.last_name}`, table: table.name } : null;
    })
    .filter(Boolean) as Array<{ name: string; table: string }>;

  cards.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="bg-white p-8">
      <div className="no-print mb-6 flex items-center gap-3">
        <h1 className="flex-1 text-lg font-semibold text-ink">Escort cards — {cards.length} guests</h1>
        <p className="text-sm text-muted">Use your browser&apos;s Print (⌘P) → Save as PDF</p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div
            key={i}
            className="flex aspect-[3.5/2] flex-col items-center justify-center gap-1 rounded border border-[#d8d4c2] p-4 text-center"
            style={{ breakInside: "avoid" }}
          >
            <span className="font-display text-lg font-medium text-olive-deep">{c.name}</span>
            <span className="text-[11px] font-semibold tracking-[0.14em] text-rose uppercase">{c.table}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
