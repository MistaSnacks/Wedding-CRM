"use server";
import { revalidatePath } from 'next/cache';
import { requireEditor } from '@/lib/admin-auth';
import { forWedding } from '@/lib/data/scope';
import { enqueueEmail,processOutbox } from '@/lib/email/outbox';
import { reminderHtml } from '@/lib/email/send';
import { canRetryDelivery } from '@/lib/automation/rules';
import { z } from 'zod';
export async function saveAutomationSettings(fd:FormData):Promise<{message:string}>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);
 const enabled=(key:string)=>fd.get(key)==='on';const reminders=enabled('reminders_enabled'),digest=enabled('digest_enabled'),payments=enabled('payment_reminders_enabled');
 const email=String(fd.get('recipient_email')??'').trim();if((digest||payments)&&!z.email().safeParse(email).success)throw new Error('Enter the planner email that should receive private updates.');
 const start=String(fd.get('reminder_start_date')??'');if(reminders&&!/^\d{4}-\d{2}-\d{2}$/.test(start))throw new Error('Choose the first date guest reminders may be sent.');
 if((reminders||digest||payments)&&!enabled('reviewed'))throw new Error('Review the schedule and email previews, then confirm below.');
 const weekday=z.coerce.number().int().min(0).max(6).parse(fd.get('reminder_weekday'));
 const cap=z.coerce.number().int().min(1).max(10).parse(fd.get('reminder_cap'));
 const cadence=z.enum(['daily','weekly']).parse(fd.get('digest_cadence'));
 const {error}=await scope.db.from('automation_settings').upsert({wedding_id:scope.weddingId,reminders_enabled:reminders,digest_enabled:digest,payment_reminders_enabled:payments,recipient_email:email||null,reminder_start_date:start||null,reminder_weekday:weekday,reminder_cap:cap,digest_cadence:cadence,reminder_templates:reminders?Object.fromEntries(['en','es','vi'].map(locale=>[locale,reminderHtml({accessToken:'__HOUSEHOLD_TOKEN__',locale})])):null,updated_at:new Date().toISOString()});
 if(error)throw new Error(error.message);revalidatePath('/admin/comms');return {message:'Saved. Only the schedules you enabled will send automatically.'};
}
export async function resumeDelivery():Promise<{message:string}>{const admin=await requireEditor();const r=await processOutbox(forWedding(admin.weddingId),{limit:10});revalidatePath('/admin/comms');return {message:`${r.sent} accepted by the provider, ${r.retried} queued for retry, ${r.failed} failed, ${r.suppressed} suppressed.`};}
export async function retryFailedDelivery(fd:FormData):Promise<{message:string}>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);const id=z.uuid().parse(fd.get('id'));
 const {data:old,error}=await scope.db.from('email_outbox').select('*').eq('wedding_id',scope.weddingId).eq('id',id).single();if(error)throw new Error(error.message);
 if(!canRetryDelivery(old.state,fd.get('confirmed')==='on'))throw new Error('Check that the original was not delivered before retrying a failed or suppressed message.');
 let to=old.recipient;
 if(old.household_id){const h=await scope.db.from('households').select('email,archived_at').eq('wedding_id',scope.weddingId).eq('id',old.household_id).single();if(h.error)throw new Error(h.error.message);if(h.data.archived_at)throw new Error('Restore this household before emailing it.');to=h.data.email;}
 if(!z.email().safeParse(to).success)throw new Error('Correct the household email before retrying.');
 const suppressed=await scope.db.from('email_suppressions').select('reason').eq('wedding_id',scope.weddingId).eq('email',to.trim().toLowerCase()).maybeSingle();
 if(suppressed.error)throw new Error(suppressed.error.message);if(suppressed.data)throw new Error('This address is suppressed. Use a corrected address after confirming consent; suppression is never cleared automatically.');
 await enqueueEmail(scope,{key:`repair:${old.id}:${to.trim().toLowerCase()}`,to,subject:old.subject,html:old.html,householdId:old.household_id??undefined,kind:old.kind,metadata:{...old.metadata,repairOf:old.id}});
 revalidatePath('/admin/comms');return {message:'Only this message has been queued for the current address.'};
}
