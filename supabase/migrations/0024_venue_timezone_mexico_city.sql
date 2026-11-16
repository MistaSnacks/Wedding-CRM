-- The venue is in Guadalajara, but the wedding row said America/Los_Angeles.
-- Every time typed in the admin (4:30 PM Reception, 5:00 PM Welcome Party,
-- reply-by 11:59 PM) was meant as venue time. This keeps each wall-clock time
-- and re-reads it in America/Mexico_City, then switches the wedding's zone.
--
-- Applied to production on 2026-11-16 through the data API (same result).
-- Safe to run again: both statements only act while the zone is still
-- America/Los_Angeles, and the events update runs before the zone changes.
update public.events e
   set starts_at = (e.starts_at at time zone 'America/Los_Angeles') at time zone 'America/Mexico_City',
       ends_at   = case when e.ends_at is null then null
                        else (e.ends_at at time zone 'America/Los_Angeles') at time zone 'America/Mexico_City' end
  from public.weddings w
 where e.wedding_id = w.id
   and w.id = '11111111-1111-1111-1111-111111111111'
   and w.timezone = 'America/Los_Angeles';

update public.weddings
   set rsvp_deadline = (rsvp_deadline at time zone 'America/Los_Angeles') at time zone 'America/Mexico_City',
       timezone = 'America/Mexico_City'
 where id = '11111111-1111-1111-1111-111111111111'
   and timezone = 'America/Los_Angeles';
