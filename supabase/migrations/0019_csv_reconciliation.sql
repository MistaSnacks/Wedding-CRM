alter table imports add column review_snapshot jsonb;
alter table imports add column actor_id uuid references auth.users(id);

create function commit_reviewed_import(p_wedding uuid,p_run uuid,p_actor uuid,p_fingerprint text,p_decisions jsonb default '[]') returns jsonb
language plpgsql security definer set search_path=public as $$
declare r imports; prior imports; item jsonb; rec jsonb; decision jsonb; candidate jsonb; h households;
 creates jsonb:='[]'; patch jsonb; k text; source_key text; incoming jsonb; guest jsonb; gid uuid; guest_ids jsonb;
 guest_names jsonb; normalized_guest text;
 result jsonb; added integer:=0; changed integer:=0; idx integer:=0; action text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_wedding::text||':csv',0));
 select * into r from imports where id=p_run and wedding_id=p_wedding and actor_id=p_actor for update;
 if not found or r.source_fingerprint is distinct from p_fingerprint then raise exception 'The file or mapping changed. Review the import again.'; end if;
 if r.status='committed' then return r.stats; end if;
 select * into prior from imports where wedding_id=p_wedding and source_fingerprint=p_fingerprint and status='committed' limit 1;
 if found then return prior.stats; end if;
 if r.status<>'validated' or r.review_snapshot is null then raise exception 'This import is not ready to commit.'; end if;
 for item in select * from jsonb_array_elements(r.review_snapshot->'households') loop
 rec:=r.review_snapshot->'reconciliation'->idx;
 select x into decision from jsonb_array_elements(p_decisions) x where (x->>'index')::integer=idx;
 if decision is null and jsonb_array_length(rec->'candidates')>0 then raise exception 'Choose how to handle existing household %',item->>'displayName'; end if;
 action:=coalesce(decision->>'action','create');
 if action='create' then creates:=creates||jsonb_build_array(item);
 elsif action='skip' then null;
 elsif action in ('append','update') then
 select x into candidate from jsonb_array_elements(rec->'candidates') x where x->>'id'=decision->>'householdId';
 if candidate is null then raise exception 'Select a reviewed household match.'; end if;
 select * into h from households where id=(candidate->>'id')::uuid and wedding_id=p_wedding and archived_at is null for update;
 if not found then raise exception 'The matched household changed. Review the import again.'; end if;
 for k,incoming in select * from jsonb_each(candidate->'expected') loop
 if to_jsonb(h)->k is distinct from incoming then raise exception 'The matched household % changed. Review again.',h.display_name; end if;
 end loop;
 select coalesce(jsonb_agg(id::text order by id::text),'[]') into guest_ids from guests where household_id=h.id and wedding_id=p_wedding;
 if guest_ids is distinct from candidate->'guestIds' then raise exception 'Guests in % changed. Review the import again.',h.display_name; end if;
 patch:='{}';
 for k,source_key in select * from (values('email','email'),('phone','phone'),('mailing_address','mailingAddress'),('preferred_locale','preferredLocale'),('internal_notes','internalNotes')) fields(field,source) loop
 incoming:=item->source_key;
 if incoming is null or incoming='null'::jsonb or incoming='""'::jsonb then continue; end if;
 if to_jsonb(h)->k='null'::jsonb or to_jsonb(h)->k='""'::jsonb or (action='update' and coalesce(decision->'overwriteFields','[]') ? k) then
 patch:=patch||jsonb_build_object(k,incoming); end if;
 end loop;
 h:=jsonb_populate_record(h,patch);
 update households set email=h.email,phone=h.phone,mailing_address=h.mailing_address,preferred_locale=h.preferred_locale,internal_notes=h.internal_notes,updated_at=now() where id=h.id;
 if action='append' then
 guest_names:=coalesce(candidate->'guestNames','[]');
 for guest in select * from jsonb_array_elements(item->'guests') loop
 normalized_guest:=coalesce(guest->>'normalizedName',lower(trim((guest->>'firstName')||' '||(guest->>'lastName'))));
 if not (guest_names ? normalized_guest) and not exists(select 1 from guests where wedding_id=p_wedding and household_id=h.id and lower(trim(first_name))=lower(trim(guest->>'firstName')) and lower(trim(last_name))=lower(trim(guest->>'lastName'))) then
 if guest->>'origin'='plus_one' and (select count(*) from guests where household_id=h.id and origin='plus_one')>=h.plus_one_slots then raise exception 'Increase plus-one slots for % before appending this guest.',h.display_name; end if;
 insert into guests(wedding_id,household_id,first_name,last_name,age_type,relationship,origin,dietary_restrictions)
 values(p_wedding,h.id,guest->>'firstName',guest->>'lastName',coalesce(guest->>'ageType','adult'),guest->>'relationship',coalesce(guest->>'origin','named'),guest->>'dietaryRestrictions') returning id into gid;
 -- New guests inherit the household's existing invites; old RSVP answers never change.
 insert into guest_event_responses(wedding_id,guest_id,event_id,attending)
 select p_wedding,gid,event_id,'pending' from household_event_invites where wedding_id=p_wedding and household_id=h.id;
 added:=added+1; guest_names:=guest_names||jsonb_build_array(normalized_guest);
 end if;
 end loop;
 update households set max_party_size=greatest(max_party_size,(select count(*) from guests where household_id=h.id)),rsvp_status=case when exists(select 1 from guest_event_responses gr join guests g on g.id=gr.guest_id where g.household_id=h.id and gr.attending='pending') then 'started' else rsvp_status end where id=h.id;
 end if;
 changed:=changed+1;
 else raise exception 'Invalid reconciliation choice'; end if;
 idx:=idx+1;
 end loop;
 -- The existing importer handles only explicitly new households, inside this transaction.
 result:=import_households(p_wedding,p_run,creates);
 result:=jsonb_build_object('households',(result->>'households')::integer,'guests',(result->>'guests')::integer+added,'updated',changed);
 update imports set stats=result where id=p_run;
 insert into activity_log(wedding_id,actor_type,actor_id,action,payload) values(p_wedding,'admin',p_actor,'import.completed',jsonb_build_object('runId',p_run,'result',result));
 return result;
end $$;
revoke execute on function commit_reviewed_import(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function commit_reviewed_import(uuid,uuid,uuid,text,jsonb) to service_role;
