-- 0007: event visibility + the Rehearsal Dinner event.
--
-- Visibility and rsvp_enabled are separate axes: an event can appear on the
-- schedule without collecting responses, and vice versa. Only rsvp_enabled
-- existed. Default 'all' preserves the current behaviour of Ceremony and
-- Reception, which are shown to everyone.
--
-- No functions are created or replaced here, so no grants change. Nothing
-- touches the security definer functions whose anon EXECUTE was revoked in
-- 0004/0005.

alter table events
  add column if not exists visibility text not null default 'all'
  check (visibility in ('all', 'invited_only'));

-- The master sheet already carries a "Rehearsal Dinner RSVP" column with
-- nowhere to land. Guarded so re-running is a no-op.
insert into events (wedding_id, name, visibility, rsvp_enabled, sort_order)
select '11111111-1111-1111-1111-111111111111', 'Rehearsal Dinner', 'invited_only', true, 2
where not exists (
  select 1 from events
  where wedding_id = '11111111-1111-1111-1111-111111111111' and name = 'Rehearsal Dinner'
);
