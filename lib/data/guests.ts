import type { WeddingScope } from "./scope";
import type { GuestRow, AgeType } from "@/lib/types";
import * as activity from "./activity";
import { invalidateCache } from "@/lib/limiter";

/**
 * Overview's numbers are cached for 60s (`metrics.overview`). Dropping that
 * cache belongs here, next to the write, rather than in the server actions:
 * a data-layer call site cannot be forgotten by the next feature that adds a
 * guest, and a dashboard that is a minute behind the edit the user just made
 * reads as a bug in the edit.
 */
function invalidateMetrics(scope: WeddingScope): void {
  invalidateCache(`metrics:${scope.weddingId}`);
}

export async function create(
  scope: WeddingScope,
  g: {
    householdId: string;
    firstName: string;
    lastName: string;
    ageType?: AgeType;
    relationship?: string;
    origin?: "named" | "plus_one";
    operationId?: string;
  },
  actorId?: string,
): Promise<GuestRow> {
  const { data, error } = await scope.db.rpc("create_guest_atomic", {
    p_wedding_id: scope.weddingId,
    p_input: g,
    p_actor_id: actorId,
    p_operation_id: g.operationId ?? crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);
  return data as GuestRow;
}

export async function countNamed(
  scope: WeddingScope,
  householdId: string,
): Promise<number> {
  const { count, error } = await scope.db
    .from("guests")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", scope.weddingId)
    .eq("household_id", householdId)
    .eq("origin", "named");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function update(
  scope: WeddingScope,
  id: string,
  patch: Partial<
    Pick<
      GuestRow,
      | "first_name"
      | "last_name"
      | "relationship"
      | "age_type"
      | "is_vip"
      | "dietary_restrictions"
      | "allergies"
      | "accessibility_needs"
      | "internal_notes"
    >
  > & { hotel_info?: Record<string, unknown> },
  actorId?: string,
): Promise<void> {
  const { data, error } = await scope.db
    .from("guests")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select("household_id")
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);
  await activity.log(scope, {
    householdId: data.household_id,
    guestId: id,
    actorType: "admin",
    actorId,
    action: "guest.updated",
    payload: { fields: Object.keys(patch) },
  });
}

export async function remove(
  scope: WeddingScope,
  id: string,
  actorId?: string,
): Promise<void> {
  const { data, error } = await scope.db
    .from("guests")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select("household_id, first_name, last_name")
    .single();
  if (error) throw new Error(error.message);
  invalidateMetrics(scope);
  await activity.log(scope, {
    householdId: data.household_id,
    actorType: "admin",
    actorId,
    action: "guest.removed",
    payload: { name: `${data.first_name} ${data.last_name}` },
  });
}
