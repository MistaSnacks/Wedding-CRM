-- Shared abuse protection. Only service-role actions can consume a bucket.
create table if not exists rate_limit_buckets (
  key text primary key, request_count integer not null, expires_at timestamptz not null
);
alter table rate_limit_buckets enable row level security;
create index if not exists rate_limit_buckets_expiry on rate_limit_buckets(expires_at);
create or replace function consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count integer; v_expires timestamptz;
begin
  if length(p_key) <> 64 or p_limit < 1 or p_window_seconds not between 1 and 86400 then raise exception 'Invalid rate limit'; end if;
  insert into rate_limit_buckets(key, request_count, expires_at)
  values (p_key, 1, clock_timestamp() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    request_count = case when rate_limit_buckets.expires_at <= clock_timestamp() then 1 else rate_limit_buckets.request_count + 1 end,
    expires_at = case when rate_limit_buckets.expires_at <= clock_timestamp() then clock_timestamp() + make_interval(secs => p_window_seconds) else rate_limit_buckets.expires_at end
  returning request_count, expires_at into v_count, v_expires;
  if random() < 0.01 then delete from rate_limit_buckets where expires_at < clock_timestamp() - interval '1 day'; end if;
  if v_count <= p_limit then return jsonb_build_object('ok', true); end if;
  return jsonb_build_object('ok', false, 'retryAfterSec', greatest(1, ceil(extract(epoch from (v_expires-clock_timestamp())))));
end $$;
revoke all on function consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function consume_rate_limit(text, integer, integer) to service_role;

create index if not exists household_event_invites_wedding_event on household_event_invites(wedding_id,event_id);
create index if not exists seat_assignments_wedding_event on seat_assignments(wedding_id,event_id);

-- Serialize seating changes within a wedding so concurrent planners cannot
-- claim the same last chair. These checks also protect direct editor writes.
create or replace function validate_seat_assignment() returns trigger
language plpgsql security definer set search_path=public as $$
declare t seating_tables%rowtype; v_count integer;
begin
  perform 1 from weddings where id=new.wedding_id for update;
  select * into t from seating_tables where id=new.table_id and wedding_id=new.wedding_id;
  if not found or t.event_id<>new.event_id then raise exception 'Table does not belong to this event'; end if;
  if not exists (
    select 1 from guests g join households h on h.id=g.household_id and h.archived_at is null join household_event_invites i on i.household_id=g.household_id and i.wedding_id=g.wedding_id
    join guest_event_responses r on r.guest_id=g.id and r.event_id=i.event_id and r.wedding_id=g.wedding_id
    where g.id=new.guest_id and g.wedding_id=new.wedding_id and i.event_id=new.event_id and r.attending='yes'
  ) then raise exception 'Only invited, attending guests can be assigned. Refresh the chart.'; end if;
  select count(*) into v_count from seat_assignments where table_id=new.table_id and wedding_id=new.wedding_id and guest_id<>new.guest_id;
  if v_count >= t.capacity then raise exception 'This table is full. Choose another table or increase capacity.'; end if;
  return new;
end $$;
create trigger enforce_seat_assignment before insert or update on seat_assignments for each row execute function validate_seat_assignment();
revoke all on function validate_seat_assignment() from public,anon,authenticated;

create or replace function validate_seating_table() returns trigger
language plpgsql security definer set search_path=public as $$
declare used integer;
begin
  perform 1 from weddings where id=new.wedding_id for update;
  if not exists(select 1 from events where id=new.event_id and wedding_id=new.wedding_id) then raise exception 'Event not found in this wedding'; end if;
  if length(trim(new.name))=0 or length(new.name)>120 or new.capacity not between 1 and 1000 then raise exception 'Enter a table name and capacity between 1 and 1000'; end if;
  if tg_op='UPDATE' then
    select count(*) into used from seat_assignments where table_id=old.id;
    if used>new.capacity then raise exception 'Move guests before reducing capacity below the occupied seats'; end if;
    if used>0 and (new.event_id<>old.event_id or new.wedding_id<>old.wedding_id) then raise exception 'A populated table cannot change events'; end if;
  end if;
  return new;
end $$;
create trigger enforce_seating_table before insert or update on seating_tables for each row execute function validate_seating_table();
revoke all on function validate_seating_table() from public,anon,authenticated;

create or replace function assign_seating_group(p_wedding_id uuid,p_event_id uuid,p_table_id uuid,p_guest_ids uuid[],p_actor_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare t seating_tables%rowtype; gid uuid; previous jsonb; wanted integer; occupied integer;
begin
  perform 1 from weddings where id=p_wedding_id for update;
  select * into t from seating_tables where id=p_table_id and wedding_id=p_wedding_id and event_id=p_event_id;
  if not found then raise exception 'Table not found in this event'; end if;
  select count(distinct x) into wanted from unnest(p_guest_ids) x;
  if wanted=0 or wanted>1000 then raise exception 'Choose guests to assign'; end if;
  select count(*) into occupied from seat_assignments where table_id=p_table_id and not (guest_id=any(p_guest_ids));
  if occupied+wanted>t.capacity then raise exception 'The group does not fit at this table'; end if;
  foreach gid in array p_guest_ids loop
    select to_jsonb(s) into previous from seat_assignments s where guest_id=gid and event_id=p_event_id and wedding_id=p_wedding_id;
    insert into seat_assignments(guest_id,event_id,wedding_id,table_id) values(gid,p_event_id,p_wedding_id,p_table_id)
    on conflict(guest_id,event_id) do update set table_id=excluded.table_id,seat_number=null where seat_assignments.wedding_id=p_wedding_id;
    insert into activity_log(wedding_id,household_id,guest_id,actor_type,actor_id,action,payload)
    select p_wedding_id,g.household_id,g.id,'admin',p_actor_id,'table.assigned',jsonb_build_object('eventId',p_event_id,'tableId',p_table_id,'before',previous)
    from guests g where g.id=gid and g.wedding_id=p_wedding_id;
  end loop;
end $$;
revoke all on function assign_seating_group(uuid,uuid,uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function assign_seating_group(uuid,uuid,uuid,uuid[],uuid) to service_role;

-- A validated file has a server-owned fingerprint. Replaying it as a different
-- run cannot create another set of invitations; the original transaction wins.
alter table imports add column if not exists source_fingerprint text;
create unique index if not exists imports_committed_fingerprint on imports(wedding_id,source_fingerprint) where status='committed' and source_fingerprint is not null;

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
    if (p_remove or p_event_id is distinct from m.event_id or p_kids is distinct from m.is_kids_meal) and exists(select 1 from guest_event_responses where meal_option_id=p_id) then raise exception 'This option has guest choices. Add a new option instead of deleting or changing its event or age group.'; end if;
    if p_remove then delete from meal_options where id=p_id; return p_id; end if;
    update meal_options set name=trim(p_name),event_id=p_event_id,is_kids_meal=p_kids where id=p_id;
    return p_id;
  end if;
  insert into meal_options(wedding_id,event_id,name,is_kids_meal) values(p_wedding_id,p_event_id,trim(p_name),p_kids) returning id into result_id;
  return result_id;
end $$;
revoke all on function manage_meal_option(uuid,uuid,text,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function manage_meal_option(uuid,uuid,text,uuid,boolean,boolean) to service_role;

-- Publishing is a validated live-publication gate, serialized with seating edits.
create function publish_seating(p_wedding_id uuid,p_event_id uuid,p_published boolean,p_actor_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from weddings where id=p_wedding_id for update;
 perform 1 from events where id=p_event_id and wedding_id=p_wedding_id for update;
 if not found then raise exception 'Event not found in this wedding.'; end if;
 if p_published then
  if exists(select 1 from seating_tables t join seat_assignments s on s.table_id=t.id where t.wedding_id=p_wedding_id and t.event_id=p_event_id group by t.id,t.capacity having count(*)>t.capacity) then
   raise exception 'Cannot publish: a table is over capacity. Move guests or adjust the table first.';
  end if;
  if exists(
   select 1 from seat_assignments s where s.wedding_id=p_wedding_id and s.event_id=p_event_id and not exists(
    select 1 from guests g join households h on h.id=g.household_id and h.wedding_id=g.wedding_id and h.archived_at is null
    join household_event_invites i on i.household_id=h.id and i.wedding_id=h.wedding_id and i.event_id=p_event_id
    join guest_event_responses r on r.guest_id=g.id and r.wedding_id=g.wedding_id and r.event_id=p_event_id and r.attending='yes'
    join seating_tables t on t.id=s.table_id and t.wedding_id=s.wedding_id and t.event_id=s.event_id
    where g.id=s.guest_id and g.wedding_id=p_wedding_id
   )
  ) then raise exception 'Cannot publish: some seats belong to declined, uninvited or archived guests. Review and remove those assignments first.'; end if;
 end if;
 update events set seating_published_at=case when p_published then now() else null end where id=p_event_id and wedding_id=p_wedding_id;
 insert into activity_log(wedding_id,actor_type,actor_id,action,payload) values(p_wedding_id,'admin',p_actor_id,case when p_published then 'seating.published' else 'seating.unpublished' end,jsonb_build_object('eventId',p_event_id));
end $$;
revoke all on function publish_seating(uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function publish_seating(uuid,uuid,boolean,uuid) to service_role;

-- Read one guest's published assignment; tablemates must still hold live invitations/replies.
create function guest_table_info(p_wedding_id uuid,p_guest_id uuid,p_event_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 with live as (
  select g.id,g.first_name,g.last_name,s.table_id from guests g
  join households h on h.id=g.household_id and h.wedding_id=g.wedding_id and h.archived_at is null
  join household_event_invites i on i.household_id=h.id and i.wedding_id=h.wedding_id and i.event_id=p_event_id
  join guest_event_responses r on r.guest_id=g.id and r.wedding_id=g.wedding_id and r.event_id=p_event_id and r.attending='yes'
  join seat_assignments s on s.guest_id=g.id and s.event_id=p_event_id and s.wedding_id=g.wedding_id
  join events e on e.id=p_event_id and e.wedding_id=g.wedding_id and e.seating_published_at is not null
  where g.wedding_id=p_wedding_id
 ) select jsonb_build_object('tableName',t.name,'mates',coalesce((select jsonb_agg(jsonb_build_object('first_name',m.first_name,'last_name',m.last_name) order by m.last_name,m.first_name) from live m where m.table_id=t.id and m.id<>p_guest_id),'[]'::jsonb))
 from live own join seating_tables t on t.id=own.table_id and t.wedding_id=p_wedding_id and t.event_id=p_event_id where own.id=p_guest_id;
$$;
revoke all on function guest_table_info(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function guest_table_info(uuid,uuid,uuid) to service_role;
