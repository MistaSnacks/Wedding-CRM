import {describe,it,expect} from 'vitest';
import {suggestSeating} from './seating-suggestions';
describe('reviewed seating suggestions',()=>{
  it('keeps manual seats and prefers the same family table without exceeding capacity',()=>{
    const result=suggestSeating([{id:'h',displayName:'Family',guests:[{id:'a'},{id:'b'}]}],[{id:'t1',name:'One',capacity:2},{id:'t2',name:'Two',capacity:1}],[{guest_id:'a',table_id:'t1'}],['a','b']);
    expect(result).toEqual([{householdId:'h',householdName:'Family',tableId:'t1',tableName:'One',guestIds:['b']}]);
  });
  it('does not split a household or propose seats for declined guests',()=>{
    expect(suggestSeating([{id:'h',displayName:'Family',guests:[{id:'a'},{id:'b'},{id:'c'}]}],[{id:'t',name:'One',capacity:1}],[],['a','b'])).toEqual([]);
  });
});
