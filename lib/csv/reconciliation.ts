import type { ImportHouseholdInput } from '@/lib/data/imports';
export type ImportDecision={index:number;action:'create'|'skip'|'append'|'update';householdId?:string;overwriteFields?:string[]};
export type ExistingImportHousehold={id:string;display_name:string;email:string|null;phone:string|null;mailing_address:unknown;preferred_locale:string;internal_notes:string|null;max_party_size:number;plus_one_slots:number;guests:Array<{id:string;first_name:string;last_name:string}>};
export type ImportCandidate={id:string;name:string;reason:string;conflicts:Array<{field:string;current:string;incoming:string}>;expected?:Record<string,unknown>;guestIds?:string[];guestNames?:string[]};
export type Reconciliation={index:number;name:string;candidates:ImportCandidate[]};
export const normalizeImportName=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
const norm=normalizeImportName;
export const CONTACT_FIELDS={email:'email',phone:'phone',mailing_address:'mailingAddress',preferred_locale:'preferredLocale',internal_notes:'internalNotes'} as const;
export function reconcileImport(inputs:ImportHouseholdInput[],existing:ExistingImportHousehold[]):Reconciliation[]{return inputs.map((input,index)=>{
 const names=new Set(input.guests.map(g=>norm(`${g.firstName} ${g.lastName}`)));
 const matches=existing.filter(h=>(!!input.email&&norm(input.email)===norm(h.email??''))||norm(input.displayName)===norm(h.display_name)||h.guests.some(g=>names.has(norm(`${g.first_name} ${g.last_name}`))));
 return {index,name:input.displayName,candidates:matches.map(h=>{
 const expected:Record<string,unknown>={email:h.email,phone:h.phone,mailing_address:h.mailing_address,preferred_locale:h.preferred_locale,internal_notes:h.internal_notes,max_party_size:h.max_party_size,plus_one_slots:h.plus_one_slots};
 const conflicts=Object.entries(CONTACT_FIELDS).flatMap(([field,key])=>{const incoming=input[key as keyof ImportHouseholdInput],current=expected[field];if(!incoming||!current||JSON.stringify(current)===JSON.stringify(incoming))return [];return [{field,current:typeof current==='string'?current:JSON.stringify(current),incoming:typeof incoming==='string'?incoming:JSON.stringify(incoming)}];});
 return {id:h.id,name:h.display_name,reason:input.email&&norm(input.email)===norm(h.email??'')?'Same contact email':norm(input.displayName)===norm(h.display_name)?'Same household name':'A guest name already exists',conflicts,expected,guestIds:h.guests.map(g=>g.id).sort(),guestNames:h.guests.map(g=>norm(`${g.first_name} ${g.last_name}`))};
 })};});}
