import {describe,it,expect} from 'vitest';
import {reconcileImport,type ExistingImportHousehold} from './reconciliation';
import type {ImportHouseholdInput} from '@/lib/data/imports';
const existing:ExistingImportHousehold={id:'a',display_name:'Ana Family',email:'family@example.com',phone:'123',mailing_address:{raw:'Home',source:'admin'},preferred_locale:'en',internal_notes:'Keep this',max_party_size:2,plus_one_slots:0,guests:[{id:'g1',first_name:'Ana',last_name:'Garcia'}]};
const incoming:ImportHouseholdInput={displayName:'Different label',email:'family@example.com',phone:'456',maxPartySize:1,plusOneSlots:0,guests:[{firstName:'Ana',lastName:'Garcia'}]};
describe('CSV reconciliation',()=>{
 it('requires explicit review when a contact or guest already exists',()=>{const r=reconcileImport([incoming],[existing]);expect(r[0].candidates).toHaveLength(1);expect(r[0].candidates[0]).toMatchObject({id:'a',reason:'Same contact email'});});
 it('identifies conflicts without choosing to overwrite them',()=>{const c=reconcileImport([incoming],[existing])[0].candidates[0];expect(c.conflicts).toContainEqual({field:'phone',current:'123',incoming:'456'});expect(c.expected?.internal_notes).toBe('Keep this');});
 it('distinguishes unmatched new households',()=>expect(reconcileImport([{...incoming,email:'new@example.com',guests:[{firstName:'Ben',lastName:'Other'}]}],[existing])[0].candidates).toEqual([]));
 it('does not silently pick one household sharing an email',()=>expect(reconcileImport([incoming],[existing,{...existing,id:'b',display_name:'Other family'}])[0].candidates).toHaveLength(2));
 it('matches existing guest names despite accents and casing',()=>expect(reconcileImport([{...incoming,email:undefined,guests:[{firstName:'ANA',lastName:'García'}]}],[existing])[0].candidates[0].reason).toBe('A guest name already exists'));
});
