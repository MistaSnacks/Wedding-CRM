import { createHash } from 'node:crypto';
import type { WeddingScope } from '@/lib/data/scope';
import { enqueueEmail,processOutbox,replayWebhookEvents } from '@/lib/email/outbox';
import { emailShell,escapeHtml,reminderHtml } from '@/lib/email/send';
import * as comms from '@/lib/data/comms';
import { calendarDayIn } from '@/lib/format/wedding-date';
import { paymentReminderStage,reminderScheduleDue } from './rules';
import { env } from '@/lib/env';
import { readAll } from '@/lib/data/query';
import { listReadiness } from '@/lib/data/readiness';

/** Defaults to no scheduled mail; user-approved manual campaigns/confirmations still drain. */
async function executeAutomations(scope:WeddingScope,now=new Date()){
 let schedulingError:unknown;
 try {
 const settings=await scope.db.from('automation_settings').select('*').eq('wedding_id',scope.weddingId).maybeSingle();
 if(settings.error)throw new Error(settings.error.message);
 const s=settings.data;
 if(s && (s.reminders_enabled||s.digest_enabled||s.payment_reminders_enabled)){
 const wedding=await scope.db.from('weddings').select('timezone,rsvp_deadline').eq('id',scope.weddingId).single();if(wedding.error)throw new Error(wedding.error.message);
 const zone=wedding.data.timezone;const day=calendarDayIn(now,zone);
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(now));
 if(hour>=9){
 if(s.reminders_enabled&&wedding.data.rsvp_deadline&&now<new Date(wedding.data.rsvp_deadline)&&reminderScheduleDue(s.reminder_start_date,s.reminder_weekday,now,zone)){
 if(!s.reminder_templates)throw new Error('Review and save the reminder templates before enabling this schedule.');
 const targets=await comms.needsReminder(scope);
 const invites=await readAll<{household_id:string;event_id:string}>(()=>scope.db.from('household_event_invites').select('household_id,event_id').eq('wedding_id',scope.weddingId).order('household_id').order('event_id'));
 const liveEvents=await scope.db.from('events').select('id').eq('wedding_id',scope.weddingId).eq('rsvp_enabled',true);if(liveEvents.error)throw new Error(liveEvents.error.message);
 const eventIds=new Set((liveEvents.data??[]).map(e=>e.id));
 const invited=new Set(invites.filter(i=>eventIds.has(i.event_id)).map(i=>i.household_id));
 const prior=await readAll<{household_id:string|null}>(()=>scope.db.from('email_outbox').select('household_id').eq('wedding_id',scope.weddingId).eq('kind','auto_reminder').in('state',['sent','pending','processing']).order('id'));
 for(const h of targets){if(!h.email||!invited.has(h.id)||prior.filter(p=>p.household_id===h.id).length>=s.reminder_cap)continue;
 const template=s.reminder_templates[h.preferred_locale]??s.reminder_templates.en;
 await enqueueEmail(scope,{key:`auto-reminder:${h.id}:${day}`,householdId:h.id,to:h.email,subject:template.subject,html:template.html.replaceAll('__HOUSEHOLD_TOKEN__',encodeURIComponent(h.access_token)),kind:'auto_reminder'});}
 }
 if(s.recipient_email&&(s.digest_enabled||s.payment_reminders_enabled)){
 const payments=await readAll<{id:string;label:string;due_date:string|null;paid_at:string|null;amount_cents:number}>(()=>scope.db.from('budget_payments').select('id,label,due_date,paid_at,amount_cents').eq('wedding_id',scope.weddingId).order('id'));
 if(s.payment_reminders_enabled)for(const p of payments){if(!p.due_date)continue;const stage=paymentReminderStage(p.due_date,p.paid_at,now,zone);if(!stage)continue;
 await enqueueEmail(scope,{key:`payment:${p.id}:${p.due_date}:${stage}`,to:s.recipient_email,kind:'payment_reminder',metadata:{paymentId:p.id,dueDate:p.due_date},subject:`Payment ${stage==='overdue'?'overdue':'coming up'}: ${p.label}`,html:emailShell({heading:'A payment needs your attention',body:`${escapeHtml(p.label)} is due ${escapeHtml(p.due_date)}. Open the budget to review it or record a payment.`,cta:{label:'Review budget',url:`${env().NEXT_PUBLIC_APP_URL}/admin/budget`}})});}
 if(s.digest_enabled&&(s.digest_cadence==='daily'||new Date(`${day}T12:00:00Z`).getUTCDay()===1)){
 const attention=await listReadiness(scope);
 const snapshot=attention.map(({id,title,kind,priority})=>({id,title,kind,priority})).sort((a,b)=>a.id.localeCompare(b.id));
 const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 if(attention.length&&hash!==s.last_digest_hash){
 const counts=attention.reduce<Record<string,number>>((a,item)=>{a[item.kind]=(a[item.kind]??0)+1;return a;},{});
 const summary=Object.entries(counts).map(([kind,n])=>`${n} ${escapeHtml(kind)} items`).join('<br/>');
 const top=attention.slice(0,5).map(i=>`<a href="${escapeHtml(env().NEXT_PUBLIC_APP_URL+i.href)}">${escapeHtml(i.title)}</a>`).join('<br/>');
 const saved=await scope.db.rpc('queue_planning_digest',{p_wedding:scope.weddingId,p_day:day,p_hash:hash,p_subject:'Your wedding planning check-in',p_html:emailShell({heading:'A few things need attention',body:`${summary}<br/><br/>${top}`,cta:{label:'Open all planning tasks',url:`${env().NEXT_PUBLIC_APP_URL}/admin`}})});
 if(saved.error)throw new Error(saved.error.message);
 }
 }
 }
 }
 }
 } catch(e) { schedulingError=e; }
 const delivery=await processOutbox(scope,{limit:25});await replayWebhookEvents(scope);
 if(schedulingError)throw schedulingError;return delivery;
}

/** Durable run history exposes failed and interrupted cron executions in the app. */
export async function runAutomations(scope:WeddingScope,now=new Date()){
 const started=await scope.db.from('automation_runs').insert({wedding_id:scope.weddingId}).select('id').single();
 if(started.error)throw new Error(started.error.message);
 try{
 const result=await executeAutomations(scope,now);
 const finish=await scope.db.from('automation_runs').update({state:'success',finished_at:new Date().toISOString(),result}).eq('wedding_id',scope.weddingId).eq('id',started.data.id);
 if(finish.error)throw new Error(finish.error.message);
 return result;
 }catch(e){
 const saved=await scope.db.from('automation_runs').update({state:'failed',finished_at:new Date().toISOString(),error:e instanceof Error?e.message:'Automation failed'}).eq('wedding_id',scope.weddingId).eq('id',started.data.id);
 if(saved.error)console.error('Could not persist automation failure',saved.error.message);
 throw e;
 }
}
