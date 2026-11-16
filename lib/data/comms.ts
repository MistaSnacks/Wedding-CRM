import type { WeddingScope } from "./scope";
import type { HouseholdRow } from "@/lib/types";
import * as activity from "./activity";

export type CommType = "save_the_date" | "invitation" | "reminder" | "thank_you" | "custom";
export type RecipientStatus = "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed" | "skipped" | "suppressed";

export async function create(
  scope: WeddingScope,
  c: {
    type: CommType;
    channel: "email" | "manual";
    subject?: string;
    audienceFilter?: unknown;
    sentBy?: string;
    householdIds: string[];
  },
): Promise<{ id: string }> {
  const { data, error } = await scope.db
    .from("communications")
    .insert({
      wedding_id: scope.weddingId,
      type: c.type,
      channel: c.channel,
      subject: c.subject ?? null,
      audience_filter: c.audienceFilter ?? null,
      sent_at: new Date().toISOString(),
      sent_by: c.sentBy ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const commId = data.id as string;

  if (c.householdIds.length) {
    // Scoped on purpose: the id list arrives from a page's selection, so an
    // id from another wedding would otherwise be read here and written into
    // this wedding's recipient rows — mailing a stranger, and leaking their
    // address into our data in the process. Foreign ids simply match nothing.
    const { data: hhs, error: hErr } = await scope.db
      .from("households")
      .select("id, email")
      .eq("wedding_id", scope.weddingId)
      .in("id", c.householdIds);
    if (hErr) throw new Error(hErr.message);
    const rows = (hhs ?? []).map((h: { id: string; email: string | null }) => ({
      wedding_id: scope.weddingId,
      communication_id: commId,
      household_id: h.id,
      email: h.email,
      status: c.channel === "manual" ? "sent" : h.email ? "queued" : "skipped",
    }));
    const { error: rErr } = await scope.db.from("communication_recipients").insert(rows);
    if (rErr) throw new Error(rErr.message);
  }

  await activity.log(scope, {
    actorType: "admin",
    actorId: c.sentBy,
    action: `communication.${c.type}.sent`,
    payload: { commId, channel: c.channel, recipients: c.householdIds.length },
  });
  return { id: commId };
}

export async function setRecipientMessageId(
  scope: WeddingScope,
  commId: string,
  householdId: string,
  resendMessageId: string,
): Promise<void> {
  const { error } = await scope.db
    .from("communication_recipients")
    .update({ resend_message_id: resendMessageId, status: "sent", updated_at: new Date().toISOString() })
    .eq("wedding_id", scope.weddingId)
    .eq("communication_id", commId)
    .eq("household_id", householdId);
  if (error) throw new Error(error.message);
}

/**
 * Idempotent webhook update keyed on the Resend message id.
 *
 * The message id arrives from an inbound webhook payload, which is the least
 * trustworthy input in the app, so both the lookup and the write are scoped:
 * a delivery event for another wedding's message must read as "not ours"
 * (`false`, so the caller can decide) rather than silently marking a row.
 */
export async function markByMessageId(
  scope: WeddingScope,
  resendMessageId: string,
  status: RecipientStatus,
): Promise<boolean> {
  const rank: Record<RecipientStatus, number> = {
    queued: 0, sent: 1, delivered: 2, opened: 3, bounced: 4, failed: 4, skipped: 4, suppressed: 4,
  };
  const { data, error: readError } = await scope.db
    .from("communication_recipients")
    .select("id, status")
    .eq("wedding_id", scope.weddingId)
    .eq("resend_message_id", resendMessageId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!data) return false;
  if (rank[data.status as RecipientStatus] >= rank[status]) return true; // idempotent / no downgrade
  const { error: writeError } = await scope.db
    .from("communication_recipients")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", data.id)
    .eq("status", data.status);
  if (writeError) throw new Error(writeError.message);
  return true;
}

export async function historyForHousehold(scope: WeddingScope, householdId: string) {
  const { data, error } = await scope.db
    .from("communication_recipients")
    .select("status, updated_at, communications(type, subject, channel, sent_at)")
    .eq("wedding_id", scope.weddingId)
    .eq("household_id", householdId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Households invited, not responded, and with no reminder in the last N days. */
export async function needsReminder(scope: WeddingScope, days = 7): Promise<HouseholdRow[]> {
  const { data: hhs, error } = await scope.db
    .from("households")
    .select("*")
    .eq("wedding_id", scope.weddingId)
    .in("rsvp_status", ["pending", "started"])
    .is("archived_at", null);
  if (error) throw new Error(error.message);

  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: recent, error: recentError } = await scope.db
    .from("communication_recipients")
    .select("household_id, communications!inner(type, sent_at)")
    .eq("wedding_id", scope.weddingId)
    .eq("communications.type", "reminder")
    .in("status", ["sent", "delivered", "opened"])
    .gte("communications.sent_at", cutoff);

  if (recentError) throw new Error(recentError.message);
  const recentlyReminded = new Set((recent ?? []).map((r: { household_id: string }) => r.household_id));
  const { data: queued, error: queueError } = await scope.db.from("email_outbox").select("household_id").eq("wedding_id", scope.weddingId).in("kind", ["reminder", "auto_reminder"]).in("state", ["pending", "processing", "sent"]).gte("created_at", cutoff);
  if (queueError) throw new Error(queueError.message);
  for (const r of queued ?? []) if (r.household_id) recentlyReminded.add(r.household_id);
  return ((hhs ?? []) as HouseholdRow[]).filter((h) => h.email?.trim() && !recentlyReminded.has(h.id));
}
