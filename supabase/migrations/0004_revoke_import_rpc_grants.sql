-- import_households is `security definer` and takes p_wedding_id as a caller
-- parameter, so it bypasses RLS by design. Supabase grants EXECUTE on new
-- public-schema functions to anon and authenticated by default, and the anon key
-- ships to the browser — leaving this open lets any visitor write into any tenant.
-- The app always calls it through the service-role client (lib/data/scope.ts),
-- which retains its grant, so revoking has no application impact.
revoke execute on function import_households(uuid, uuid, jsonb) from public, anon, authenticated;
