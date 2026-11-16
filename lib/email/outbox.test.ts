import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { WeddingScope } from '@/lib/data/scope';
import { processOutbox,enqueueEmail } from './outbox';
const send=vi.hoisted(()=>vi.fn());vi.mock('./send',()=>({sendEmail:send,confirmationHtml:vi.fn()}));
const row={id:'job-1',recipient:'guest@example.com',subject:'Hello',html:'<p>Hello</p>',claim_token:'lease-1',attempts:1,household_id:null,kind:'confirmation',metadata:{},sender:'Test <test@example.com>',reply_to:null};
function fake(opts:{suppressed?:boolean;finishError?:boolean}={}){
 const rpc=vi.fn(async(name:string)=> name==='claim_email_outbox'?{data:[row],error:null}:{data:!opts.finishError,error:opts.finishError?{message:'db unavailable'}:null});
 const upsert=vi.fn(async()=>({error:null}));
 const q:{select:()=>unknown;eq:()=>unknown;maybeSingle:()=>Promise<unknown>;upsert:typeof upsert}={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:opts.suppressed?{reason:'email.complained'}:null,error:null}),upsert};
 return {scope:{weddingId:'w',db:{rpc,from:()=>q}} as unknown as WeddingScope,rpc,upsert};
}
beforeEach(()=>{send.mockReset();});
describe('durable delivery',()=>{
 it('uses stable provider idempotency and records provider acceptance',async()=>{send.mockResolvedValue({id:'provider-1'});const f=fake();expect(await processOutbox(f.scope)).toMatchObject({sent:1});expect(send).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:'outbox/job-1'}));expect(f.rpc).toHaveBeenLastCalledWith('finish_email_outbox',expect.objectContaining({p_claim:'lease-1',p_state:'sent',p_message:'provider-1'}));});
 it('keeps rejected messages queued for a bounded retry, never reports sent',async()=>{send.mockRejectedValue(new Error('rate limited'));const f=fake();expect(await processOutbox(f.scope)).toMatchObject({sent:0,retried:1});expect(f.rpc).toHaveBeenLastCalledWith('finish_email_outbox',expect.objectContaining({p_state:'pending',p_error:'rate limited'}));});
 it('does not deliver to a complained address',async()=>{const f=fake({suppressed:true});expect(await processOutbox(f.scope)).toMatchObject({suppressed:1});expect(send).not.toHaveBeenCalled();});
 it('does not count a development preview as delivered',async()=>{send.mockResolvedValue({id:null});const f=fake();expect(await processOutbox(f.scope)).toMatchObject({sent:0,retried:1});});
 it('surfaces persistence failure instead of hiding accepted-but-unrecorded delivery',async()=>{send.mockResolvedValue({id:'provider-1'});const f=fake({finishError:true});await expect(processOutbox(f.scope)).rejects.toThrow('db unavailable');});
 it('enqueue preserves existing message state/content on repeated keys',async()=>{const f=fake();await enqueueEmail(f.scope,{key:'same',to:'a@b.com',subject:'x',html:'x'});expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({wedding_id:'w',dedupe_key:'same'}),{onConflict:'wedding_id,dedupe_key',ignoreDuplicates:true});});
});
describe('wedding merge fields',()=>{
 it('fills the wedding day, reply-by date and city of its own wedding at send time',async()=>{
  send.mockResolvedValue({id:'provider-1'});
  const f=fake();const merged={...row,subject:"You're invited [wedding date]",html:'<p>In [wedding place] on [wedding date]. Please RSVP by [reply-by date].</p>'};
  f.rpc.mockImplementation(async(name:string)=>name==='claim_email_outbox'?{data:[merged],error:null}:{data:true,error:null});
  const facts={couple_names:'Juliet & Juan',wedding_date:'2027-09-18',rsvp_deadline:'2027-07-02T06:59:00.000Z',timezone:'America/Los_Angeles',theme:{location_line:'Tom & Jerry, México'}};
  const from=f.scope.db.from as unknown as (t:string)=>unknown;
  (f.scope.db as unknown as {from:(t:string)=>unknown}).from=(t:string)=>t==='weddings'?{select:()=>({eq:()=>({single:async()=>({data:facts,error:null})})})}:from(t);
  await processOutbox(f.scope);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
   subject:"You're invited September 18, 2027",
   html:'<p>In Tom &amp; Jerry, México on September 18, 2027. Please RSVP by July 1, 2027.</p>',
  }));
 });
});
