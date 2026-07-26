-- 0008: import_households stops auto-inviting new households to curated events.
--
-- The bug. 0006 (and 0003 before it) invites every newly-imported household to
-- *every* event in the wedding, minus whatever the CSV explicitly marked as
-- not-invited. So the moment the couple curates "rehearsal dinner = family
-- only" and then imports the next batch of guests — and the list always arrives
-- in batches — everyone in that batch is silently added to the rehearsal
-- dinner. The curation undoes itself and nothing says so.
--
-- The fix. 0007 added `events.visibility`, which has been inert until now. It
-- is exactly the right discriminator:
--
--   visibility = 'all'          → an everyone event (Ceremony, Reception).
--                                 New households are auto-invited, as before.
--   visibility = 'invited_only' → a curated event. New households are NOT
--                                 auto-invited; the couple picks that list.
--
-- Two things still override the column, both because they are *explicit* data
-- from the sheet rather than a default:
--
--   1. `notInvitedEventIds` still wins. A CSV that says "not invited to the
--      ceremony" means it, whatever the ceremony's visibility is. (Unchanged.)
--   2. A real answer in the sheet still counts as an invite. If a mapped
--      column recorded yes/no for a curated event — the live master sheet
--      carries a "Rehearsal Dinner RSVP" column — that household plainly is
--      invited to it, and dropping the answer on the floor would be the same
--      class of silent data loss this migration exists to stop. A blank cell
--      does not count: lib/csv/fields.ts normalises blanks to 'pending', so
--      merely *mapping* the column must not re-invite the whole sheet.
--
-- Everything else in the function is 0006 verbatim: the replay guard, the
-- per-household error attribution subtransaction, event-scoped meal options,
-- and the derived households.rsvp_status. Only the set of events a household
-- is attached to has changed, and both loops (invites and per-guest responses)
-- use that same set, so a household never gets a response row for an event it
-- was not invited to.
--
-- `create or replace`, never drop + create: a drop discards the ACL and
-- Postgres/Supabase hands EXECUTE straight back to PUBLIC (and so to anon),
-- reopening the hole 0004/0005 exist to close. Replacing in place preserves
-- the revoke, so no grant is restated here — the anon probe is what confirms
-- it still holds.
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
