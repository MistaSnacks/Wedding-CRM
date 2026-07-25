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
  not_invited jsonb;
begin
  for hh in select * from jsonb_array_elements(p_households) loop
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
          nullif(g->>'mealOptionId', '')::uuid
        );
      end loop;
    end loop;
  end loop;

  update imports set status = 'committed',
    stats = jsonb_build_object('households', household_count, 'guests', guest_count)
  where id = p_run_id and wedding_id = p_wedding_id;

  return jsonb_build_object('households', household_count, 'guests', guest_count);
end;
$$;

-- security definer bypasses RLS by design (it must, to write across several
-- tables in one transaction), but Postgres/Supabase grants EXECUTE on new
-- public-schema functions to PUBLIC by default — including anon and
-- authenticated. Without this revoke, any browser holding the public anon
-- key could call this function directly with an arbitrary p_wedding_id and
-- write households/guests/invites into any tenant. The app's own callers
-- always use the service_role client (see lib/data/scope.ts forWedding()),
-- which is unaffected by this revoke.
--
-- This same revoke is repeated in 0004_revoke_import_rpc_grants.sql. That is
-- deliberate, not duplication to clean up: this copy closes the gap on a
-- fresh database (0001 -> 0004), which never has the function exposed even
-- momentarily; 0004's copy is what actually patches databases where 0003 is
-- already recorded as applied and will never run again (revoke is
-- idempotent, so running it twice is harmless).
revoke execute on function import_households(uuid, uuid, jsonb) from public, anon, authenticated;
