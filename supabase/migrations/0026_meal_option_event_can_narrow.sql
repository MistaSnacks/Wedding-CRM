-- Lets the couple say "this dish is for the Reception only" after guests
-- already chose it.
--
-- Before: any change to a dish's event was refused once one guest had picked
-- the dish. Every dish started as "every event", so a second event (a welcome
-- party with no plated meal) asked each guest for a second meal, and the menu
-- screen could not turn that off.
--
-- Now: the event can change when no guest holds the dish for a different
-- event. Widening to every event is always safe. Removing a chosen dish and
-- changing its age group are still refused.
--
-- Same signature as 0021, so CREATE OR REPLACE keeps the service-role-only
-- grants. They are restated below so this file is safe to run on its own.
create or replace function manage_meal_option(p_wedding_id uuid,p_id uuid,p_name text,p_event_id uuid,p_kids boolean,p_remove boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare m meal_options%rowtype; result_id uuid;
begin
  perform 1 from weddings where id=p_wedding_id for update;
  if not exists(select 1 from weddings where id=p_wedding_id) then raise exception 'Wedding not found'; end if;
  if p_event_id is not null and not exists(select 1 from events where id=p_event_id and wedding_id=p_wedding_id) then raise exception 'Event not found'; end if;
  if length(trim(p_name)) not between 1 and 120 then raise exception 'Enter a meal name up to 120 characters'; end if;
  if p_id is not null then
    select * into m from meal_options where id=p_id and wedding_id=p_wedding_id for update;
    if not found then raise exception 'Meal option not found'; end if;
    if p_remove and not m.is_active then raise exception 'This option is hidden from guests and is kept so it can be offered again. It cannot be removed here.'; end if;
    if (p_remove or p_kids is distinct from m.is_kids_meal) and exists(select 1 from guest_event_responses where meal_option_id=p_id) then raise exception 'A guest already chose this dish. Add a new dish instead of removing it or changing who it is for.'; end if;
    if p_event_id is not null and p_event_id is distinct from m.event_id and exists(select 1 from guest_event_responses where meal_option_id=p_id and event_id<>p_event_id) then raise exception 'A guest already chose this dish for another event. Change that guest''s meal first.'; end if;
    if p_remove then delete from meal_options where id=p_id; return p_id; end if;
    update meal_options
       set name=trim(p_name),event_id=p_event_id,is_kids_meal=p_kids,
           name_i18n=case when trim(p_name) is distinct from m.name then '{}'::jsonb else m.name_i18n end
     where id=p_id;
    return p_id;
  end if;
  insert into meal_options(wedding_id,event_id,name,is_kids_meal) values(p_wedding_id,p_event_id,trim(p_name),p_kids) returning id into result_id;
  return result_id;
end $$;
revoke all on function manage_meal_option(uuid,uuid,text,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function manage_meal_option(uuid,uuid,text,uuid,boolean,boolean) to service_role;
