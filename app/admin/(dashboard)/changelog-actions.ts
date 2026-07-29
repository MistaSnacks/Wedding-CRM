"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { adminDb } from "@/lib/supabase/admin";
import { LATEST_CHANGELOG_ID } from "@/lib/changelog";

/**
 * Records that this person has read the latest "what's new" note.
 *
 * Stored in `activity_log` rather than a column of its own so it works
 * per-account: she may open the dashboard on her laptop and then her phone,
 * and being shown the same announcement twice reads as a bug. The action is
 * filtered out of the couple's activity feed.
 */
export async function dismissChangelog(): Promise<void> {
  const admin = await requireAdmin();
  const { error } = await adminDb().from("activity_log").insert({
    wedding_id: admin.weddingId,
    actor_type: "admin",
    actor_id: admin.userId,
    action: "changelog.seen",
    payload: { id: LATEST_CHANGELOG_ID },
  });
  if (error) console.error("changelog dismiss failed:", error.message);
}
