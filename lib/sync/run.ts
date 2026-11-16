import type { WeddingScope } from '@/lib/data/scope';
import * as households from '@/lib/data/households';
import * as submissions from '@/lib/data/submissions';
import { env } from '@/lib/env';
import { invalidateCache } from '@/lib/limiter';
import { classify, scoreCandidates, type MatchCandidateInput } from './match';
import { resolveHouseholdPatch } from './apply';
import { SheetAccessError, googleSheetReader, parseSubmission, rowKey, type SheetReader } from './sheet';
export type SyncResult={read:number;inserted:number;autoApplied:number;pending:number;preview?:Array<{name:string;householdName:string;fields:string[]}>};
export function assertNotSuddenlyEmpty(rowsRead:number,knownRows:number){if(rowsRead===0&&knownRows>0)throw new SheetAccessError("The Save-the-Date sheet came back empty, but we've read responses from it before. Nothing was changed — check sharing and the tab.",'shape');}
export function isOpenForAutoApply(seen:{status:string;everResolved:boolean}|undefined){return !seen||(seen.status==='pending'&&!seen.everResolved);}
export async function loadCandidatePool(scope:WeddingScope):Promise<MatchCandidateInput[]>{
 const rows=await households.list(scope);return rows.flatMap(h=>h.guests.map(g=>({guestId:g.id,firstName:g.first_name,lastName:g.last_name,householdId:h.id,householdName:h.display_name,householdEmail:h.email})));
}
export async function runSync(scope:WeddingScope,reader:SheetReader,opts:{actorId?:string;dryRun?:boolean}={}):Promise<SyncResult>{
 let runId:string|undefined;
 if(!opts.dryRun){const start=await scope.db.rpc('begin_sheet_sync',{p_wedding:scope.weddingId});if(start.error)throw new Error(start.error.message);runId=start.data;}
 try{
 const rows=await reader();const original=await submissions.listKeys(scope);assertNotSuddenlyEmpty(rows.length,original.size);
 const keyed=[...new Map(rows.map(row=>[rowKey(row),{row,key:rowKey(row)}])).values()];
 let inserted=0;
 if(!opts.dryRun)inserted=await submissions.upsertMany(scope,keyed.map(r=>({rowKey:r.key,raw:r.row,receivedAt:null})));
 const known=opts.dryRun?original:await submissions.listKeys(scope);
 const open=keyed.filter(r=>isOpenForAutoApply(known.get(r.key)));
 const pool=await loadCandidatePool(scope);let autoApplied=0;
 const preview:NonNullable<SyncResult['preview']>=[];
 const deadline=Date.now()+35000;
 for(const {row,key} of open){
 if(Date.now()>deadline)break; // remaining pending rows are safely resumed by the next invocation
 const parsed=parseSubmission(row);if(!parsed.first&&!parsed.last&&!parsed.email)continue;
 if(/opt.?out/i.test(parsed.notes)&&!parsed.optOut)continue; // ambiguous opt-out language belongs in human review
 // Avoid all fuzzy scoring for exact identity; it cannot authorize an automatic match.
 const decision=classify(parsed,[],pool);if(decision.bucket!=='auto_email')continue;
 const detail=await households.byId(scope,decision.householdId);if(!detail)continue;
 const {patch,applied}=resolveHouseholdPatch(detail,parsed);
 if(opts.dryRun){preview.push({name:`${parsed.first} ${parsed.last}`.trim(),householdName:detail.display_name,fields:Object.keys(patch)});autoApplied++;continue;}
 const id=known.get(key)?.id;if(!id)continue;
 await submissions.resolve(scope,{id,householdId:detail.id,action:'auto',applied,actorId:opts.actorId,expectedRaw:row});autoApplied++;
 }
 invalidateCache(`metrics:${scope.weddingId}`);
 const result:SyncResult={read:rows.length,inserted,autoApplied,pending:opts.dryRun?open.length-autoApplied:(await submissions.listByStatus(scope,'pending')).length,...(opts.dryRun?{preview}:{})};
 if(runId){const r=await scope.db.from('sync_runs').update({state:'success',finished_at:new Date().toISOString(),result}).eq('wedding_id',scope.weddingId).eq('id',runId);if(r.error)throw new Error(r.error.message);}
 return result;
 }catch(e){if(runId){await scope.db.from('sync_runs').update({state:'failed',finished_at:new Date().toISOString(),error:e instanceof Error?e.message:'Sync failed'}).eq('wedding_id',scope.weddingId).eq('id',runId);}throw e;}
}
export function configuredReader():SheetReader|null{const e=env();if(!e.GOOGLE_SERVICE_ACCOUNT_EMAIL||!e.GOOGLE_PRIVATE_KEY||!e.SAVE_THE_DATE_SHEET_ID)return null;return googleSheetReader({clientEmail:e.GOOGLE_SERVICE_ACCOUNT_EMAIL,privateKey:e.GOOGLE_PRIVATE_KEY,sheetId:e.SAVE_THE_DATE_SHEET_ID,range:e.SAVE_THE_DATE_RANGE});}
