"use server";
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireEditor } from '@/lib/admin-auth';
import { forWedding } from '@/lib/data/scope';
import * as importsData from '@/lib/data/imports';
import * as households from '@/lib/data/households';
import { validateCsv,type CsvMapping,type RowError } from '@/lib/csv';
import { reconcileImport,normalizeImportName,type Reconciliation,type ImportDecision } from '@/lib/csv/reconciliation';
import { invalidateCache } from '@/lib/limiter';
import { z } from 'zod';
import { postgresIdSchema } from '@/lib/domain/rsvp-validation';
export type ValidateResult={ok:true;runId:string;households:number;guests:number;errors:RowError[];warnings:RowError[];reconciliation:Reconciliation[]}|{ok:false;errors:RowError[];warnings:RowError[]};
export type CommitResult={ok:true;households:number;guests:number;updated?:number}|{ok:false;errors:RowError[]};
function stable(value:unknown):string {if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).filter(([,v])=>v!==undefined).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';return JSON.stringify(value);}
function fingerprint(rows:Record<string,string>[],mapping:CsvMapping){return createHash('sha256').update(stable({rows,mapping})).digest('hex');}
export async function validateCsvImport(filename:string,rows:Record<string,string>[],mapping:CsvMapping):Promise<ValidateResult>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);
 if(rows.length>10000||Buffer.byteLength(JSON.stringify({rows,mapping}),'utf8')>3_000_000)return {ok:false,errors:[{line:0,message:'Import up to 10,000 rows and 3 MB of parsed data at a time.'}],warnings:[]};
 const context=await importsData.loadImportContext(scope);const validation=validateCsv(rows,mapping,context);
 if(!validation.households.length)return {ok:false,errors:validation.errors,warnings:validation.warnings};
 const reconciliation=reconcileImport(validation.households,await households.list(scope));
 const stats={households:validation.households.length,guests:validation.households.reduce((n,h)=>n+h.guests.length,0)};
 const payload=validation.households.map(h=>({...h,guests:h.guests.map(g=>({...g,normalizedName:normalizeImportName(`${g.firstName} ${g.lastName}`)})),inviteCode:importsData.newInviteCode(),accessToken:importsData.newAccessToken()}));
 const {data,error}=await scope.db.from('imports').insert({wedding_id:scope.weddingId,filename:filename.slice(0,500),status:'validated',stats,actor_id:admin.userId,source_fingerprint:fingerprint(rows,mapping),review_snapshot:{households:payload,context,reconciliation}}).select('id').single();
 if(error)throw new Error(error.message);
 return {ok:true,runId:data.id,...stats,errors:validation.errors,warnings:validation.warnings,reconciliation:reconciliation.map(r=>({...r,candidates:r.candidates.map(({id,name,reason,conflicts})=>({id,name,reason,conflicts}))}))};
}
const decisionsSchema=z.array(z.object({index:z.number().int().min(0),action:z.enum(['create','skip','append','update']),householdId:postgresIdSchema.optional(),overwriteFields:z.array(z.enum(['email','phone','mailing_address','preferred_locale','internal_notes'])).optional()})).max(10000);
export async function commitCsvImport(runId:string,rows:Record<string,string>[],mapping:CsvMapping,decisions:ImportDecision[]=[]):Promise<CommitResult>{
 const admin=await requireEditor();const scope=forWedding(admin.weddingId);
 try{
 if(rows.length>10000||Buffer.byteLength(JSON.stringify({rows,mapping}),'utf8')>3_000_000)throw new Error('Import up to 10,000 rows and 3 MB of parsed data at a time.');
 const choices=decisionsSchema.parse(decisions);if(new Set(choices.map(d=>d.index)).size!==choices.length)throw new Error('Choose one action per household.');
 const {data:run,error}=await scope.db.from('imports').select('review_snapshot,status').eq('wedding_id',scope.weddingId).eq('actor_id',admin.userId).eq('id',z.uuid().parse(runId)).single();if(error)throw new Error(error.message);
 if(run.status!=='committed'){const context=await importsData.loadImportContext(scope);if(stable(context)!==stable(run.review_snapshot?.context))throw new Error('Events or meal options changed. Review this import again.');}
 const result=await scope.db.rpc('commit_reviewed_import',{p_wedding:scope.weddingId,p_run:runId,p_actor:admin.userId,p_fingerprint:fingerprint(rows,mapping),p_decisions:choices});
 if(result.error)throw new Error(result.error.message);invalidateCache(`metrics:${scope.weddingId}`);for(const p of ['/admin','/admin/guests','/admin/imports'])revalidatePath(p);return {ok:true,...result.data};
 }catch(e){return {ok:false,errors:[{line:0,message:e instanceof Error?e.message:'The import could not be saved.'}]};}
}
