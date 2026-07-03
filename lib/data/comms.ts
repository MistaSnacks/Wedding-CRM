import type { WeddingScope } from "./scope";
import type { HouseholdRow } from "@/lib/types";
import * as activity from "./activity";

export type CommType = "save_the_date" | "invitation" | "reminder" | "thank_you" | "custom";
export type RecipientStatus = "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed";

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
    const { data: hhs } = await scope.db
      .from("households")
      .select("id, email")
      .in("id", c.householdIds);
    const rows = (hhs ?? []).map((h: { id: string; email: string | null }) => ({
      wedding_id: scope.weddingId,
      communication_id: commId,
      household_id: h.id,
      email: h.email,
      status: c.channel === "manual" ? "sent" : "queued",
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
  await scope.db
    .from("communication_recipients")
    .update({ resend_message_id: resendMessageId, status: "sent", updated_at: new Date().toISOString() })
    .eq("communication_id", commId)
    .eq("household_id", householdId);
}

/** Idempotent webhook update keyed on the Resend message id. */
export async function markByMessageId(
  scope: WeddingScope,
  resendMessageId: string,
  status: RecipientStatus,
): Promise<boolean> {
  const rank: Record<RecipientStatus, number> = {
    queued: 0, sent: 1, delivered: 2, opened: 3, bounced: 4, failed: 4,
  };
  const { data } = await scope.db
    .from("communication_recipients")
    .select("id, status")
    .eq("resend_message_id", resendMessageId)
    .maybeSingle();
  if (!data) return false;
  if (rank[data.status as RecipientStatus] >= rank[status]) return true; // idempotent / no downgrade
  await scope.db
    .from("communication_recipients")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", data.id);
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
    .in("rsvp_status", ["pending", "started"]);
  if (error) throw new Error(error.message);

  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: recent } = await scope.db
    .from("communication_recipients")
    .select("household_id, communications!inner(type, sent_at)")
    .eq("wedding_id", scope.weddingId)
    .eq("communications.type", "reminder")
    .gte("communications.sent_at", cutoff);

  const recentlyReminded = new Set((recent ?? []).map((r: { household_id: string }) => r.household_id));
  return ((hhs ?? []) as HouseholdRow[]).filter((h) => !recentlyReminded.has(h.id));
}
