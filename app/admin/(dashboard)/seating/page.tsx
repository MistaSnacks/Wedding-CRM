import { forWedding } from "@/lib/data/scope";
import { requireAdmin } from "@/lib/admin-auth";
import { loadReportData } from "@/lib/reports/guest-reports";
import { SeatingTools } from "@/components/admin/SeatingTools";
import * as households from "@/lib/data/households";
import { liveResponses } from "@/lib/data/event-rules";
import * as seating from "@/lib/data/seating";
import { SeatingCanvas } from "@/components/admin/SeatingCanvas";
import type { EventRow, ResponseRow, MealOptionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SeatingPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const params = await searchParams;
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const data = await loadReportData(scope);
  const allEvents = data.events;
  const event =
    allEvents.find((e) => e.id === params.event) ??
    allEvents[allEvents.length - 1];
  if (!event) return <p>Create an event before arranging seating.</p>;
  const tables = data.tables.filter((t) => t.event_id === event.id);
  const assignments = data.seats.filter((a) => a.event_id === event.id);
  const hhs = data.hhs;
  const live = data.responses.filter((r) => r.event_id === event.id);
  const meals = data.meals.filter(
    (m) => !m.event_id || m.event_id === event.id,
  );
  if (admin.role === "viewer")
    return (
      <SeatingTools
        canEdit={false}
        eventId={event.id}
        tables={tables}
        assignments={assignments}
        households={hhs.map((h) => ({
          id: h.id,
          displayName: h.display_name,
          guests: h.guests.map((g) => ({
            id: g.id,
            name: `${g.first_name} ${g.last_name}`,
          })),
        }))}
        attendingIds={live
          .filter((r) => r.attending === "yes")
          .map((r) => r.guest_id)}
      />
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-hairline bg-white/75 px-5 py-3.5">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-[14px] font-semibold text-ink">See {event.name} in 3D</p>
          <p className="text-[13px] text-muted">
            Walk through the terrace, move tables and seat guests there. It is the same chart: every change saves here
            too.
          </p>
        </div>
        <a
          href={`/venue-preview?event=${event.id}`}
          className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-colors hover:bg-olive-deeper"
        >
          Open the 3D venue
        </a>
      </div>
      <SeatingCanvas
        event={event}
        allEvents={allEvents}
        tables={tables}
        assignments={assignments}
        householdsWithGuests={hhs.map((h) => ({
          id: h.id,
          displayName: h.display_name,
          guests: h.guests.map((g) => ({
            id: g.id,
            name: `${g.first_name} ${g.last_name}`,
            ageType: g.age_type,
            origin: g.origin,
            dietary: Boolean(g.dietary_restrictions || g.allergies),
          })),
        }))}
        responses={live}
        meals={(meals ?? []) as MealOptionRow[]}
      />
    </>
  );
}
