import { adminDb } from "@/lib/supabase/admin";

/**
 * Which "what's new" note this person has read.
 *
 * Kept out of the `"use server"` actions file on purpose: everything exported
 * from one of those becomes a client-callable endpoint, and this takes a user
 * id and a wedding id as arguments — not something to expose to the browser.
 * Server components import it directly.
 */
export async function readChangelogMark(userId: string, weddingId: string): Promise<string | null> {
  const { data } = await adminDb()
    .from("activity_log")
    .select("payload")
    .eq("wedding_id", weddingId)
    .eq("actor_id", userId)
    .eq("action", "changelog.seen")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload = data?.payload as { id?: string } | null;
  return payload?.id ?? null;
}
