import type { WeddingScope } from "./scope";
import type { ActivityRow } from "@/lib/types";

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

export async function recent(scope: WeddingScope, limit = 20): Promise<ActivityRow[]> {
  const { data, error } = await scope.db
    .from("activity_log")
    .select("id, household_id, guest_id, actor_type, action, payload, created_at")
    .eq("wedding_id", scope.weddingId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityRow[];
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
