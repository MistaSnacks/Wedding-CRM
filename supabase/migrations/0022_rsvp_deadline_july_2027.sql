update public.weddings
   set rsvp_deadline = timestamp '2027-07-01 23:59:00' at time zone timezone
 where id = '11111111-1111-1111-1111-111111111111'
   and slug = 'juliet-juan';
