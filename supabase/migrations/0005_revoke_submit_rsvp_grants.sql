-- submit_rsvp is `security definer` and keys on a bare caller-supplied
-- p_household_id with no credential check, so it bypasses RLS and also bypasses
-- the guest RSVP security model (where the access_token in the URL is the
-- credential). Supabase grants EXECUTE on new public-schema functions to anon and
-- authenticated by default, and the anon key ships to the browser — leaving this
-- open lets anyone holding a household UUID overwrite that household's RSVP.
-- The only caller is lib/data/rsvp.ts via the service-role client
-- (lib/data/scope.ts), which retains its grant, so this has no application impact.
revoke execute on function submit_rsvp(uuid, jsonb) from public, anon, authenticated;
