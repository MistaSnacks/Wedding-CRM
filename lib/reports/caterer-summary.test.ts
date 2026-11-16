import {it,expect} from 'vitest';
import {catererSummary} from './caterer-summary';
it('reconciles per-table totals without merging tables sharing a name',()=>{
  const [summary,meals,exceptions]=catererSummary({name:'Reception',rows:[{Event:'Reception',Table:'Family','Table ID':'a',Meal:'Beef',Dietary:''},{Event:'Reception',Table:'Family','Table ID':'b',Meal:'Beef',Dietary:'Nut allergy'},{Event:'Reception',Table:'UNASSIGNED','Table ID':'',Meal:'MISSING',Dietary:''}]});
  expect(summary.rows[0]).toMatchObject({Attendees:3,'Unassigned seats':1,'Missing meals':1});
  expect(meals.rows).toHaveLength(3);expect(meals.rows.reduce((n,r)=>n+Number(r.Count),0)).toBe(3);expect(exceptions.rows).toHaveLength(2);
});
