import type { WeddingScope } from "./scope";
import type { ActivityRow } from "@/lib/types";
import { selectGuestFeed } from "./activity-rules";

export async function log(
  scope: WeddingScope,
  e: {
    householdId?: string;
    guestId?: string;
    actorType: "guest" | "admin" | "system";
    actorId?: string;
    action: string;
    payload?: unknown;
  },
): Promise<void> {
  const { error } = await scope.db.from("activity_log").insert({
    wedding_id: scope.weddingId,
    household_id: e.householdId ?? null,
    guest_id: e.guestId ?? null,
    actor_type: e.actorType,
    actor_id: e.actorId ?? null,
    action: e.action,
    payload: e.payload ?? null,
  });
  if (error) console.error("activity.log failed:", error.message);
}

/** Bookkeeping we write to activity_log but never want in the couple's feed. */
const HIDDEN_ACTIONS = ["changelog.seen"];

export async function recent(scope: WeddingScope, limit = 20): Promise<ActivityRow[]> {
  const { data, error } = await scope.db
    .from("activity_log")
    .select("id, household_id, guest_id, actor_type, action, payload, created_at")
    .eq("wedding_id", scope.weddingId)
    .not("action", "in", `(${HIDDEN_ACTIONS.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityRow[];
}

/**
 * The Overview's "Recent RSVPs" feed: guest activity only, never money.
 *
 * Over-fetches and then narrows in `selectGuestFeed`, rather than expressing the
 * allowlist as a PostgREST filter string. A busy week of budget edits can bury
 * the replies, so `WINDOW` is deliberately much larger than any `limit` the page
 * asks for — and building an `or=(action.like.…)` string by interpolation is the
 * same pattern that already produced a live bug elsewhere in this file's
 * neighbours.
 */
const GUEST_FEED_WINDOW = 200;

export async function recentGuestActivity(scope: WeddingScope, limit = 20): Promise<ActivityRow[]> {
  const rows = await recent(scope, GUEST_FEED_WINDOW);
  return selectGuestFeed(rows, limit);
}

export async function forHousehold(scope: WeddingScope, householdId: string, limit = 50): Promise<ActivityRow[]> {
  const { data, error } = await scope.db
    .from("activity_log")
    .select("id, household_id, guest_id, actor_type, action, payload, created_at")
    .eq("wedding_id", scope.weddingId)
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityRow[];
}
