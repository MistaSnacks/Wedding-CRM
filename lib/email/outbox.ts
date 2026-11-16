import type { WeddingScope } from '@/lib/data/scope';
import { sendEmail, confirmationHtml } from './send';
import { hasWeddingFields, resolveWeddingFields } from './strings';
import { weddingFactsFor } from '@/lib/data/wedding-public';
import type { WeddingFacts } from '@/lib/domain/wedding-details';
import { env } from '@/lib/env';

export type QueuedEmail = { key: string; to: string; subject: string; html: string; householdId?: string; kind?: string; metadata?: Record<string,unknown> };
export async function enqueueEmail(scope: WeddingScope, mail: QueuedEmail): Promise<void> {
  const { error } = await scope.db.from('email_outbox').upsert({ wedding_id: scope.weddingId, dedupe_key: mail.key,
    household_id: mail.householdId ?? null, recipient: mail.to, subject: mail.subject, html: mail.html, kind: mail.kind ?? 'confirmation', metadata: mail.metadata ?? {} },
    { onConflict: 'wedding_id,dedupe_key', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
export async function enqueueConfirmation(scope: WeddingScope, args: { householdId: string; versionKey: string; to: string; accessToken: string; locale: string; hotelRecsUrl?: string | null }) {
  await enqueueEmail(scope, { key: `rsvp:${args.householdId}:${args.versionKey}`, householdId: args.householdId,
    to: args.to, ...confirmationHtml(args), kind: 'confirmation' });
}
export type OutboxRow = { id: string; recipient: string; subject: string; html: string; claim_token: string; attempts: number; household_id: string | null; kind: string; metadata: Record<string,unknown>; sender:string|null; reply_to:string|null };
export type DeliverySummary = { sent: number; retried: number; suppressed: number; failed: number };

/** Bounded worker. Every retry uses the same provider idempotency key. No detached work. */
export async function processOutbox(scope: WeddingScope, opts: { limit?: number } = {}): Promise<DeliverySummary> {
  const { data, error } = await scope.db.rpc('claim_email_outbox', { p_wedding: scope.weddingId, p_limit: opts.limit ?? 10 });
  if (error) throw new Error(error.message);
  const summary: DeliverySummary = { sent: 0, retried: 0, suppressed: 0, failed: 0 };
  // Queued mail carries merge fields; this wedding's current values go in at send time.
  let facts: Promise<WeddingFacts> | null = null;
  for (const row of (data ?? []) as OutboxRow[]) {
    let state: 'sent' | 'pending' | 'suppressed' = 'pending';
    let message: string | null = null;
    let reason: string | null = null;
    try {
      const suppressed = await scope.db.from('email_suppressions').select('reason').eq('wedding_id', scope.weddingId).eq('email', row.recipient.trim().toLowerCase()).maybeSingle();
      if (suppressed.error) throw new Error(suppressed.error.message);
      let noLongerEligible = false;
      if (row.household_id) {
        const live = await scope.db.from('households').select('archived_at,email').eq('wedding_id',scope.weddingId).eq('id',row.household_id).maybeSingle();
        if(live.error)throw new Error(live.error.message);
        noLongerEligible = !live.data || !!live.data.archived_at || live.data.email?.trim().toLowerCase()!==row.recipient.trim().toLowerCase();
      }
      if (row.household_id && ['reminder','auto_reminder'].includes(row.kind)) {
        const h = await scope.db.from('households').select('rsvp_status').eq('wedding_id', scope.weddingId).eq('id', row.household_id).maybeSingle();
        if (h.error) throw new Error(h.error.message);
        noLongerEligible ||= !h.data || !['pending','started'].includes(h.data.rsvp_status);
        const wedding = await scope.db.from('weddings').select('rsvp_deadline').eq('id', scope.weddingId).single();
        if (wedding.error) throw new Error(wedding.error.message);
        noLongerEligible ||= !!wedding.data.rsvp_deadline && new Date(wedding.data.rsvp_deadline) <= new Date();
        const invites=await scope.db.from('household_event_invites').select('event_id').eq('wedding_id',scope.weddingId).eq('household_id',row.household_id);
        if(invites.error)throw new Error(invites.error.message);
        const events=await scope.db.from('events').select('id').eq('wedding_id',scope.weddingId).eq('rsvp_enabled',true).in('id',(invites.data??[]).map(i=>i.event_id)).limit(1);
        if(events.error)throw new Error(events.error.message);noLongerEligible ||= !events.data?.length;
      }
      if (['auto_reminder','planning_digest','payment_reminder'].includes(row.kind)) {
        const settings = await scope.db.from('automation_settings').select('*').eq('wedding_id',scope.weddingId).maybeSingle();
        if(settings.error)throw new Error(settings.error.message);
        const flag = row.kind==='auto_reminder' ? 'reminders_enabled' : row.kind==='planning_digest' ? 'digest_enabled' : 'payment_reminders_enabled';
        noLongerEligible ||= !settings.data?.[flag];
        if(row.kind!=='auto_reminder')noLongerEligible ||= settings.data?.recipient_email?.trim().toLowerCase()!==row.recipient.trim().toLowerCase();
        if(row.kind==='auto_reminder'&&row.household_id){
          const sent=await scope.db.from('email_outbox').select('id',{count:'exact',head:true}).eq('wedding_id',scope.weddingId).eq('household_id',row.household_id).eq('kind','auto_reminder').eq('state','sent');
          if(sent.error)throw new Error(sent.error.message);noLongerEligible ||= (sent.count??0)>=(settings.data?.reminder_cap??0);
        }
      }
      if(row.kind==='payment_reminder'){
        const p=await scope.db.from('budget_payments').select('paid_at,due_date').eq('wedding_id',scope.weddingId).eq('id',String(row.metadata.paymentId)).maybeSingle();
        if(p.error)throw new Error(p.error.message);
        noLongerEligible ||= !p.data || p.data.paid_at!==null || p.data.due_date!==row.metadata.dueDate;
      }
      if (suppressed.data || noLongerEligible) { state = 'suppressed'; reason = suppressed.data?.reason ?? 'The household replied or the deadline passed.'; }
      else {
        if(!row.sender){
          const e=env();row.sender=e.RESEND_FROM;row.reply_to=e.RESEND_REPLY_TO??null;
          const frozen=await scope.db.from('email_outbox').update({sender:row.sender,reply_to:row.reply_to}).eq('wedding_id',scope.weddingId).eq('id',row.id).eq('claim_token',row.claim_token);
          if(frozen.error)throw new Error(frozen.error.message);
        }
        let mail = { subject: row.subject, html: row.html };
        if (hasWeddingFields(mail.subject) || hasWeddingFields(mail.html)) {
          const wedding = await (facts ??= weddingFactsFor(scope));
          mail = { subject: resolveWeddingFields(mail.subject, wedding), html: resolveWeddingFields(mail.html, wedding, { html: true }) };
        }
        const result = await sendEmail({ to: row.recipient, subject: mail.subject, html: mail.html, from:row.sender, replyTo:row.reply_to, idempotencyKey: `outbox/${row.id}` });
        if (!result.id) throw new Error('Development preview written; no live email delivered.');
        message = result.id; state = 'sent';
      }
    } catch (e) { reason = e instanceof Error ? e.message : 'Email delivery failed.'; }
    const finish = await scope.db.rpc('finish_email_outbox', { p_wedding: scope.weddingId, p_id: row.id, p_claim: row.claim_token, p_state: state, p_message: message, p_error: reason });
    if (finish.error) throw new Error(finish.error.message); // preserve lease; same key is safe to retry
    if (state === 'sent') summary.sent++;
    else if (state === 'suppressed') summary.suppressed++;
    else if (row.attempts >= 8) summary.failed++;
    else summary.retried++;
  }
  return summary;
}

export async function replayWebhookEvents(scope: WeddingScope): Promise<void> {
  // Correlates globally by unique provider ID; called only by the service worker.
  const { error } = await scope.db.rpc('replay_email_events', { p_limit: 100 });
  if (error) throw new Error(error.message);
}
