-- The wedding moved from 2027-06-12 to 2027-09-18.
-- Events on the old day keep their venue-local start time on the new day.
update public.events e
   set starts_at = ((e.starts_at at time zone w.timezone) + interval '98 days') at time zone w.timezone,
       ends_at   = case when e.ends_at is null then null
                        else ((e.ends_at at time zone w.timezone) + interval '98 days') at time zone w.timezone end
  from public.weddings w
 where e.wedding_id = w.id
   and w.id = '11111111-1111-1111-1111-111111111111'
   and (e.starts_at at time zone w.timezone)::date = date '2027-06-12';

update public.weddings
   set wedding_date = date '2027-09-18'
 where id = '11111111-1111-1111-1111-111111111111'
   and slug = 'juliet-juan';
