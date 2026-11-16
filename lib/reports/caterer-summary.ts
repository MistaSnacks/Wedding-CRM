import type { ReportTable } from './guest-reports';
export function catererSummary(table:ReportTable):ReportTable[] {
  const stamp: Record<string,string|number>=table.rows[0]?{Event:table.rows[0].Event,'Generated at':table.rows[0]['Generated at'] ?? ''}:{Event:table.name};
  const groups=new Map<string,{Table:string;'Table ID':string;Meal:string;Count:number}>();
  for(const row of table.rows){
    const key=JSON.stringify([row['Table ID'],row.Meal]);
    const current=groups.get(key)??{Table:String(row.Table),'Table ID':String(row['Table ID']),Meal:String(row.Meal),Count:0};
    current.Count++;groups.set(key,current);
  }
  return [
    {name:'Handoff summary',rows:[{...stamp,Attendees:table.rows.length,'Unassigned seats':table.rows.filter(r=>r.Table==='UNASSIGNED').length,'Missing meals':table.rows.filter(r=>r.Meal==='MISSING').length,'Dietary exceptions':table.rows.filter(r=>r.Dietary).length}]},
    {name:'Meals by table',rows:[...groups.values()].map(row=>({...stamp,...row}))},
    {name:'Exceptions',rows:table.rows.filter(r=>r.Table==='UNASSIGNED'||r.Meal==='MISSING'||r.Dietary)},
  ];
}
