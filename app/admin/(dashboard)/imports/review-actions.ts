"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from 'next/cache';
import { requireEditor } from '@/lib/admin-auth';
import { forWedding } from '@/lib/data/scope';
import * as households from '@/lib/data/households';
import * as submissions from '@/lib/data/submissions';
import { newInviteCode,newAccessToken } from '@/lib/data/imports';
import { parseSubmission,csvReader } from '@/lib/sync/sheet';
import { resolveHouseholdPatch } from '@/lib/sync/apply';
import { configuredReader,runSync } from '@/lib/sync/run';
import { invalidateCache } from '@/lib/limiter';
export type ActionResult={ok:true;message:string}|{ok:false;message:string};
function refresh(weddingId:string){invalidateCache(`metrics:${weddingId}`);for(const p of ['/admin/imports','/admin/guests','/admin'])revalidatePath(p);}
export async function matchToHousehold(submissionId:string,householdId:string,version:string):Promise<ActionResult>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);
 try{const item=await submissions.byId(scope,submissionId);if(!item||item.status!=='pending')return {ok:false,message:'This response was already resolved. Refresh the inbox.'};
 if(createHash('sha256').update(JSON.stringify(item.raw)).digest('hex')!==version)throw new Error('This response changed. Refresh and review the updated details.');
 const detail=await households.byId(scope,householdId);if(!detail)throw new Error('Household no longer exists.');
 const {applied,skipped}=resolveHouseholdPatch(detail,parseSubmission(item.raw));
 await submissions.resolve(scope,{id:submissionId,householdId,action:'match',applied,actorId:admin.userId,expectedRaw:item.raw});refresh(scope.weddingId);
 return {ok:true,message:`Applied response to ${detail.display_name}. ${skipped.join(' ')}`};
 }catch(e){return {ok:false,message:e instanceof Error?e.message:'Could not apply the response.'};}
}
export async function createHouseholdFrom(submissionId:string,version:string):Promise<ActionResult>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);
 try{const item=await submissions.byId(scope,submissionId);if(!item||item.status!=='pending')throw new Error('This response was already resolved. Refresh the inbox.');
 if(createHash('sha256').update(JSON.stringify(item.raw)).digest('hex')!==version)throw new Error('This response changed. Refresh and review the updated details.');
 const s=parseSubmission(item.raw);if(!s.first&&!s.last)throw new Error('Add a name before creating this household.');
 const displayName=`${s.first} ${s.last}`.trim();
 await submissions.resolve(scope,{id:submissionId,action:'create',actorId:admin.userId,expectedRaw:item.raw,newHousehold:{displayName,email:s.email,phone:s.phone,mailingAddress:s.address?{raw:s.address,source:'save_the_date'}:null,locale:s.language,notes:s.notes?`[Save the Date ${s.receivedAt}] ${s.notes}`:null,status:s.optOut?'declined':'pending',first:s.first,last:s.last,inviteCode:newInviteCode(),accessToken:newAccessToken()}});
 refresh(scope.weddingId);return {ok:true,message:`Added ${displayName} as a new household.`};
 }catch(e){return {ok:false,message:e instanceof Error?e.message:'Could not create the household.'};}
}
export async function ignoreSubmission(submissionId:string):Promise<ActionResult>{return resolveSimple(submissionId,'ignore');}
export async function undoSubmission(submissionId:string):Promise<ActionResult>{return resolveSimple(submissionId,'undo');}
async function resolveSimple(id:string,action:'ignore'|'undo'):Promise<ActionResult>{const admin=await requireEditor();const scope=forWedding(admin.weddingId);try{await submissions.resolve(scope,{id,action,actorId:admin.userId});refresh(scope.weddingId);return {ok:true,message:action==='undo'?'Undone — the response is back in the inbox.':'Filed away.'};}catch(e){return {ok:false,message:e instanceof Error?e.message:'Could not update the response.'};}}
export async function syncNow():Promise<ActionResult>{const admin=await requireEditor();const scope=forWedding(admin.weddingId);const reader=configuredReader();if(!reader)return {ok:false,message:'The sheet is not connected. Upload its CSV export below.'};try{const r=await runSync(scope,reader,{actorId:admin.userId});refresh(scope.weddingId);return {ok:true,message:`Read ${r.read} rows — ${r.inserted} new, ${r.autoApplied} matched, ${r.pending} waiting for review.`};}catch(e){revalidatePath('/admin/imports');return {ok:false,message:e instanceof Error?e.message:'The check failed.'};}}
export async function importSheetCsv(csv:string):Promise<ActionResult>{const admin=await requireEditor();const scope=forWedding(admin.weddingId);if(csv.length>2_000_000)return {ok:false,message:'Please upload a CSV smaller than 2 MB.'};try{const r=await runSync(scope,csvReader(csv),{actorId:admin.userId});refresh(scope.weddingId);return {ok:true,message:`Read ${r.read} rows — ${r.inserted} new, ${r.autoApplied} matched, ${r.pending} waiting for review.`};}catch(e){return {ok:false,message:e instanceof Error?e.message:'The CSV could not be read.'};}}
