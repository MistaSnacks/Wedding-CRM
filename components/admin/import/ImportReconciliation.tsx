"use client";
import type { ImportDecision, Reconciliation } from "@/lib/csv/reconciliation";

export function ImportReconciliation({items,decisions,onChange,disabled}:{items:Reconciliation[];decisions:ImportDecision[];onChange:(next:ImportDecision[])=>void;disabled:boolean}) {
  const matched=items.filter(i=>i.candidates.length);
  if(!matched.length)return null;
  const update=(next:ImportDecision)=>onChange([...decisions.filter(d=>d.index!==next.index),next]);
  return <section className="mb-6 rounded-xl border border-hairline bg-white p-5" aria-label="Review existing households">
    <h2 className="font-display text-2xl">Review possible existing invitations</h2>
    <p className="my-2 text-sm">Choose an action for each match, then use the import button below. Adding guests preserves saved RSVPs and fills empty contact fields. Contact updates replace only the values you explicitly select.</p>
    {matched.map(item=>{
      const decision=decisions.find(d=>d.index===item.index);
      const candidate=item.candidates.find(c=>c.id===decision?.householdId);
      return <fieldset disabled={disabled} key={item.index} className="my-4 rounded-lg border border-hairline p-4">
        <legend className="px-2 font-semibold">{item.name}</legend>
        <label className="block text-sm">Action <select className="m-2 rounded border p-2" value={decision?.action??""} onChange={e=>{if(!e.target.value){onChange(decisions.filter(d=>d.index!==item.index));return;}update({index:item.index,action:e.target.value as ImportDecision['action'],householdId:item.candidates[0].id,overwriteFields:[]});}}>
          <option value="">Choose an action</option><option value="skip">Skip this imported invitation</option><option value="append">Add new guests to an existing invitation</option><option value="update">Update contact details only</option><option value="create">Create a separate invitation</option>
        </select></label>
        {(decision?.action==='append'||decision?.action==='update')&&<>
          <label className="block text-sm">Existing invitation <select className="m-2 rounded border p-2" value={decision.householdId} onChange={e=>update({...decision,householdId:e.target.value,overwriteFields:[]})}>{item.candidates.map(c=><option key={c.id} value={c.id}>{c.name} — {c.reason}</option>)}</select></label>
          {candidate?.conflicts.map(c=><div key={c.field} className="my-2 rounded bg-cream p-3 text-sm break-words"><p className="font-medium">{c.field.replaceAll('_',' ')}</p><p>Saved: {c.current}</p><p>Imported: {c.incoming}</p>{decision.action==='update'?<label className="mt-2 block"><input type="checkbox" checked={decision.overwriteFields?.includes(c.field)??false} onChange={e=>update({...decision,overwriteFields:e.target.checked?[...(decision.overwriteFields??[]),c.field]:(decision.overwriteFields??[]).filter(f=>f!==c.field)})}/> Replace the saved value</label>:<p className="mt-1">The saved value will be kept.</p>}</div>)}
        </>}
      </fieldset>;
    })}
  </section>;
}
