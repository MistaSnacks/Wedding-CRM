"use server";
import { revalidatePath } from 'next/cache';
import { requireEditor } from '@/lib/admin-auth';
import { forWedding, type WeddingScope } from '@/lib/data/scope';
import * as households from '@/lib/data/households';
import * as comms from '@/lib/data/comms';
import { sendEmail, invitationHtml, reminderHtml, emailShell, escapeHtml, resolveEmail } from '@/lib/email/send';
import { weddingFactsFor } from '@/lib/data/wedding-public';
import { emailStrings, localeOf } from '@/lib/email/strings';
import { env } from '@/lib/env';
import { z } from 'zod';
import { processOutbox } from '@/lib/email/outbox';
import type { HouseholdRow } from '@/lib/types';
import { normalizeCompose, renderCampaign, type Compose } from '@/lib/domain/campaign-compose';

export type CampaignReview = { token: string; count: number; recipientNames: string[]; skippedNames: string[]; previews: Array<{locale:string;subject:string;html:string}> };
export type SendSummary = { queued: number; skippedNoEmail: number };
function parseCompose(fd: FormData): Compose { return normalizeCompose(Object.fromEntries(fd)); }
async function audience(scope: WeddingScope,c:Compose) {
  let targets = await households.search(scope,{filter:c.audience==='not_responded'?'all':c.audience,limit:1000});
  // Delivery drops a reminder to a household that already finished, so the review must not count it.
  if(c.audience==='not_responded'||c.type==='reminder')targets=targets.filter(h=>['pending','started'].includes(h.rsvp_status));
  if(c.type==='reminder'&&c.audience==='not_responded'){const eligible=new Set((await comms.needsReminder(scope)).map(h=>h.id));targets=targets.filter(h=>!h.email||eligible.has(h.id));}
  const {data:suppressed,error}=await scope.db.from('email_suppressions').select('email').eq('wedding_id',scope.weddingId);
  if(error) throw new Error(error.message);
  const blocked=new Set((suppressed??[]).map(r=>r.email));
  return {targets,emailable:targets.filter(h=>h.email?.trim()&&!blocked.has(h.email.trim().toLowerCase())),skipped:targets.filter(h=>!h.email?.trim()||blocked.has(h.email.trim().toLowerCase()))};
}
function render(h:Pick<HouseholdRow,'access_token'|'invite_code'|'preferred_locale'>,c:Compose) { return renderCampaign(h,c,{appUrl:env().NEXT_PUBLIC_APP_URL,invitationHtml,reminderHtml,emailShell,escapeHtml,emailStrings,localeOf}); }
export async function reviewCampaign(fd:FormData):Promise<CampaignReview>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);const c=parseCompose(fd);
 const {emailable,skipped}=await audience(scope,c);
 const recipients=emailable.map(h=>({householdId:h.id,to:h.email!,locale:localeOf(h.preferred_locale),...render(h,c)}));
 const {data,error}=await scope.db.from('campaign_drafts').insert({wedding_id:scope.weddingId,actor_id:admin.userId,compose:c,recipients,skipped:skipped.map(h=>h.display_name)}).select('id').single();
 if(error)throw new Error(error.message);
 const previews=recipients.filter((r,i,a)=>a.findIndex(v=>v.locale===r.locale)===i).map(({locale,subject,html})=>({locale,subject,html}));
 if(!previews.length)previews.push({locale:'en',...render({access_token:'preview',invite_code:'XXXX-XXXX',preferred_locale:'en'},c)});
 // Queued mail keeps merge fields so delivery writes the day current at send time; the preview shows today's values.
 const wedding=await weddingFactsFor(scope);
 return {token:data.id,count:recipients.length,recipientNames:emailable.map(h=>h.display_name),skippedNames:skipped.map(h=>h.display_name),previews:previews.map(p=>resolveEmail(p,wedding))};
}
export async function sendTestToMe(fd:FormData):Promise<{previewOnly:boolean}>{
 const admin=await requireEditor();const c=parseCompose(fd);
 // Tests never include a real household bearer credential.
 const {subject,html}=resolveEmail(render({access_token:'preview',invite_code:'XXXX-XXXX',preferred_locale:'en'},c),await weddingFactsFor(forWedding(admin.weddingId)));
 const result=await sendEmail({to:admin.email,subject:`[Test] ${subject}`,html});
 return {previewOnly:!result.id};
}
export async function sendCampaign(fd:FormData):Promise<SendSummary>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);const c=parseCompose(fd);
 if(c.channel==='manual'){
 const targets=await households.search(scope,{filter:c.audience==='not_responded'?'all':c.audience,limit:1000});
 await comms.create(scope,{type:c.type,channel:'manual',subject:c.customSubject,sentBy:admin.userId,householdIds:targets.filter(h=>c.audience!=='not_responded'||['pending','started'].includes(h.rsvp_status)).map(h=>h.id)});
 revalidatePath('/admin/comms');return {queued:0,skippedNoEmail:0};
 }
 const id=z.uuid().parse(fd.get('review_token'));
 const {data:d,error}=await scope.db.from('campaign_drafts').select('compose,recipients,skipped').eq('wedding_id',scope.weddingId).eq('actor_id',admin.userId).eq('id',id).single();
 if(error||!d)throw new Error('Review the campaign again before sending.');
 if(JSON.stringify(d.compose)!==JSON.stringify(c)&&Object.keys(c).some(k=>d.compose[k]!==c[k as keyof Compose]))throw new Error('This message changed. Review it again.');
 const queued=await scope.db.rpc('queue_campaign',{p_wedding:scope.weddingId,p_actor:admin.userId,p_draft:id});
 if(queued.error)throw new Error(queued.error.message);
 // A worker failure leaves the approved queue durable; it never repeats the campaign.
 try { await processOutbox(scope,{limit:5}); } catch(e) { console.error('Initial delivery batch deferred',e); }
 revalidatePath('/admin/comms');return {queued:d.recipients.length,skippedNoEmail:d.skipped.length};
}
