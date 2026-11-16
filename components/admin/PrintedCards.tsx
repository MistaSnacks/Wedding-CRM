import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { buildGuestReport, loadReportData } from "@/lib/reports/guest-reports";
import { EventReportPicker } from "./EventReportPicker";

export async function PrintedCards({ eventId, place }: { eventId?: string; place: boolean }) {
  const admin = await requireAdmin();
  const data = await loadReportData(forWedding(admin.weddingId));
  const event = data.events.find(e => e.id === eventId) ?? (data.events.length === 1 ? data.events[0] : null);
  const rows = event ? buildGuestReport(data, "seating", event.id).rows : [];
  const assigned = rows.filter(r => r["Table ID"]);
  assigned.sort((a, b) => place ? String(a.Table).localeCompare(String(b.Table), undefined, { numeric: true }) || String(a.Guest).localeCompare(String(b.Guest)) : String(a.Guest).localeCompare(String(b.Guest)));
  return <main className="min-h-dvh bg-white p-6">
    <div className="no-print mb-6 flex flex-col gap-3">
      <h1 className="text-xl font-semibold">{place ? "Place cards" : "Escort cards"}{event ? ` — ${event.name}` : ""}</h1>
      <EventReportPicker events={data.events} eventId={event?.id} />
      {event && <p className="text-sm text-muted">{assigned.length} cards · {rows.length - assigned.length} attending guests need a table. Print with your browser after reviewing these counts.</p>}
    </div>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 print:grid-cols-4">
      {assigned.map(r => <article key={String(r["Guest ID"])} className="flex aspect-[3.5/2] flex-col items-center justify-center rounded border border-hairline p-3 text-center" style={{ breakInside: "avoid" }}>
        <p className="font-display text-xl text-olive-deep">{r.Guest}</p>
        <p className="text-xs text-rose-deep">{r.Table}{r.Seat ? ` · Seat ${r.Seat}` : ""}</p>
        {place && <p className="mt-1 text-xs text-ink">{r.Meal}</p>}
      </article>)}
    </div>
  </main>;
}
