import { defaultScope } from "@/lib/data/scope";
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
  const scope = defaultScope();

  const { data: events } = await scope.db
    .from("events")
    .select("id, name, starts_at, venue_name, rsvp_enabled, seating_published_at, sort_order")
    .eq("wedding_id", scope.weddingId)
    .order("sort_order");
  const allEvents = (events ?? []) as EventRow[];
  const event = allEvents.find((e) => e.id === params.event) ?? allEvents[allEvents.length - 1];

  if (!event) {
    return <p className="text-sm text-muted">Create an event first (seed data provides Ceremony + Reception).</p>;
  }

  const [tables, assignments, hhs, { data: responses }, { data: invites }, { data: meals }] = await Promise.all([
    seating.listTables(scope, event.id),
    seating.listAssignments(scope, event.id),
    households.list(scope),
    scope.db.from("guest_event_responses").select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via").eq("wedding_id", scope.weddingId).eq("event_id", event.id),
    scope.db.from("household_event_invites").select("household_id, event_id").eq("wedding_id", scope.weddingId).eq("event_id", event.id),
    scope.db.from("meal_options").select("id, name, is_kids_meal, sort_order, event_id").eq("wedding_id", scope.weddingId),
  ]);

  // Only invite-backed responses reach the canvas: a retained "yes" from a
  // household un-invited from this event must not appear as an unseated
  // attendee or pad the attending denominator.
  const live = liveResponses(
    (responses ?? []) as ResponseRow[],
    invites ?? [],
    hhs.flatMap((h) => h.guests.map((g) => ({ id: g.id, household_id: h.id }))),
  );

  return (
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
  );
}
