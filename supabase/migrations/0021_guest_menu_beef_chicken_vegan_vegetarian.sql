-- Juliet & Juan's guest menu is Beef, Chicken, Vegan, Vegetarian, in that
-- order, with names in Spanish and Vietnamese. Kids Meal is hidden for now,
-- and Fish is retired.
--
-- Hide, never delete: guest_event_responses.meal_option_id is ON DELETE SET
-- NULL, so deleting an option erases every guest's choice of it. The guest
-- RSVP form only offers active options (lib/data/rsvp.ts). An inactive option
-- stays valid for guests who already chose it, and admin reports still show it.
-- Keep at least one active option for any event that needs a meal: the
-- database still asks for a meal when only inactive options exist.
--
-- To offer Kids Meal again:
--   update meal_options set is_active = true
--    where wedding_id = '11111111-1111-1111-1111-111111111111' and name = 'Kids Meal';
alter table meal_options add column if not exists is_active boolean not null default true;

-- Guest-facing names by language, like rsvp_questions.label. English stays in
-- `name`, which admin screens, reports and CSV import use; guests fall back to
-- it when a language is missing (lib/domain/meal-name.ts).
alter table meal_options add column if not exists name_i18n jsonb not null default '{}'::jsonb
  check (jsonb_typeof(name_i18n) = 'object');

update meal_options m
   set sort_order = v.sort_order,
       is_active = v.is_active,
       name_i18n = v.name_i18n::jsonb
  from (values
    ('Beef',       0, true,  '{"es": "Res", "vi": "Thịt bò"}'),
    ('Chicken',    1, true,  '{"es": "Pollo", "vi": "Thịt gà"}'),
    ('Vegan',      2, true,  '{"es": "Vegano", "vi": "Thuần chay"}'),
    ('Vegetarian', 3, true,  '{"es": "Vegetariano", "vi": "Chay (ăn chay có trứng sữa)"}'),
    ('Kids Meal',  4, false, '{"es": "Menú infantil", "vi": "Suất ăn trẻ em"}'),
    ('Fish',       5, false, '{"es": "Pescado", "vi": "Cá"}')
  ) as v(name, sort_order, is_active, name_i18n)
 where m.wedding_id = '11111111-1111-1111-1111-111111111111'
   and m.name = v.name;

-- Same signature as 0018, so CREATE OR REPLACE keeps the service-role-only
-- grants. Two changes: a hidden option cannot be removed (it is kept so it can
-- be offered again), and a rename clears the translations so guests never see
-- a translation of the old name.
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
    if (p_remove or p_event_id is distinct from m.event_id or p_kids is distinct from m.is_kids_meal) and exists(select 1 from guest_event_responses where meal_option_id=p_id) then raise exception 'This option has guest choices. Add a new option instead of deleting or changing its event or age group.'; end if;
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
