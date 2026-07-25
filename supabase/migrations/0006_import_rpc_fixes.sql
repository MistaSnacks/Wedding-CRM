-- Whole-branch review fixes for import_households (0003_import_rpc.sql).
--
-- 0003 is already recorded as applied on the live project, so editing it would
-- silently do nothing — every change has to land here instead.
--
-- `create or replace`, never drop + create: a drop would discard the ACL and
-- Postgres/Supabase would hand EXECUTE straight back to PUBLIC (and therefore
-- anon), reopening exactly the hole 0004/0005 exist to close. Replacing in
-- place preserves the revoke, so no revoke is repeated here — the anon probe
-- documented in the fix report is what confirms it still holds.
--
-- Four behavioural changes, all invisible in the function's signature:
--
--   1. Replay guard. The run's status is now a *precondition*, claimed before
--      any insert: committing a run twice used to write the whole guest list
--      twice (invite codes are regenerated per call, so no unique constraint
--      stopped it) and recovery was manual.
--   2. Per-household error attribution. A bare `violates check constraint`
--      tells an operator nothing about which of 140 envelopes was at fault,
--      and the transactional rollback means they cannot bisect by re-running.
--      Re-raising from a subtransaction still aborts the outer transaction, so
--      atomicity is unchanged.
--   3. Event-scoped meals. meal_options are event-scoped; writing one guest's
--      single meal onto every invited event's response multiplied every meal
--      count by the number of events that guest attends (lib/data/metrics.ts
--      and the meals export both count meal_option_id with no event filter).
--   4. households.rsvp_status is derived from what was imported. It used to
--      stay at its 'pending' default, so a fully-answered sheet reported 0%
--      complete — and, worse, lib/data/comms.ts selects reminder recipients
--      with `rsvp_status in ('pending','started')`, so households that had
--      already declined in the sheet would be emailed RSVP reminders.
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

      for ev in
        select id from events
        where wedding_id = p_wedding_id
          and not (not_invited ? id::text)
      loop
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

        for ev in
          select id from events
          where wedding_id = p_wedding_id
            and not (not_invited ? id::text)
        loop
          insert into guest_event_responses (guest_id, event_id, wedding_id, attending, meal_option_id)
          values (
            new_guest_id,
            ev.id,
            p_wedding_id,
            coalesce(g->'attendingByEventId'->>ev.id::text, 'pending'),
            -- Only attach the meal to the event that owns it. A wedding-wide
            -- option (event_id is null) still applies everywhere.
            (select mo.id from meal_options mo
              where mo.id = nullif(g->>'mealOptionId', '')::uuid
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
