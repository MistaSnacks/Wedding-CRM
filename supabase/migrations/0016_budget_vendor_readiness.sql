-- Planning records are private to wedding members. This migration is not applied by the build.
create table if not exists planning_tasks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  vendor_id uuid,
  title text not null check (length(trim(title)) between 1 and 300),
  due_date date,
  assigned_to text,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vendor_id, wedding_id) references vendors(id, wedding_id) on delete cascade
);
create index if not exists planning_tasks_due on planning_tasks(wedding_id, due_date) where completed_at is null;

create table if not exists vendor_documents (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  vendor_id uuid not null,
  name text not null check (length(name) between 1 and 300),
  kind text not null default 'document' check (kind in ('contract','quote','receipt','document')),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 8388608),
  created_at timestamptz not null default now(),
  foreign key (vendor_id, wedding_id) references vendors(id, wedding_id) on delete restrict
);
create index if not exists vendor_documents_vendor on vendor_documents(wedding_id, vendor_id);
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('wedding-documents','wedding-documents',false,8388608,array['application/pdf','image/jpeg','image/png','text/plain'])
on conflict (id) do nothing;
-- No direct anon/authenticated storage policies: authenticated app routes check membership,
-- then use the server client to upload or issue a short-lived signed download URL.

create unique index if not exists events_id_wedding_planning_idx on events(id, wedding_id);
create table if not exists budget_headcount_links (
  item_id uuid primary key,
  wedding_id uuid not null references weddings(id) on delete cascade,
  event_id uuid not null,
  age_scope text not null default 'all' check (age_scope in ('all','adult','child','infant')),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 100000000000),
  updated_at timestamptz not null default now(),
  foreign key (item_id,wedding_id) references budget_items(id,wedding_id) on delete cascade,
  foreign key (event_id,wedding_id) references events(id,wedding_id) on delete cascade
);

do $$ declare t text; begin
  foreach t in array array['planning_tasks','vendor_documents','budget_headcount_links'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_read on %I for select using (is_wedding_member(wedding_id))', t, t);
    execute format('create policy %I_write on %I for all using (is_wedding_editor(wedding_id)) with check (is_wedding_editor(wedding_id))', t, t);
  end loop;
end $$;

-- Lock and recheck the exact preview in the same transaction as the estimate write.
create or replace function apply_headcount_estimate(
  p_wedding_id uuid, p_item_id uuid, p_event_id uuid, p_age_scope text,
  p_expected_count integer, p_expected_unit bigint, p_expected_estimate bigint, p_currency text, p_actor_id uuid
) returns bigint language plpgsql security definer set search_path=public as $$
declare link budget_headcount_links%rowtype; item budget_items%rowtype; heads integer; amount bigint;
begin
  select * into link from budget_headcount_links where item_id=p_item_id and wedding_id=p_wedding_id for update;
  if not found then raise exception 'Headcount link not found in this wedding'; end if;
  select * into item from budget_items where id=p_item_id and wedding_id=p_wedding_id for update;
  if not found then raise exception 'Budget line not found in this wedding'; end if;
  select count(distinct g.id) into heads
    from guests g join guest_event_responses r on r.guest_id=g.id and r.wedding_id=p_wedding_id
    join households h on h.id=g.household_id and h.wedding_id=p_wedding_id and h.archived_at is null
    join household_event_invites i on i.household_id=g.household_id and i.event_id=r.event_id and i.wedding_id=p_wedding_id
    where g.wedding_id=p_wedding_id and r.event_id=link.event_id and r.attending='yes'
      and (link.age_scope='all' or g.age_type=link.age_scope);
  if heads is distinct from p_expected_count or link.unit_price_cents is distinct from p_expected_unit
     or item.estimated_cents is distinct from p_expected_estimate or link.event_id is distinct from p_event_id
     or link.age_scope is distinct from p_age_scope or item.currency is distinct from p_currency then
    raise exception 'Headcount or pricing changed. Reload and review the new estimate.';
  end if;
  amount := heads::bigint * link.unit_price_cents;
  if amount > 100000000000 then raise exception 'Calculated estimate exceeds the supported amount'; end if;
  update budget_items set estimated_cents=amount, qty=heads::text, unit_price_cents=link.unit_price_cents,
    pending_guest_count=true, updated_at=now() where id=p_item_id and wedding_id=p_wedding_id;
  insert into activity_log(wedding_id,actor_type,actor_id,action,payload)
    values(p_wedding_id,'admin',p_actor_id,'budget.headcount_applied',jsonb_build_object('itemId',p_item_id,'count',heads,'before',p_expected_estimate,'estimateCents',amount));
  return amount;
end $$;
revoke execute on function apply_headcount_estimate(uuid,uuid,uuid,text,integer,bigint,bigint,text,uuid) from public,anon,authenticated;
grant execute on function apply_headcount_estimate(uuid,uuid,uuid,text,integer,bigint,bigint,text,uuid) to service_role;

-- A dollar payment cannot silently become a peso payment when a parent is edited.
create or replace function guard_budget_currency() returns trigger language plpgsql set search_path=public as $$
declare item_currency text;
begin
  if tg_table_name='budget_payments' then
    select currency into item_currency from budget_items where id=new.budget_item_id and wedding_id=new.wedding_id for update;
    if item_currency is distinct from new.currency then raise exception 'Payment currency must match its budget line'; end if;
  elsif new.currency is distinct from old.currency and exists(
    select 1 from budget_payments where budget_item_id=new.id and wedding_id=new.wedding_id and currency<>new.currency
  ) then raise exception 'A line with payments cannot change currency; create a separate line';
  end if;
  return new;
end $$;
create trigger budget_payment_currency before insert or update of currency,budget_item_id,wedding_id on budget_payments for each row execute function guard_budget_currency();
create trigger budget_item_currency before update of currency on budget_items for each row execute function guard_budget_currency();

-- Refuse deletion until private files have been removed through the storage-aware route.
-- The row lock serializes concurrent document links; all unlinking rolls back on failure.
create or replace function remove_planning_vendor(p_wedding_id uuid,p_vendor_id uuid,p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v vendors%rowtype;
begin
 select * into v from vendors where id=p_vendor_id and wedding_id=p_wedding_id for update;
 if not found then raise exception 'Vendor not found in this wedding'; end if;
 if exists(select 1 from vendor_documents where vendor_id=p_vendor_id and wedding_id=p_wedding_id) then
   raise exception 'Remove the uploaded documents before deleting this vendor.';
 end if;
 update budget_items set vendor_id=null,updated_at=now() where wedding_id=p_wedding_id and vendor_id=p_vendor_id;
 update budget_payments set vendor_id=null,updated_at=now() where wedding_id=p_wedding_id and vendor_id=p_vendor_id;
 delete from vendors where id=p_vendor_id and wedding_id=p_wedding_id;
 insert into activity_log(wedding_id,actor_type,actor_id,action,payload) values(p_wedding_id,'admin',p_actor_id,'vendor.removed',jsonb_build_object('vendorId',p_vendor_id,'name',v.name));
end $$;
revoke execute on function remove_planning_vendor(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function remove_planning_vendor(uuid,uuid,uuid) to service_role;

-- Guard opt-in vendor price sync against a concurrent manual edit or currency change.
create or replace function apply_vendor_contract_price(p_wedding_id uuid,p_vendor_id uuid,p_item_id uuid,
 p_expected_price bigint,p_expected_source text,p_vendor_price bigint,p_currency text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v vendors%rowtype; i budget_items%rowtype;
begin
 select * into v from vendors where id=p_vendor_id and wedding_id=p_wedding_id for update;
 if not found or v.contracted_cents is distinct from p_vendor_price or v.currency is distinct from p_currency or p_vendor_price is null then return false; end if;
 select * into i from budget_items where id=p_item_id and wedding_id=p_wedding_id for update;
 if not found or i.vendor_id is distinct from p_vendor_id or i.currency is distinct from p_currency
   or i.contracted_cents is distinct from p_expected_price or i.contracted_source is distinct from p_expected_source
   or (i.contracted_cents is not null and i.contracted_source='manual') then return false; end if;
 if (select count(*) from budget_items where vendor_id=p_vendor_id and wedding_id=p_wedding_id) <> 1 then return false; end if;
 update budget_items set contracted_cents=p_vendor_price,contracted_source='vendor',updated_at=now() where id=p_item_id and wedding_id=p_wedding_id;
 return true;
end $$;
revoke execute on function apply_vendor_contract_price(uuid,uuid,uuid,bigint,text,bigint,text) from public,anon,authenticated;
grant execute on function apply_vendor_contract_price(uuid,uuid,uuid,bigint,text,bigint,text) to service_role;

-- Historical mixed payment currencies need an explicit accounting correction before rollout.
do $$ begin
 if exists(select 1 from budget_payments p join budget_items i on i.id=p.budget_item_id where p.currency<>i.currency) then
  raise exception 'A payment currency differs from its budget line. Review these records before applying budget readiness.';
 end if;
end $$;

create or replace function split_budget_payment_schedule(p_wedding_id uuid,p_item_id uuid,p_total bigint,p_deposit bigint,p_deposit_due date,p_balance_due date,p_actor_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare i budget_items%rowtype;
begin
 select * into i from budget_items where id=p_item_id and wedding_id=p_wedding_id for update;
 if not found then raise exception 'Budget line not found in this wedding'; end if;
 if p_total is null or p_deposit is null or p_total>100000000000 or p_deposit<=0 or p_deposit>=p_total then raise exception 'Choose a positive deposit smaller than the total'; end if;
 if exists(select 1 from budget_payments where budget_item_id=p_item_id and wedding_id=p_wedding_id) then
  if (select count(*) from budget_payments where budget_item_id=p_item_id and wedding_id=p_wedding_id)=2
    and exists(select 1 from budget_payments where budget_item_id=p_item_id and wedding_id=p_wedding_id and kind='deposit' and label='Deposit' and amount_cents=p_deposit and due_date is not distinct from p_deposit_due and currency=i.currency)
    and exists(select 1 from budget_payments where budget_item_id=p_item_id and wedding_id=p_wedding_id and kind='final' and label='Final balance' and amount_cents=p_total-p_deposit and due_date is not distinct from p_balance_due and currency=i.currency) then return false; end if;
  raise exception 'This line already has a payment schedule. Review it before adding another installment.';
 end if;
 insert into budget_payments(wedding_id,budget_item_id,vendor_id,label,kind,amount_cents,currency,due_date) values
 (p_wedding_id,p_item_id,i.vendor_id,'Deposit','deposit',p_deposit,i.currency,p_deposit_due),
 (p_wedding_id,p_item_id,i.vendor_id,'Final balance','final',p_total-p_deposit,i.currency,p_balance_due);
 insert into activity_log(wedding_id,actor_type,actor_id,action,payload) values(p_wedding_id,'admin',p_actor_id,'budget.payment_schedule_created',jsonb_build_object('itemId',p_item_id,'totalCents',p_total,'depositCents',p_deposit));
 return true;
end $$;
revoke execute on function split_budget_payment_schedule(uuid,uuid,bigint,bigint,date,date,uuid) from public,anon,authenticated;
grant execute on function split_budget_payment_schedule(uuid,uuid,bigint,bigint,date,date,uuid) to service_role;
