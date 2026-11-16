-- CSV import failed for every household that is invited to an event.
--
-- Migration 0015 added maintain_rsvp_requirements(): inserting a guest now
-- creates a 'pending' guest_event_responses row for each of the household's
-- invites. Two older statements still inserted those same rows with a plain
-- INSERT and hit guest_event_responses_pkey:
--   1. import_households (0009): new households from a file;
--   2. commit_reviewed_import (0019): a new guest appended to an existing
--      household.
-- Both function bodies below are copied unchanged from those migrations,
-- except for the ON CONFLICT clause on that one statement. Grants are kept by
-- CREATE OR REPLACE.

create or replace function import_households(
  p_wedding_id uuid,
  p_run_id uuid,
  p_households jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hh jsonb;
  g jsonb;
  new_household_id uuid;
  new_guest_id uuid;
  ev record;
  household_count int := 0;
  guest_count int := 0;
  hh_index int := 0;
  not_invited jsonb;
  has_event_data boolean;
  total_responses int;
  no_responses int;
  pending_responses int;
  v_status text;
  answered_event_ids text[];
  invited_event_ids uuid[];
begin
  -- Claim the run before writing anything, so a replay aborts having written
  -- nothing rather than duplicating the import. Terminal stats are still set
  -- at the end; only the status transition moved up here.
  update imports set status = 'committed'
   where id = p_run_id and wedding_id = p_wedding_id and status = 'validated';
  if not found then
    raise exception 'import run % is not in a committable state', p_run_id;
  end if;

  for hh in select * from jsonb_array_elements(p_households) loop
    hh_index := hh_index + 1;

    -- Subtransaction purely for error context. `raise exception` inside the
    -- handler propagates outward, so the whole import still rolls back.
    begin
      insert into households (
        wedding_id, display_name, primary_contact_name, email, phone,
        mailing_address, max_party_size, plus_one_slots, preferred_locale,
        tags, internal_notes, invite_code, access_token
      ) values (
        p_wedding_id,
        hh->>'displayName',
        hh->>'primaryContactName',
        hh->>'email',
        hh->>'phone',
        hh->'mailingAddress',
        (hh->>'maxPartySize')::int,
        (hh->>'plusOneSlots')::int,
        coalesce(hh->>'preferredLocale', 'en'),
        coalesce(
          (select array_agg(value::text) from jsonb_array_elements_text(hh->'tags')),
          '{}'
        ),
        hh->>'internalNotes',
        hh->>'inviteCode',
        hh->>'accessToken'
      ) returning id into new_household_id;

      household_count := household_count + 1;
      not_invited := coalesce(hh->'notInvitedEventIds', '[]'::jsonb);

      -- Did this import carry per-event RSVP data at all? A bare name-only
      -- CSV must leave rsvp_status alone; only a sheet that actually mapped
      -- events gets a derived status. The validator emits both keys together
      -- (undefined properties are dropped by JSON.stringify), so either one
      -- present means the mapping included events.
      has_event_data := (hh ? 'notInvitedEventIds')
        or exists (
          select 1 from jsonb_array_elements(coalesce(hh->'guests', '[]'::jsonb)) as gg(item)
          where gg.item ? 'attendingByEventId'
        );

      -- Events this household's sheet actually answered yes/no for. 'pending'
      -- is what a blank cell becomes, so it is not an answer.
      select coalesce(array_agg(distinct kv.key), '{}')
        into answered_event_ids
        from jsonb_array_elements(coalesce(hh->'guests', '[]'::jsonb)) as gg(item)
        cross join lateral jsonb_each_text(
          coalesce(gg.item->'attendingByEventId', '{}'::jsonb)
        ) as kv(key, value)
       where kv.value in ('yes', 'no');

      -- The one behavioural change: 'invited_only' events are curated by hand
      -- and are not auto-invited. Both loops below use this list.
      select coalesce(array_agg(e.id), '{}')
        into invited_event_ids
        from events e
       where e.wedding_id = p_wedding_id
         and not (not_invited ? e.id::text)
         and (e.visibility = 'all' or e.id::text = any(answered_event_ids));

      for ev in select unnest(invited_event_ids) as id loop
        insert into household_event_invites (household_id, event_id, wedding_id)
        values (new_household_id, ev.id, p_wedding_id);
      end loop;

      for g in select * from jsonb_array_elements(hh->'guests') loop
        insert into guests (
          wedding_id, household_id, first_name, last_name,
          age_type, relationship, origin, dietary_restrictions
        ) values (
          p_wedding_id,
          new_household_id,
          g->>'firstName',
          g->>'lastName',
          coalesce(g->>'ageType', 'adult'),
          g->>'relationship',
          coalesce(g->>'origin', 'named'),
          g->>'dietaryRestrictions'
        ) returning id into new_guest_id;

        guest_count := guest_count + 1;

        for ev in select unnest(invited_event_ids) as id loop
          insert into guest_event_responses (guest_id, event_id, wedding_id, attending, meal_option_id)
          values (
            new_guest_id,
            ev.id,
            p_wedding_id,
            coalesce(g->'attendingByEventId'->>ev.id::text, 'pending'),
            -- Only attach the meal to the event that owns it. A wedding-wide
            -- option (event_id is null) still applies everywhere. Scoped to
            -- this wedding: a security definer function must not resolve
            -- another tenant's option id, however the caller behaves.
            (select mo.id from meal_options mo
              where mo.id = nullif(g->>'mealOptionId', '')::uuid
                and mo.wedding_id = p_wedding_id
                and (mo.event_id is null or mo.event_id = ev.id))
          )
          -- 0015 added a trigger that creates a 'pending' row for every invite
          -- the moment the guest row is inserted, so this row already exists.
          -- Without this clause every import of a household invited to an
          -- event failed on guest_event_responses_pkey.
          on conflict (guest_id, event_id) do update
            set attending = excluded.attending,
                meal_option_id = excluded.meal_option_id;
        end loop;
      end loop;

      if has_event_data then
        -- Same derivation submit_rsvp uses (0001_init.sql). The imported sheet
        -- is the submission, so its `complete` analogue is "no response was
        -- left unanswered" rather than a client-sent flag.
        select count(*),
               count(*) filter (where attending = 'no'),
               count(*) filter (where attending = 'pending')
          into total_responses, no_responses, pending_responses
          from guest_event_responses ger
          join guests gu on gu.id = ger.guest_id
         where gu.household_id = new_household_id;

        if total_responses > 0 and no_responses = total_responses then
          v_status := 'declined';
        elsif total_responses > 0 and pending_responses = 0 then
          v_status := 'completed';
        elsif total_responses - pending_responses > 0 then
          v_status := 'started';
        else
          v_status := 'pending';
        end if;

        update households set rsvp_status = v_status, updated_at = now()
         where id = new_household_id;
      end if;
    exception when others then
      raise exception 'household "%" (row %): %', hh->>'displayName', hh_index, sqlerrm;
    end;
  end loop;

  update imports
     set stats = jsonb_build_object('households', household_count, 'guests', guest_count)
   where id = p_run_id and wedding_id = p_wedding_id;

  return jsonb_build_object('households', household_count, 'guests', guest_count);
end;
$$;

create or replace function commit_reviewed_import(p_wedding uuid,p_run uuid,p_actor uuid,p_fingerprint text,p_decisions jsonb default '[]') returns jsonb
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
 select p_wedding,gid,event_id,'pending' from household_event_invites where wedding_id=p_wedding and household_id=h.id
 -- The guest trigger from 0015 has already inserted these rows.
 on conflict (guest_id,event_id) do nothing;
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
