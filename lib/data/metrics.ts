import type { WeddingScope } from "./scope";
import type { OverviewMetrics, ResponseRow, GuestRow, HouseholdRow, MealOptionRow } from "@/lib/types";
import { liveResponses } from "./event-rules";
import { loadReportData } from "@/lib/reports/guest-reports";
import { cache } from "@/lib/limiter";

/**
 * Counts distinct guests choosing each meal, not response rows.
 *
 * `guest_event_responses` stores one row per guest per event, and a guest's
 * meal choice is copied onto every one of their responses. Counting rows
 * (`.filter(...).length`) over-counts any guest attending multiple events —
 * a 3-event wedding would report ~3x the real entree count. Dedupe by
 * `guest_id` so each guest contributes exactly one to their meal's count.
 *
 * `meals` is consumed in the order given — callers that need `sort_order`
 * ordering must sort before calling; this function does not re-sort.
 */
export function mealCounts(
  responses: Array<{ guest_id: string; attending: string; meal_option_id: string | null }>,
  meals: Array<{ id: string; name: string; sort_order?: number }>,
): Array<{ name: string; count: number }> {
  return meals.map((m) => ({
    name: m.name,
    count: new Set(
      responses.filter((r) => r.attending === "yes" && r.meal_option_id === m.id).map((r) => r.guest_id),
    ).size,
  }));
}

/**
 * Where each guest stands across all their events.
 *
 * Coming: said yes to at least one event. Not coming: said no to at least one
 * and yes to none. A guest who declined the reception and has not answered the
 * welcome party counts as not coming, the way the couple reads it. Requiring a
 * "no" for every event showed "0 not coming" while eight guests had declined.
 */
export function guestStanding(responses: Array<{ guest_id: string; attending: string }>): {
  attendingIds: Set<string>;
  declinedIds: Set<string>;
} {
  const attendingIds = new Set(responses.filter((r) => r.attending === "yes").map((r) => r.guest_id));
  const declinedIds = new Set(
    responses.filter((r) => r.attending === "no" && !attendingIds.has(r.guest_id)).map((r) => r.guest_id),
  );
  return { attendingIds, declinedIds };
}

export async function overview(scope: WeddingScope): Promise<OverviewMetrics> {
  return cache(`metrics:${scope.weddingId}:overview`, 60, async () => {
    const data = await loadReportData(scope);
    const hh = data.hhs;
    const gs = hh.flatMap(h => h.guests);
    const rs = data.responses;
    const ms = data.meals;
    const tables = data.tables;
    const seatSet = new Set(data.seats.map(s => `${s.guest_id}:${s.event_id}`));

    const { attendingIds, declinedIds } = guestStanding(rs);
    const pendingIds = gs.map((g) => g.id).filter((id) => !attendingIds.has(id) && !declinedIds.has(id));

    const responded = hh.filter((h) => h.rsvp_status === "completed" || h.rsvp_status === "declined").length;

    const byAge = (age: string) =>
      gs.filter((g) => g.age_type === age && attendingIds.has(g.id)).length;

    const mealCountsResult = data.events.flatMap(e => mealCounts(rs.filter(r => r.event_id === e.id), ms.filter(m => !m.event_id || m.event_id === e.id)).map(m => ({ ...m, name: `${e.name}: ${m.name}` })));

    return {
      householdsInvited: hh.length,
      guestsInvited: gs.length,
      householdsResponded: responded,
      householdsPending: hh.filter((h) => h.rsvp_status === "pending" || h.rsvp_status === "started").length,
      guestsAttending: attendingIds.size,
      guestsDeclined: declinedIds.size,
      guestsPending: pendingIds.length,
      completionPct: hh.length ? Math.round((responded / hh.length) * 100) : 0,
      plusOnesAdded: gs.filter((g) => g.origin === "plus_one").length,
      adultsAttending: byAge("adult"),
      childrenAttending: byAge("child"),
      infantsAttending: byAge("infant"),
      mealCounts: mealCountsResult,
      dietaryCount: gs.filter((g) => attendingIds.has(g.id) && (g.dietary_restrictions || g.allergies)).length,
      accessibilityCount: gs.filter((g) => attendingIds.has(g.id) && g.accessibility_needs).length,
      tablesCount: (tables ?? []).length,
      guestsWithoutTable: new Set(rs.filter(r => r.attending === "yes" && !seatSet.has(`${r.guest_id}:${r.event_id}`)).map(r => r.guest_id)).size,
    };
  });
}
