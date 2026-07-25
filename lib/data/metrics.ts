import type { WeddingScope } from "./scope";
import type { OverviewMetrics, ResponseRow, GuestRow, HouseholdRow, MealOptionRow } from "@/lib/types";
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

export async function overview(scope: WeddingScope): Promise<OverviewMetrics> {
  return cache(`metrics:${scope.weddingId}:overview`, 60, async () => {
    const [{ data: households }, { data: guests }, { data: responses }, { data: meals }, { data: tables }, { data: seats }] =
      await Promise.all([
        scope.db.from("households").select("id, rsvp_status").eq("wedding_id", scope.weddingId),
        scope.db
          .from("guests")
          .select("id, age_type, origin, dietary_restrictions, allergies, accessibility_needs")
          .eq("wedding_id", scope.weddingId),
        scope.db
          .from("guest_event_responses")
          .select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via")
          .eq("wedding_id", scope.weddingId),
        scope.db.from("meal_options").select("id, name, is_kids_meal, sort_order, event_id").eq("wedding_id", scope.weddingId),
        scope.db.from("seating_tables").select("id").eq("wedding_id", scope.weddingId),
        scope.db.from("seat_assignments").select("guest_id").eq("wedding_id", scope.weddingId),
      ]);

    const hh = (households ?? []) as Pick<HouseholdRow, "id" | "rsvp_status">[];
    const gs = (guests ?? []) as GuestRow[];
    const rs = (responses ?? []) as ResponseRow[];
    const ms = (meals ?? []) as MealOptionRow[];
    const seatSet = new Set((seats ?? []).map((s: { guest_id: string }) => s.guest_id));

    // A guest "attends" if they said yes to at least one event.
    const attendingIds = new Set(rs.filter((r) => r.attending === "yes").map((r) => r.guest_id));
    const declinedIds = new Set(
      gs
        .map((g) => g.id)
        .filter((id) => {
          const mine = rs.filter((r) => r.guest_id === id);
          return mine.length > 0 && mine.every((r) => r.attending === "no");
        }),
    );
    const pendingIds = gs.map((g) => g.id).filter((id) => !attendingIds.has(id) && !declinedIds.has(id));

    const responded = hh.filter((h) => h.rsvp_status === "completed" || h.rsvp_status === "declined").length;

    const byAge = (age: string) =>
      gs.filter((g) => g.age_type === age && attendingIds.has(g.id)).length;

    const mealCountsResult = mealCounts(
      rs,
      [...ms].sort((a, b) => a.sort_order - b.sort_order),
    );

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
      dietaryCount: gs.filter((g) => g.dietary_restrictions || g.allergies).length,
      accessibilityCount: gs.filter((g) => g.accessibility_needs).length,
      tablesCount: (tables ?? []).length,
      guestsWithoutTable: [...attendingIds].filter((id) => !seatSet.has(id)).length,
    };
  });
}
