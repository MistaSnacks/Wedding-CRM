-- Readiness: every RSVP derives from the same active invited guest/event requirements.
-- Service-role only mutations. New functions never inherit public RPC access.
alter table guests add column if not exists rsvp_client_id uuid;
create unique index if not exists guests_rsvp_client_id on guests(household_id, rsvp_client_id) where rsvp_client_id is not null;

create or replace function recompute_rsvp_status(p_wedding_id uuid, p_household_ids uuid[])
returns void language sql security definer set search_path=public as $$
 with facts as (
  select h.id, count(e.id) total,
   count(e.id) filter(where r.attending='no') declined,
   count(e.id) filter(where r.attending in ('yes','no')) answered,
   count(e.id) filter(where coalesce(r.attending,'pending')='pending' or
    (r.attending='yes' and exists(select 1 from meal_options m where m.wedding_id=h.wedding_id and (m.event_id is null or m.event_id=e.id) and (g.age_type<>'adult' or not m.is_kids_meal)) and
     not exists(select 1 from meal_options m where m.id=r.meal_option_id and m.wedding_id=h.wedding_id and (m.event_id is null or m.event_id=e.id) and (g.age_type<>'adult' or not m.is_kids_meal)))) missing
  from households h
  left join guests g on g.household_id=h.id and g.wedding_id=h.wedding_id
  left join household_event_invites i on i.household_id=h.id and i.wedding_id=h.wedding_id
  left join events e on e.id=i.event_id and e.wedding_id=h.wedding_id and e.rsvp_enabled and g.id is not null
  left join guest_event_responses r on r.guest_id=g.id and r.event_id=e.id and r.wedding_id=h.wedding_id
  where h.wedding_id=p_wedding_id and h.id=any(p_household_ids) group by h.id
 ), derived as (
  select id, case when total=0 then 'pending' when declined=total then 'declined'
   when missing=0 then 'completed' when answered>0 then 'started' else 'pending' end status from facts
 ) update households h set rsvp_status=d.status,updated_at=now() from derived d where h.id=d.id and h.rsvp_status<>d.status;
$$;
revoke all on function recompute_rsvp_status(uuid,uuid[]) from public,anon,authenticated;
grant execute on function recompute_rsvp_status(uuid,uuid[]) to service_role;

create or replace function maintain_rsvp_requirements() returns trigger language plpgsql security definer set search_path=public as $$
declare w uuid; ids uuid[];
begin
 if tg_table_name='guests' then
  if tg_op<>'DELETE' then
   insert into guest_event_responses(guest_id,event_id,wedding_id)
   select new.id,i.event_id,new.wedding_id from household_event_invites i where i.household_id=new.household_id and i.wedding_id=new.wedding_id on conflict do nothing;
   w:=new.wedding_id; ids:=array[new.household_id];
  else w:=old.wedding_id; ids:=array[old.household_id]; end if;
  if tg_op='UPDATE' and old.household_id<>new.household_id then ids:=ids||old.household_id; end if;
 elsif tg_table_name='household_event_invites' then
  if tg_op<>'DELETE' then
   insert into guest_event_responses(guest_id,event_id,wedding_id) select g.id,new.event_id,new.wedding_id from guests g where g.household_id=new.household_id and g.wedding_id=new.wedding_id on conflict do nothing;
   w:=new.wedding_id; ids:=array[new.household_id];
  else w:=old.wedding_id; ids:=array[old.household_id]; end if;
 elsif tg_table_name='guest_event_responses' then
  if tg_op='DELETE' then w:=old.wedding_id; select array[household_id] into ids from guests where id=old.guest_id;
  else w:=new.wedding_id; select array[household_id] into ids from guests where id=new.guest_id; end if;
 else
  if tg_op='DELETE' then w:=old.wedding_id; else w:=new.wedding_id; end if;
  select array_agg(id) into ids from households where wedding_id=w;
 end if;
 perform recompute_rsvp_status(w,coalesce(ids,'{}'));
 return null;
end $$;
revoke all on function maintain_rsvp_requirements() from public,anon,authenticated;
create trigger guests_rsvp_requirements after insert or update or delete on guests for each row execute function maintain_rsvp_requirements();
create trigger invites_rsvp_requirements after insert or update or delete on household_event_invites for each row execute function maintain_rsvp_requirements();
create trigger responses_rsvp_requirements after insert or update or delete on guest_event_responses for each row execute function maintain_rsvp_requirements();
create trigger events_rsvp_requirements after update or delete on events for each row execute function maintain_rsvp_requirements();
create trigger meals_rsvp_requirements after insert or update or delete on meal_options for each row execute function maintain_rsvp_requirements();

-- All membership paths share one lock and one last-owner invariant.
create function manage_wedding_member(p_wedding_id uuid,p_user_id uuid,p_role text,p_actor_id uuid,p_remove boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare previous text;
begin
 perform 1 from weddings where id=p_wedding_id for update;
 if not exists(select 1 from wedding_members where wedding_id=p_wedding_id and user_id=p_actor_id and role='owner') then raise exception 'Only an owner can manage team members.'; end if;
 select role into previous from wedding_members where wedding_id=p_wedding_id and user_id=p_user_id;
 if p_remove and p_actor_id=p_user_id then raise exception 'You cannot remove your own access.'; end if;
 if not p_remove and (p_role is null or p_role not in ('owner','editor','viewer')) then raise exception 'Invalid member role.'; end if;
 if previous='owner' and (p_remove or p_role<>'owner') and (select count(*) from wedding_members where wedding_id=p_wedding_id and role='owner')<=1 then raise exception 'This wedding must keep at least one owner.'; end if;
 if p_remove then delete from wedding_members where wedding_id=p_wedding_id and user_id=p_user_id;
 else insert into wedding_members(wedding_id,user_id,role) values(p_wedding_id,p_user_id,p_role) on conflict(user_id,wedding_id) do update set role=excluded.role; end if;
 insert into activity_log(wedding_id,actor_type,actor_id,action,payload) values(p_wedding_id,'admin',p_actor_id,case when p_remove then 'member.removed' else 'member.role_changed' end,jsonb_build_object('userId',p_user_id,'from',previous,'to',p_role));
end $$;
revoke all on function manage_wedding_member(uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function manage_wedding_member(uuid,uuid,text,uuid,boolean) to service_role;

create or replace function submit_rsvp(p_household_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare h households%rowtype; v_guest guests%rowtype; e events%rowtype; q rsvp_questions%rowtype;
 r jsonb; resp jsonb; v_guest_id uuid; v_via text:=coalesce(p_payload->>'via','guest');
 v_complete boolean:=coalesce((p_payload->>'complete')::boolean,false); v_status text;
begin
 select * into h from households where id=p_household_id for update;
 if not found then raise exception 'not_found'; end if;
 if h.archived_at is not null then raise exception 'not_found'; end if;
 if v_via not in ('guest','admin') then raise exception 'invalid_payload'; end if;
 if v_via='guest' and exists(select 1 from weddings where id=h.wedding_id and rsvp_deadline<now()) then raise exception 'deadline_passed'; end if;
 -- Explicit removals never infer deletion from an omitted/stale browser snapshot.
 for r in select value from jsonb_array_elements(coalesce(p_payload->'remove_plus_one_ids','[]')) loop
  if exists(select 1 from guests where id=(r#>>'{}')::uuid and household_id=h.id and origin<>'plus_one') then raise exception 'unknown_guest'; end if;
  delete from guests where id=(r#>>'{}')::uuid and household_id=h.id and wedding_id=h.wedding_id and origin='plus_one';
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p_payload->'new_plus_ones','[]')) loop
  if length(trim(coalesce(r->>'first_name','')))=0 or length(trim(coalesce(r->>'last_name','')))=0 then raise exception 'empty_name'; end if;
  v_guest_id:=null;
  if nullif(r->>'guest_id','') is not null then
   select id into v_guest_id from guests where id=(r->>'guest_id')::uuid and household_id=h.id and wedding_id=h.wedding_id and origin='plus_one';
   if not found then raise exception 'unknown_guest'; end if;
  elsif nullif(r->>'client_id','') is not null then
   select id into v_guest_id from guests where household_id=h.id and rsvp_client_id=(r->>'client_id')::uuid;
  else
   -- Compatibility for an old browser. New clients always supply a stable UUID.
   select id into v_guest_id from guests where household_id=h.id and origin='plus_one' and lower(trim(first_name))=lower(trim(r->>'first_name')) and lower(trim(last_name))=lower(trim(r->>'last_name')) limit 1;
  end if;
  if v_guest_id is null then
   if (select count(*) from guests where household_id=h.id and origin='plus_one')>=h.plus_one_slots then raise exception 'no_plus_one_slot'; end if;
   if (select count(*) from guests where household_id=h.id)>=h.max_party_size then raise exception 'over_party_size'; end if;
   insert into guests(wedding_id,household_id,first_name,last_name,origin,rsvp_client_id) values(h.wedding_id,h.id,trim(r->>'first_name'),trim(r->>'last_name'),'plus_one',nullif(r->>'client_id','')::uuid) returning id into v_guest_id;
  else update guests set first_name=trim(r->>'first_name'),last_name=trim(r->>'last_name'),updated_at=now() where id=v_guest_id; end if;
  for resp in select value from jsonb_array_elements(coalesce(r->'responses','[]')) loop
   p_payload:=jsonb_set(p_payload,'{responses}',coalesce(p_payload->'responses','[]')||jsonb_build_array(resp||jsonb_build_object('guest_id',v_guest_id)));
  end loop;
 end loop;
 for resp in select value from jsonb_array_elements(coalesce(p_payload->'responses','[]')) loop
  select * into v_guest from guests where id=(resp->>'guest_id')::uuid and household_id=h.id and wedding_id=h.wedding_id;
  if not found then raise exception 'unknown_guest'; end if;
  select ev.* into e from events ev join household_event_invites i on i.event_id=ev.id and i.wedding_id=ev.wedding_id where i.household_id=h.id and ev.id=(resp->>'event_id')::uuid and ev.wedding_id=h.wedding_id;
  if not found or (v_via='guest' and not e.rsvp_enabled) then continue; end if;
  if coalesce(resp->>'attending','pending') not in ('yes','no','pending') then raise exception 'invalid_payload'; end if;
  if nullif(resp->>'meal_option_id','') is not null and not exists(select 1 from meal_options m where m.id=(resp->>'meal_option_id')::uuid and m.wedding_id=h.wedding_id and (m.event_id is null or m.event_id=e.id) and (v_guest.age_type<>'adult' or not m.is_kids_meal)) then raise exception 'invalid_meal'; end if;
  insert into guest_event_responses(guest_id,event_id,wedding_id,attending,meal_option_id,responded_at,responded_via)
   values(v_guest.id,e.id,h.wedding_id,coalesce(resp->>'attending','pending'),case when resp->>'attending'='yes' then nullif(resp->>'meal_option_id','')::uuid else null end,now(),v_via)
   on conflict(guest_id,event_id) do update set attending=excluded.attending,meal_option_id=excluded.meal_option_id,responded_at=excluded.responded_at,responded_via=excluded.responded_via;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p_payload->'guest_fields','[]')) loop
  if not exists(select 1 from guests where id=(r->>'guest_id')::uuid and household_id=h.id and wedding_id=h.wedding_id) then raise exception 'unknown_guest'; end if;
  update guests set dietary_restrictions=case when r?'dietary_restrictions' then r->>'dietary_restrictions' else dietary_restrictions end,allergies=case when r?'allergies' then r->>'allergies' else allergies end,updated_at=now() where id=(r->>'guest_id')::uuid;
 end loop;
 for r in select value from jsonb_array_elements(coalesce(p_payload->'answers','[]')) loop
  select * into q from rsvp_questions where id=(r->>'question_id')::uuid and wedding_id=h.wedding_id and is_active and (event_id is null or exists(select 1 from household_event_invites where household_id=h.id and event_id=rsvp_questions.event_id));
  if not found then raise exception 'invalid_answer'; end if;
  if (q.scope='guest' and nullif(r->>'guest_id','') is null) or (q.scope='household' and nullif(r->>'guest_id','') is not null) then raise exception 'invalid_answer'; end if;
  if nullif(r->>'guest_id','') is not null and not exists(select 1 from guests where id=(r->>'guest_id')::uuid and household_id=h.id) then raise exception 'unknown_guest'; end if;
  if (q.type='boolean' and jsonb_typeof(r->'value')<>'boolean') or (q.type in ('text','select') and jsonb_typeof(r->'value')<>'string') or (q.type='select' and not coalesce(q.options,'[]') @> jsonb_build_array(r->'value')) then raise exception 'invalid_answer'; end if;
  insert into rsvp_answers(wedding_id,question_id,household_id,guest_id,value) values(h.wedding_id,q.id,h.id,nullif(r->>'guest_id','')::uuid,r->'value') on conflict(question_id,household_id,coalesce(guest_id,'00000000-0000-0000-0000-000000000000')) do update set value=excluded.value,updated_at=now();
 end loop;
 perform recompute_rsvp_status(h.wedding_id,array[h.id]);
 select rsvp_status into v_status from households where id=h.id;
 if v_complete and v_status not in ('completed','declined') then raise exception 'incomplete_rsvp'; end if;
 if v_complete and v_via='guest' and p_payload?'confirmation' then
  insert into email_outbox(wedding_id,dedupe_key,household_id,recipient,subject,html,kind)
  values(h.wedding_id,'rsvp:'||h.id||':'||md5(
   coalesce((select jsonb_agg(jsonb_build_array(g.id,g.first_name,g.last_name,g.dietary_restrictions,g.allergies) order by g.id)::text from guests g where g.household_id=h.id),'[]') ||
   coalesce((select jsonb_agg(jsonb_build_array(r.guest_id,r.event_id,r.attending,r.meal_option_id) order by r.guest_id,r.event_id)::text from guest_event_responses r join guests g on g.id=r.guest_id where g.household_id=h.id),'[]')
  ),h.id,p_payload->'confirmation'->>'recipient',p_payload->'confirmation'->>'subject',p_payload->'confirmation'->>'html','confirmation') on conflict(wedding_id,dedupe_key) do nothing;
 end if;
 insert into activity_log(wedding_id,household_id,actor_type,actor_id,action,payload) values(h.wedding_id,h.id,v_via,nullif(p_payload->>'actor_id','')::uuid,case when v_complete then 'rsvp.'||v_status else 'rsvp.saved' end,jsonb_build_object('status',v_status));
 return jsonb_build_object('status',v_status,
  'guests',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'age_type',g.age_type,'origin',g.origin,'dietary_restrictions',g.dietary_restrictions,'allergies',g.allergies,'rsvp_client_id',g.rsvp_client_id) order by g.created_at,g.id) from guests g where g.household_id=h.id),'[]'::jsonb),
  'responses',coalesce((select jsonb_agg(jsonb_build_object('guest_id',r.guest_id,'event_id',r.event_id,'attending',r.attending,'meal_option_id',r.meal_option_id,'responded_at',r.responded_at,'responded_via',r.responded_via)) from guest_event_responses r join guests g on g.id=r.guest_id where g.household_id=h.id),'[]'::jsonb));
end $$;
revoke all on function submit_rsvp(uuid,jsonb) from public,anon,authenticated;
grant execute on function submit_rsvp(uuid,jsonb) to service_role;

-- Reconcile historical missing combinations, retaining all existing replies.
insert into guest_event_responses(guest_id,event_id,wedding_id)
 select g.id,i.event_id,g.wedding_id from guests g join household_event_invites i on i.household_id=g.household_id and i.wedding_id=g.wedding_id on conflict do nothing;
select recompute_rsvp_status(w.id,array(select id from households where wedding_id=w.id)) from weddings w;

alter table households add column if not exists archived_at timestamptz;
alter table households add column if not exists creation_key uuid;
create unique index if not exists household_creation_key on households(wedding_id,creation_key) where creation_key is not null;
alter table guests add column if not exists creation_key uuid;
create unique index if not exists guest_creation_key on guests(wedding_id,creation_key) where creation_key is not null;

create function create_household_atomic(p_wedding_id uuid,p_input jsonb,p_actor_id uuid,p_operation_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare hid uuid; r jsonb; n int:=jsonb_array_length(p_input->'guests');
begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select id into hid from households where wedding_id=p_wedding_id and creation_key=p_operation_id;
 if found then return hid; end if;
 if n<1 or length(trim(coalesce(p_input->>'displayName','')))=0 then raise exception 'A household needs a name and at least one guest.'; end if;
 insert into households(wedding_id,display_name,primary_contact_name,email,phone,mailing_address,preferred_locale,internal_notes,invite_code,access_token,max_party_size,plus_one_slots,creation_key)
 values(p_wedding_id,p_input->>'displayName',coalesce(p_input->>'primaryContactName',p_input->>'displayName'),nullif(p_input->>'email',''),nullif(p_input->>'phone',''),p_input->'mailingAddress',coalesce(p_input->>'preferredLocale','en'),p_input->>'internalNotes',upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),greatest(n+coalesce((p_input->>'plusOneSlots')::int,0),coalesce((p_input->>'maxPartySize')::int,n)),coalesce((p_input->>'plusOneSlots')::int,0),p_operation_id) returning id into hid;
 for r in select value from jsonb_array_elements(p_input->'guests') loop
  if length(trim(coalesce(r->>'firstName','')))=0 then raise exception 'Every guest needs a first name.'; end if;
  insert into guests(wedding_id,household_id,first_name,last_name) values(p_wedding_id,hid,trim(r->>'firstName'),coalesce(nullif(trim(r->>'lastName'),''),'—'));
 end loop;
 insert into household_event_invites(wedding_id,household_id,event_id) select p_wedding_id,hid,id from events where wedding_id=p_wedding_id and visibility='all';
 if p_input->>'rsvpStatus'='declined' then update guest_event_responses set attending='no',responded_at=now(),responded_via='admin' where guest_id in(select id from guests where household_id=hid); end if;
 insert into activity_log(wedding_id,household_id,actor_type,actor_id,action,payload) values(p_wedding_id,hid,'admin',p_actor_id,'household.created',p_input);
 return hid;
end $$;
revoke all on function create_household_atomic(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function create_household_atomic(uuid,jsonb,uuid,uuid) to service_role;

create function create_guest_atomic(p_wedding_id uuid,p_input jsonb,p_actor_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare h households%rowtype; g guests%rowtype;
begin
 select * into h from households where id=(p_input->>'householdId')::uuid and wedding_id=p_wedding_id and archived_at is null for update;
 if not found then raise exception 'Household not found.'; end if;
 select * into g from guests where wedding_id=p_wedding_id and creation_key=p_operation_id;
 if found then return to_jsonb(g); end if;
 if length(trim(coalesce(p_input->>'firstName','')))=0 then raise exception 'First name is required.'; end if;
 insert into guests(wedding_id,household_id,first_name,last_name,age_type,relationship,origin,creation_key) values(p_wedding_id,h.id,trim(p_input->>'firstName'),coalesce(nullif(trim(p_input->>'lastName'),''),'—'),coalesce(p_input->>'ageType','adult'),p_input->>'relationship',coalesce(p_input->>'origin','named'),p_operation_id) returning * into g;
 update households set max_party_size=greatest(max_party_size,(select count(*) from guests where household_id=h.id and origin='named')+plus_one_slots) where id=h.id;
 insert into activity_log(wedding_id,household_id,guest_id,actor_type,actor_id,action,payload) values(p_wedding_id,h.id,g.id,'admin',p_actor_id,'guest.added',jsonb_build_object('name',g.first_name||' '||g.last_name));
 return to_jsonb(g);
end $$;
revoke all on function create_guest_atomic(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function create_guest_atomic(uuid,jsonb,uuid,uuid) to service_role;

-- Preserve individual RSVPs, seats and guest answers when correcting an envelope boundary.
-- The reviewed target receives the source invitations, so no saved answer silently vanishes.
create function transfer_household_guests(p_wedding_id uuid,p_source uuid,p_target uuid,p_guest_ids uuid[],p_new_name text,p_actor_id uuid,p_operation_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare source households%rowtype; target_id uuid:=p_target; g record;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_wedding_id::text,0));
 select * into source from households where id=p_source and wedding_id=p_wedding_id for update;
 if not found then raise exception 'Source household not found.'; end if;
 if target_id is null then
  select id into target_id from households where wedding_id=p_wedding_id and creation_key=p_operation_id;
  if target_id is null then
   if length(trim(coalesce(p_new_name,'')))=0 then raise exception 'Name the new household.'; end if;
   insert into households(wedding_id,display_name,primary_contact_name,email,phone,mailing_address,preferred_locale,max_party_size,plus_one_slots,invite_code,access_token,creation_key) values(p_wedding_id,trim(p_new_name),trim(p_new_name),source.email,source.phone,source.mailing_address,source.preferred_locale,greatest(1,cardinality(p_guest_ids)),0,upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),p_operation_id) returning id into target_id;
  end if;
 end if;
 if target_id=p_source or not exists(select 1 from households where id=target_id and wedding_id=p_wedding_id and archived_at is null) then raise exception 'Choose another active household.'; end if;
 if cardinality(p_guest_ids)=0 or exists(select 1 from unnest(p_guest_ids) x where not exists(select 1 from guests where id=x and wedding_id=p_wedding_id and household_id in(p_source,target_id))) then raise exception 'The selected guest list changed. Reload and try again.'; end if;
 insert into household_event_invites(wedding_id,household_id,event_id) select p_wedding_id,target_id,event_id from household_event_invites where household_id=p_source and wedding_id=p_wedding_id on conflict do nothing;
 update guests set household_id=target_id,rsvp_client_id=null,updated_at=now() where id=any(p_guest_ids) and household_id=p_source and wedding_id=p_wedding_id;
 update rsvp_answers set household_id=target_id where guest_id=any(p_guest_ids) and household_id=p_source and wedding_id=p_wedding_id;
 update households set plus_one_slots=greatest(plus_one_slots,(select count(*) from guests where household_id=target_id and origin='plus_one')),max_party_size=greatest(max_party_size,(select count(*) from guests where household_id=target_id)) where id=target_id;
 update households set archived_at=case when not exists(select 1 from guests where household_id=p_source) then now() else archived_at end where id=p_source;
 perform recompute_rsvp_status(p_wedding_id,array[p_source,target_id]);
 insert into activity_log(wedding_id,household_id,actor_type,actor_id,action,payload) values(p_wedding_id,target_id,'admin',p_actor_id,'household.guests_moved',jsonb_build_object('source',p_source,'target',target_id,'guestIds',p_guest_ids,'retainedSourceHouseholdAnswers',true));
 return target_id;
end $$;
revoke all on function transfer_household_guests(uuid,uuid,uuid,uuid[],text,uuid,uuid) from public,anon,authenticated;
grant execute on function transfer_household_guests(uuid,uuid,uuid,uuid[],text,uuid,uuid) to service_role;

create function protect_household_limits() returns trigger language plpgsql set search_path=public as $$
begin
 if new.max_party_size < (select count(*) from guests where household_id=new.id) then raise exception 'The party limit must include every existing guest.'; end if;
 if new.plus_one_slots < (select count(*) from guests where household_id=new.id and origin='plus_one') then raise exception 'Remove or move existing plus-ones before reducing their slots.'; end if;
 return new;
end $$;
create trigger household_limit_guard before update of max_party_size,plus_one_slots on households for each row execute function protect_household_limits();
revoke all on function protect_household_limits() from public,anon,authenticated;

create function apply_event_invite_delta(p_wedding_id uuid,p_event_id uuid,p_add uuid[],p_remove uuid[],p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare adds uuid[]; removes uuid[];
begin
 perform 1 from events where id=p_event_id and wedding_id=p_wedding_id for update;
 if not found then raise exception 'Event not found in this wedding.'; end if;
 select coalesce(array_agg(id),'{}') into adds from households where wedding_id=p_wedding_id and archived_at is null and id=any(p_add) and not id=any(p_remove);
 select coalesce(array_agg(id),'{}') into removes from households where wedding_id=p_wedding_id and id=any(p_remove) and not id=any(p_add);
 insert into household_event_invites(wedding_id,household_id,event_id) select p_wedding_id,id,p_event_id from unnest(adds) id on conflict do nothing;
 delete from household_event_invites where wedding_id=p_wedding_id and event_id=p_event_id and household_id=any(removes);
 insert into activity_log(wedding_id,actor_type,actor_id,action,payload) values(p_wedding_id,'admin',p_actor_id,'event.invites_changed',jsonb_build_object('eventId',p_event_id,'added',adds,'removed',removes));
 return jsonb_build_object('added',cardinality(adds),'removed',cardinality(removes));
end $$;
revoke all on function apply_event_invite_delta(uuid,uuid,uuid[],uuid[],uuid) from public,anon,authenticated;
grant execute on function apply_event_invite_delta(uuid,uuid,uuid[],uuid[],uuid) to service_role;
