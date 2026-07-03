-- Guest CRM & RSVP platform — initial schema
-- Every domain table is tenant-scoped by wedding_id. RLS is a backstop;
-- the app's server-side data layer (service role) is the primary enforcement.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- weddings
create table weddings (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  couple_names text not null,
  wedding_date date,
  timezone text not null default 'America/Los_Angeles',
  default_locale text not null default 'en',
  rsvp_deadline timestamptz,
  theme jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wedding_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  wedding_id uuid not null references weddings(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, wedding_id)
);

-- ------------------------------------------------------------------ events
create table events (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  venue_name text,
  venue_address text,
  dress_code text,
  rsvp_enabled boolean not null default true,
  seating_published_at timestamptz,
  sort_order int not null default 0
);
create index events_wedding on events (wedding_id, sort_order);

-- -------------------------------------------------------------- households
create table households (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  display_name text not null,
  primary_contact_name text,
  email text,
  phone text,
  mailing_address jsonb,
  invite_code text not null,
  access_token text not null,
  max_party_size int not null default 2 check (max_party_size > 0),
  plus_one_slots int not null default 0 check (plus_one_slots >= 0),
  rsvp_status text not null default 'pending'
    check (rsvp_status in ('pending','started','completed','declined')),
  preferred_locale text not null default 'en',
  tags text[] not null default '{}',
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, invite_code),
  unique (access_token)
);
create index households_wedding on households (wedding_id);
create index households_name_trgm on households using gin (display_name gin_trgm_ops);

-- ------------------------------------------------------------------ guests
create table guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  relationship text,
  age_type text not null default 'adult' check (age_type in ('adult','child','infant')),
  origin text not null default 'named' check (origin in ('named','plus_one')),
  is_vip boolean not null default false,
  dietary_restrictions text,
  allergies text,
  accessibility_needs text,
  hotel_info jsonb,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index guests_household on guests (household_id);
create index guests_wedding on guests (wedding_id);
create index guests_name_trgm on guests using gin ((first_name || ' ' || last_name) gin_trgm_ops);

create table household_event_invites (
  household_id uuid not null references households(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  wedding_id uuid not null references weddings(id) on delete cascade,
  primary key (household_id, event_id)
);

-- ------------------------------------------------------------ meal options
create table meal_options (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  name text not null,
  description text,
  is_kids_meal boolean not null default false,
  sort_order int not null default 0
);
create index meal_options_wedding on meal_options (wedding_id, sort_order);

-- --------------------------------------------------------------- responses
create table guest_event_responses (
  guest_id uuid not null references guests(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  wedding_id uuid not null references weddings(id) on delete cascade,
  attending text not null default 'pending' check (attending in ('pending','yes','no')),
  meal_option_id uuid references meal_options(id) on delete set null,
  responded_at timestamptz,
  responded_via text check (responded_via in ('guest','admin')),
  primary key (guest_id, event_id)
);
create index responses_wedding_event on guest_event_responses (wedding_id, event_id);

-- --------------------------------------------------------------- questions
create table rsvp_questions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  label jsonb not null, -- {"en": "...", "es": "...", "vi": "..."}
  type text not null check (type in ('text','boolean','select')),
  options jsonb,
  scope text not null default 'household' check (scope in ('household','guest')),
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table rsvp_answers (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  question_id uuid not null references rsvp_questions(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  guest_id uuid references guests(id) on delete cascade,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create unique index rsvp_answers_unique
  on rsvp_answers (question_id, household_id, coalesce(guest_id, '00000000-0000-0000-0000-000000000000'));

-- ----------------------------------------------------------------- seating
create table seating_tables (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  capacity int not null default 10 check (capacity > 0),
  shape text not null default 'round' check (shape in ('round','rect','banquet')),
  pos_x float not null default 0,
  pos_y float not null default 0
);
create index seating_tables_event on seating_tables (event_id);

create table seat_assignments (
  guest_id uuid not null references guests(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  wedding_id uuid not null references weddings(id) on delete cascade,
  table_id uuid not null references seating_tables(id) on delete cascade,
  seat_number int,
  primary key (guest_id, event_id)
);
create index seat_assignments_table on seat_assignments (table_id);

-- ---------------------------------------------------------- communications
create table communications (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  type text not null check (type in ('save_the_date','invitation','reminder','thank_you','custom')),
  channel text not null default 'email' check (channel in ('email','manual')),
  subject text,
  body_template text,
  audience_filter jsonb,
  sent_at timestamptz,
  sent_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table communication_recipients (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  communication_id uuid not null references communications(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  email text,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','opened','bounced','failed')),
  resend_message_id text unique,
  updated_at timestamptz not null default now()
);
create index comm_recipients_comm on communication_recipients (communication_id);
create index comm_recipients_household on communication_recipients (household_id);

-- ------------------------------------------------------------ activity log
create table activity_log (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references weddings(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  guest_id uuid references guests(id) on delete set null,
  actor_type text not null check (actor_type in ('guest','admin','system')),
  actor_id uuid,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_household on activity_log (household_id, created_at desc);
create index activity_log_wedding on activity_log (wedding_id, created_at desc);

-- ----------------------------------------------------------------- imports
create table imports (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  filename text not null,
  status text not null default 'pending'
    check (status in ('pending','validated','committed','failed')),
  stats jsonb,
  error_report jsonb,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------- RLS
-- Members of a wedding may read; owners/editors may write. The guest surface
-- never uses these policies (server actions run with the service role).
do $$
declare t text;
begin
  foreach t in array array[
    'weddings','wedding_members','events','households','guests',
    'household_event_invites','meal_options','guest_event_responses',
    'rsvp_questions','rsvp_answers','seating_tables','seat_assignments',
    'communications','communication_recipients','activity_log','imports']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create or replace function is_wedding_member(w uuid)
returns boolean language sql stable security definer as
$$ select exists (select 1 from wedding_members m where m.wedding_id = w and m.user_id = auth.uid()) $$;

create or replace function is_wedding_editor(w uuid)
returns boolean language sql stable security definer as
$$ select exists (select 1 from wedding_members m
   where m.wedding_id = w and m.user_id = auth.uid() and m.role in ('owner','editor')) $$;

create policy weddings_select on weddings for select using (is_wedding_member(id));
create policy weddings_update on weddings for update using (is_wedding_editor(id));
create policy members_select on wedding_members for select using (is_wedding_member(wedding_id));

do $$
declare t text;
begin
  foreach t in array array[
    'events','households','guests','household_event_invites','meal_options',
    'guest_event_responses','rsvp_questions','rsvp_answers','seating_tables',
    'seat_assignments','communications','communication_recipients','activity_log','imports']
  loop
    execute format('create policy %I_select on %I for select using (is_wedding_member(wedding_id))', t, t);
    execute format('create policy %I_insert on %I for insert with check (is_wedding_editor(wedding_id))', t, t);
    execute format('create policy %I_update on %I for update using (is_wedding_editor(wedding_id))', t, t);
    execute format('create policy %I_delete on %I for delete using (is_wedding_editor(wedding_id))', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------- submit_rsvp
-- Atomic RSVP write. The app validates with the invitation-rules engine
-- BEFORE calling this; the function re-checks the hard caps as a backstop.
create or replace function submit_rsvp(p_household_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wedding_id uuid;
  v_max int;
  v_slots int;
  v_existing_plus_ones int;
  v_new_count int;
  v_via text := coalesce(p_payload->>'via', 'guest');
  v_complete boolean := coalesce((p_payload->>'complete')::boolean, false);
  v_status text;
  v_guest record;
  v_new_guest_id uuid;
  r jsonb;
  resp jsonb;
  total_responses int;
  no_responses int;
  pending_responses int;
begin
  select wedding_id, max_party_size, plus_one_slots
    into v_wedding_id, v_max, v_slots
    from households where id = p_household_id;
  if v_wedding_id is null then
    raise exception 'household not found';
  end if;

  -- backstop caps
  select count(*) into v_existing_plus_ones
    from guests where household_id = p_household_id and origin = 'plus_one';
  v_new_count := coalesce(jsonb_array_length(p_payload->'new_plus_ones'), 0);
  if v_existing_plus_ones + v_new_count > v_slots then
    raise exception 'plus one limit exceeded';
  end if;
  if (select count(*) from guests where household_id = p_household_id) + v_new_count > v_max then
    raise exception 'party size exceeded';
  end if;

  -- insert new plus ones (each with their own responses)
  for r in select * from jsonb_array_elements(coalesce(p_payload->'new_plus_ones', '[]'::jsonb))
  loop
    insert into guests (wedding_id, household_id, first_name, last_name, origin)
    values (v_wedding_id, p_household_id,
            trim(r->>'first_name'), trim(r->>'last_name'), 'plus_one')
    returning id into v_new_guest_id;

    insert into activity_log (wedding_id, household_id, guest_id, actor_type, action, payload)
    values (v_wedding_id, p_household_id, v_new_guest_id, v_via, 'plus_one.added',
            jsonb_build_object('name', trim(r->>'first_name') || ' ' || trim(r->>'last_name')));

    for resp in select * from jsonb_array_elements(coalesce(r->'responses', '[]'::jsonb))
    loop
      insert into guest_event_responses (guest_id, event_id, wedding_id, attending, meal_option_id, responded_at, responded_via)
      values (v_new_guest_id, (resp->>'event_id')::uuid, v_wedding_id,
              coalesce(resp->>'attending','pending'),
              nullif(resp->>'meal_option_id','')::uuid, now(), v_via)
      on conflict (guest_id, event_id) do update
        set attending = excluded.attending,
            meal_option_id = excluded.meal_option_id,
            responded_at = now(), responded_via = excluded.responded_via;
    end loop;
  end loop;

  -- upsert responses for existing guests (must belong to household)
  for resp in select * from jsonb_array_elements(coalesce(p_payload->'responses', '[]'::jsonb))
  loop
    if not exists (select 1 from guests g where g.id = (resp->>'guest_id')::uuid
                   and g.household_id = p_household_id) then
      raise exception 'guest does not belong to household';
    end if;
    insert into guest_event_responses (guest_id, event_id, wedding_id, attending, meal_option_id, responded_at, responded_via)
    values ((resp->>'guest_id')::uuid, (resp->>'event_id')::uuid, v_wedding_id,
            coalesce(resp->>'attending','pending'),
            nullif(resp->>'meal_option_id','')::uuid, now(), v_via)
    on conflict (guest_id, event_id) do update
      set attending = excluded.attending,
          meal_option_id = excluded.meal_option_id,
          responded_at = now(), responded_via = excluded.responded_via;
  end loop;

  -- per-guest fields (dietary etc.)
  for r in select * from jsonb_array_elements(coalesce(p_payload->'guest_fields', '[]'::jsonb))
  loop
    update guests set
      dietary_restrictions = coalesce(r->>'dietary_restrictions', dietary_restrictions),
      allergies = coalesce(r->>'allergies', allergies),
      updated_at = now()
    where id = (r->>'guest_id')::uuid and household_id = p_household_id;
  end loop;

  -- answers
  for r in select * from jsonb_array_elements(coalesce(p_payload->'answers', '[]'::jsonb))
  loop
    insert into rsvp_answers (wedding_id, question_id, household_id, guest_id, value)
    values (v_wedding_id, (r->>'question_id')::uuid, p_household_id,
            nullif(r->>'guest_id','')::uuid, r->'value')
    on conflict (question_id, household_id, coalesce(guest_id, '00000000-0000-0000-0000-000000000000'))
    do update set value = excluded.value, updated_at = now();
  end loop;

  -- recompute household status
  select count(*),
         count(*) filter (where attending = 'no'),
         count(*) filter (where attending = 'pending')
    into total_responses, no_responses, pending_responses
    from guest_event_responses ger
    join guests g on g.id = ger.guest_id
   where g.household_id = p_household_id;

  if total_responses > 0 and no_responses = total_responses then
    v_status := 'declined';
  elsif v_complete and pending_responses = 0 then
    v_status := 'completed';
  elsif total_responses - pending_responses > 0 then
    v_status := 'started';
  else
    v_status := 'pending';
  end if;

  update households set rsvp_status = v_status, updated_at = now()
   where id = p_household_id;

  insert into activity_log (wedding_id, household_id, actor_type, action, payload)
  values (v_wedding_id, p_household_id, v_via,
          case when v_status = 'completed' then 'rsvp.completed'
               when v_status = 'declined' then 'rsvp.declined'
               else 'rsvp.started' end,
          jsonb_build_object('status', v_status));

  return jsonb_build_object('status', v_status);
end;
$$;
