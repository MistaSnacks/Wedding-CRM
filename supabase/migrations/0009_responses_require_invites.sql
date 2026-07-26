-- 0009: responses require invites — the guest-side half of 0008.
--
-- 0008 fixed the import path so a household never gets a response row for an
-- event it was not invited to. But the same invariant was never enforced where
-- guests themselves write: submit_rsvp inserted whatever event ids arrived in
-- the payload. The RSVP *page* only offers invited events, so the UI never
-- sends a bad id — but the RPC is reachable with nothing more than a
-- household's own access token, and a crafted payload could register "yes"
-- plus a meal for a curated event (say, the rehearsal dinner) the household
-- was never invited to. That row then flows into the meals page, the caterer
-- export and every attendance count.
--
-- Four changes, all server-side:
--
-- 1. submit_rsvp only writes responses for events the household holds an
--    invite for. Uninvited event ids are *skipped*, not an error: if the
--    couple un-invites a household mid-session, the guest's submit still
--    saves everything they were asked — the stale answer is dropped, which is
--    also what the page will show them on reload.
--
-- 2. submit_rsvp's status derivation counts only invite-backed rows.
--    Un-inviting keeps response rows on purpose (re-inviting restores the
--    reply), so orphaned `pending` placeholders can exist — and the old
--    derivation counted them, leaving a household stuck on 'started' forever
--    after they had answered everything they could still see. Stuck 'started'
--    means reminder emails forever: comms.needsReminder and the
--    "not_responded" campaign audience both key off it.
--
-- 3. recompute_rsvp_status(wedding, households[]): the same derivation,
--    callable by the app right after an un-invite, so a stuck status is
--    corrected the moment the orphan is created rather than at the household's
--    next submit (which may never come — they think they're done).
--    One deliberate divergence: submit_rsvp only grants 'completed' when the
--    client says the flow finished (its `complete` flag). This function has no
--    such flag, so like the import it treats "no live response left pending"
--    as completed — for a household that answered everything, that is true.
--
-- 4. reorder_events(wedding, ids[]): one atomic UPDATE. The app previously
--    issued one UPDATE per event; a failure partway left a half-applied order
--    that the client's rollback then misreported. A single statement either
--    applies the whole order or none of it. Ids outside the wedding match
--    nothing.
--
-- Also restated here: import_households, byte-for-byte from 0008 except the
-- meal-option lookup gains `and mo.wedding_id = p_wedding_id`. Not currently
-- exploitable (meal ids are resolved server-side against a wedding-scoped
-- list), but a security definer function should not depend on its callers for
-- tenant hygiene.
--
-- `create or replace`, never drop + create, for both existing functions: a
-- drop discards the ACL and Supabase hands EXECUTE straight back to PUBLIC
-- (and so to anon), reopening the holes 0004/0005 closed. The two *new*
-- functions get explicit revokes below — Supabase's default grant is EXECUTE
-- to public, anon and authenticated, none of whom may call these.

create or replace function submit_rsvp(p_household_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wedding_id uuid;
  v_max int;
  v_slots int;
  v_existing_plus_ones int;
  v_new_count int;
  v_via text := coalesce(p_payload->>'via', 'guest');
  v_complete boolean := coalesce((p_payload->>'complete')::boolean, false);
  v_status text;
  v_guest record;
  v_new_guest_id uuid;
  r jsonb;
  resp jsonb;
  total_responses int;
  no_responses int;
  pending_responses int;
begin
  select wedding_id, max_party_size, plus_one_slots
    into v_wedding_id, v_max, v_slots
    from households where id = p_household_id;
  if v_wedding_id is null then
    raise exception 'household not found';
  end if;

  -- backstop caps
  select count(*) into v_existing_plus_ones
    from guests where household_id = p_household_id and origin = 'plus_one';
  v_new_count := coalesce(jsonb_array_length(p_payload->'new_plus_ones'), 0);
  if v_existing_plus_ones + v_new_count > v_slots then
    raise exception 'plus one limit exceeded';
  end if;
  if (select count(*) from guests where household_id = p_household_id) + v_new_count > v_max then
    raise exception 'party size exceeded';
  end if;

  -- insert new plus ones (each with their own responses)
  for r in select * from jsonb_array_elements(coalesce(p_payload->'new_plus_ones', '[]'::jsonb))
  loop
    insert into guests (wedding_id, household_id, first_name, last_name, origin)
    values (v_wedding_id, p_household_id,
            trim(r->>'first_name'), trim(r->>'last_name'), 'plus_one')
    returning id into v_new_guest_id;

    insert into activity_log (wedding_id, household_id, guest_id, actor_type, action, payload)
    values (v_wedding_id, p_household_id, v_new_guest_id, v_via, 'plus_one.added',
            jsonb_build_object('name', trim(r->>'first_name') || ' ' || trim(r->>'last_name')));

    for resp in select * from jsonb_array_elements(coalesce(r->'responses', '[]'::jsonb))
    loop
      -- Only events this household is invited to. A crafted payload naming
      -- any other event is dropped, not written.
      if exists (select 1 from household_event_invites hei
                  where hei.household_id = p_household_id
                    and hei.event_id = (resp->>'event_id')::uuid) then
        insert into guest_event_responses (guest_id, event_id, wedding_id, attending, meal_option_id, responded_at, responded_via)
        values (v_new_guest_id, (resp->>'event_id')::uuid, v_wedding_id,
                coalesce(resp->>'attending','pending'),
                nullif(resp->>'meal_option_id','')::uuid, now(), v_via)
        on conflict (guest_id, event_id) do update
          set attending = excluded.attending,
              meal_option_id = excluded.meal_option_id,
              responded_at = now(), responded_via = excluded.responded_via;
      end if;
    end loop;
  end loop;

  -- upsert responses for existing guests (must belong to household)
  for resp in select * from jsonb_array_elements(coalesce(p_payload->'responses', '[]'::jsonb))
  loop
    if not exists (select 1 from guests g where g.id = (resp->>'guest_id')::uuid
                   and g.household_id = p_household_id) then
      raise exception 'guest does not belong to household';
    end if;
    -- Same invite gate as above.
    if exists (select 1 from household_event_invites hei
                where hei.household_id = p_household_id
                  and hei.event_id = (resp->>'event_id')::uuid) then
      insert into guest_event_responses (guest_id, event_id, wedding_id, attending, meal_option_id, responded_at, responded_via)
      values ((resp->>'guest_id')::uuid, (resp->>'event_id')::uuid, v_wedding_id,
              coalesce(resp->>'attending','pending'),
              nullif(resp->>'meal_option_id','')::uuid, now(), v_via)
      on conflict (guest_id, event_id) do update
        set attending = excluded.attending,
            meal_option_id = excluded.meal_option_id,
            responded_at = now(), responded_via = excluded.responded_via;
    end if;
  end loop;

  -- per-guest fields (dietary etc.)
  for r in select * from jsonb_array_elements(coalesce(p_payload->'guest_fields', '[]'::jsonb))
  loop
    update guests set
      dietary_restrictions = coalesce(r->>'dietary_restrictions', dietary_restrictions),
      allergies = coalesce(r->>'allergies', allergies),
      updated_at = now()
    where id = (r->>'guest_id')::uuid and household_id = p_household_id;
  end loop;

  -- answers
  for r in select * from jsonb_array_elements(coalesce(p_payload->'answers', '[]'::jsonb))
  loop
    insert into rsvp_answers (wedding_id, question_id, household_id, guest_id, value)
    values (v_wedding_id, (r->>'question_id')::uuid, p_household_id,
            nullif(r->>'guest_id','')::uuid, r->'value')
    on conflict (question_id, household_id, coalesce(guest_id, '00000000-0000-0000-0000-000000000000'))
    do update set value = excluded.value, updated_at = now();
  end loop;

  -- recompute household status — counting only invite-backed rows, so an
  -- orphaned placeholder from an un-invite can no longer hold the household
  -- on 'started' after they have answered everything they can still see.
  select count(*),
         count(*) filter (where ger.attending = 'no'),
         count(*) filter (where ger.attending = 'pending')
    into total_responses, no_responses, pending_responses
    from guest_event_responses ger
    join guests g on g.id = ger.guest_id
    join household_event_invites hei
      on hei.household_id = g.household_id and hei.event_id = ger.event_id
   where g.household_id = p_household_id;

  if total_responses > 0 and no_responses = total_responses then
    v_status := 'declined';
  elsif v_complete and pending_responses = 0 then
    v_status := 'completed';
  elsif total_responses - pending_responses > 0 then
    v_status := 'started';
  else
    v_status := 'pending';
  end if;

  update households set rsvp_status = v_status, updated_at = now()
   where id = p_household_id;

  insert into activity_log (wedding_id, household_id, actor_type, action, payload)
  values (v_wedding_id, p_household_id, v_via,
          case when v_status = 'completed' then 'rsvp.completed'
               when v_status = 'declined' then 'rsvp.declined'
               else 'rsvp.started' end,
          jsonb_build_object('status', v_status));

  return jsonb_build_object('status', v_status);
end;
$$;

-- The same derivation as submit_rsvp's, callable by the app right after an
-- invite change. See divergence note in the header: with no client `complete`
-- flag, "nothing live left pending" counts as completed, as the import does.
-- Only rows whose status actually changes are written, so calling this for
-- untouched households churns nothing.
create function recompute_rsvp_status(p_wedding_id uuid, p_household_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  with live as (
    select g.household_id,
           count(*) as total,
           count(*) filter (where ger.attending = 'no') as no_count,
           count(*) filter (where ger.attending = 'pending') as pending_count
      from guest_event_responses ger
      join guests g on g.id = ger.guest_id
      join household_event_invites hei
        on hei.household_id = g.household_id and hei.event_id = ger.event_id
     where g.household_id = any(p_household_ids)
       and g.wedding_id = p_wedding_id
     group by g.household_id
  ),
  derived as (
    select ids.id as household_id,
           case
             when l.total > 0 and l.no_count = l.total then 'declined'
             when l.total > 0 and l.pending_count = 0 then 'completed'
             when coalesce(l.total, 0) - coalesce(l.pending_count, 0) > 0 then 'started'
             else 'pending'
           end as status
      from unnest(p_household_ids) as ids(id)
      left join live l on l.household_id = ids.id
  )
  update households h
     set rsvp_status = d.status, updated_at = now()
    from derived d
   where h.id = d.household_id
     and h.wedding_id = p_wedding_id
     and h.rsvp_status <> d.status;
$$;

-- One statement, so the order applies entirely or not at all. Ids from another
-- wedding (or ids that no longer exist) match nothing and are skipped.
create function reorder_events(p_wedding_id uuid, p_ordered_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update events e
     set sort_order = t.ord - 1
    from unnest(p_ordered_ids) with ordinality as t(id, ord)
   where e.id = t.id
     and e.wedding_id = p_wedding_id;
$$;

-- New functions, so Supabase has just granted EXECUTE to everyone. Neither is
-- for guests: both are admin plumbing called with the service key.
revoke execute on function recompute_rsvp_status(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function reorder_events(uuid, uuid[]) from public, anon, authenticated;

-- import_households, 0008 verbatim except the meal-option lookup is now
-- wedding-scoped. See 0008 for the full reasoning; only that one line changed.
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
          );
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
