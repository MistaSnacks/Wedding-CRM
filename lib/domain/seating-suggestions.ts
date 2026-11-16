type Household = {id:string;displayName:string;guests:Array<{id:string}>};
export type SeatingSuggestion={householdId:string;householdName:string;tableId:string;tableName:string;guestIds:string[]};
/** Only propose empty placements. Existing manual assignments are never moved. */
export function suggestSeating(households:Household[],tables:Array<{id:string;name:string;capacity:number}>,assignments:Array<{guest_id:string;table_id:string}>,attendingIds:string[]):SeatingSuggestion[]{
  const attending=new Set(attendingIds),seated=new Map(assignments.map(a=>[a.guest_id,a.table_id]));
  const remaining=new Map(tables.map(t=>[t.id,t.capacity-assignments.filter(a=>a.table_id===t.id).length]));
  const result:SeatingSuggestion[]=[];
  for(const h of [...households].sort((a,b)=>b.guests.length-a.guests.length||a.id.localeCompare(b.id))){
    const missing=h.guests.filter(g=>attending.has(g.id)&&!seated.has(g.id)).map(g=>g.id);
    if(!missing.length)continue;
    const familyTables=new Set(h.guests.flatMap(g=>seated.has(g.id)?[seated.get(g.id)!]:[]));
    const fitting=tables.filter(t=>(remaining.get(t.id)??0)>=missing.length).sort((a,b)=>Number(familyTables.has(b.id))-Number(familyTables.has(a.id))||(remaining.get(a.id)!-remaining.get(b.id)!)||a.id.localeCompare(b.id));
    const table=fitting[0];if(!table)continue;
    result.push({householdId:h.id,householdName:h.displayName,tableId:table.id,tableName:table.name,guestIds:missing});remaining.set(table.id,remaining.get(table.id)!-missing.length);
  }
  return result;
}
