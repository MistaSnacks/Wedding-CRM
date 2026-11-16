import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {WeddingScope} from '@/lib/data/scope';
import {runAutomations} from './run';
const mocks=vi.hoisted(()=>({enqueue:vi.fn(),process:vi.fn(),replay:vi.fn()}));
vi.mock('@/lib/email/outbox',()=>({enqueueEmail:mocks.enqueue,processOutbox:mocks.process,replayWebhookEvents:mocks.replay}));
beforeEach(()=>{mocks.enqueue.mockReset();mocks.process.mockReset().mockResolvedValue({sent:0,retried:0,failed:0,suppressed:0});mocks.replay.mockReset().mockResolvedValue(undefined);});
function database(error=false){const updates:unknown[]=[];class Q{
 constructor(private table:string){}select(){return this;}eq(){return this;}insert(){return this;}update(p:unknown){updates.push(p);return this;}
 async single(){return {data:{id:'run'},error:null};}
 async maybeSingle(){return {data:null,error:error?{message:'Settings temporarily unavailable'}:null};}
 then(resolve:(v:{error:null})=>unknown,reject:(e:unknown)=>unknown){return Promise.resolve({error:null}).then(resolve,reject);}
 }
 return {updates,scope:{weddingId:'w',db:{from:(table:string)=>new Q(table)}} as unknown as WeddingScope};}
describe('automation run durability',()=>{
 it('does not generate scheduled mail when no settings are enabled, but drains approved work',async()=>{const f=database();await runAutomations(f.scope);expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.process).toHaveBeenCalledWith(f.scope,{limit:25});expect(f.updates).toContainEqual(expect.objectContaining({state:'success'}));});
 it('still drains approved work after a scheduler error and records durable failure',async()=>{const f=database(true);await expect(runAutomations(f.scope)).rejects.toThrow('Settings temporarily unavailable');expect(mocks.process).toHaveBeenCalled();expect(f.updates).toContainEqual(expect.objectContaining({state:'failed',error:'Settings temporarily unavailable'}));});
});
