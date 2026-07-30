-- 0012: Budget & Vendor management.
--
-- Money is stored as integer cents in bigint columns named *_cents. Never floats,
-- never numeric — a wedding budget is summed and diffed constantly and binary
-- floating point loses pennies in exactly the places a bride notices.
--
-- Four tables: budget_categories, vendors, budget_items, budget_payments.
-- Hierarchy is Category -> Item -> Payments (Zola / Aisle Planner). A budget item
-- may optionally point at a vendor. Payments hang off items.
--
-- Two numbers are deliberately NOT stored (Binding Decision 4):
--   * actual spend  — always sum(budget_payments.amount_cents) where paid_at is
--                     not null, so a ledger and a headline total cannot drift.
--   * payment status (unpaid/partial/paid/overdue) — derived from the same sum.
-- Both are computed in pure modules under lib/, which vitest can see.
--
-- Tenancy: every table carries wedding_id and every FK between these tables is a
-- COMPOSITE FK that includes wedding_id, so a row can never point at a parent in
-- another wedding even if the app layer has a bug. RLS is the backstop, not the
-- primary guard — the admin surface reads through the service-role client
-- (lib/supabase/admin.ts), so lib/data/* filtering on wedding_id is the real guard.
--
-- Attachments are pasted URLs (vendors.contract_url, budget_payments.receipt_url),
-- not uploads: Binding Decision 6. No budget_attachments table, no Storage bucket.
-- vendor_tasks is migration 0013, a later milestone.
--
-- ADDITIVE ONLY. This runs against a live production database holding a real
-- couple's guest list: create table / create index / add column / create or
-- replace function. Nothing is dropped, renamed, truncated or retyped.

-- ------------------------------------------------- wedding-level budget settings
alter table weddings
  add column if not exists budget_total_cents bigint;                                    -- the couple's overall ceiling ("Max Spend"); null = not set yet, the UI must not invent one
alter table weddings
  add column if not exists budget_currency text not null default 'USD';                  -- display currency for the headline numbers; no FX conversion is ever performed
alter table weddings
  add column if not exists budget_benchmark_label text not null default 'Reference wedding';  -- the ONLY place the benchmark's name lives; no component may hardcode a name

comment on column weddings.budget_total_cents is
  'Overall budget ceiling in integer cents. Null means the couple has not set one; render a prompt, never $0.';
comment on column weddings.budget_currency is
  'Display currency for budget figures. Values are shown exactly as entered; no FX conversion happens anywhere.';
comment on column weddings.budget_benchmark_label is
  'Human label for the benchmark column. Read this per page; never hardcode a name in a component.';

-- ------------------------------------------------------------- budget_categories
-- Categories are PER-WEDDING ROWS, never a hardcoded enum. Research is explicit
-- that fixed category lists make couples feel "pigeon-holed"; Juliet must be able
-- to rename, reorder, add and (when empty) delete categories.
--
-- Money columns are exactly two (Binding Decision 5): target_cents, the top-down
-- allocation, used as the category forecast ONLY while the category has zero
-- items; and benchmark_cents, a nullable OVERRIDE of the sum of item benchmarks
-- (Binding Decision 3), needed because the source spreadsheet's own category
-- totals do not reconcile with their children. There is no actual_cents.
create table if not exists budget_categories (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  name text not null,
  slug text not null,                                                                    -- stable machine key: keeps the taxonomy seed and the CSV importer idempotent even after Juliet renames the category
  sort_order int not null default 0,
  target_cents bigint check (target_cents is null or target_cents >= 0),                 -- TOP-DOWN plan for this category. Category forecast falls back to this only when the category has zero items; never added to the item sum
  benchmark_cents bigint check (benchmark_cents is null or benchmark_cents >= 0),        -- the benchmark wedding's STATED total. Overrides sum(items.benchmark_cents) when non-null. NULL means unknown and renders as an em dash; 0 means genuinely spent nothing
  is_contingency boolean not null default false,                                         -- exactly one category carries this; the UI treats the buffer differently from unplanned spend
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, slug),
  unique (id, wedding_id)                                                                -- target for the composite FKs below; this is the cross-tenant guard
);

create index if not exists budget_categories_wedding_sort
  on budget_categories (wedding_id, sort_order, name);

-- ---------------------------------------------------------------------- vendors
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  category_id uuid,                                                                      -- which budget category this vendor's spend belongs to; nullable so a vendor can exist before the money is planned
  name text not null,
  role text not null default 'other',                                                    -- the wedding-team ROLE ("photographer", "dj", "florist"); free text, not an enum. Powers the "build your wedding team" empty state, where an unfilled ROLE is the prompt
  status text not null default 'researching'
    check (status in ('researching','contacted','quoted','booked','completed','passed')),
  priority text not null default 'nice_to_have'
    check (priority in ('must_have','nice_to_have','optional')),
  assigned_to text,                                                                      -- free text on purpose: a check constraint naming this couple would be wrong in a multi-tenant product
  contact_name text,
  company text,
  email text,
  phone text,
  website text,
  instagram text,
  address text,
  estimated_cents bigint check (estimated_cents is null or estimated_cents >= 0),
  quoted_cents bigint check (quoted_cents is null or quoted_cents >= 0),
  contracted_cents bigint check (contracted_cents is null or contracted_cents >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  contract_signed_at date,                                                               -- CALENDAR DATE, no timezone. Booked vendor + null here = "Contracts Outstanding" on the dashboard
  booked_at date,                                                                        -- CALENDAR DATE the couple committed; separate from the signature because they book verbally first
  contract_url text,                                                                     -- a pasted Drive/Dropbox link, NOT an upload (Binding Decision 6)
  rating smallint check (rating is null or (rating between 1 and 5)),
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, wedding_id),                                                               -- target for the composite FKs below
  constraint vendors_category_fk
    foreign key (category_id, wedding_id)
    references budget_categories (id, wedding_id)
    on delete restrict                                                                   -- MATCH SIMPLE: a null category_id satisfies this. restrict (not set null) because a composite SET NULL would also null wedding_id, which is NOT NULL
);

create index if not exists vendors_wedding_status on vendors (wedding_id, status);
create index if not exists vendors_wedding_sort on vendors (wedding_id, sort_order, name);
create index if not exists vendors_category on vendors (category_id, wedding_id);
create index if not exists vendors_contract_outstanding
  on vendors (wedding_id, contract_signed_at)
  where contract_signed_at is null;                                                      -- partial index: the "Contracts Outstanding" card only ever reads unsigned rows

-- ----------------------------------------------------------------- budget_items
-- The cost lifecycle lives here as four ADJACENT columns, never behind a tab:
-- benchmark -> estimated -> quoted -> contracted. Actual spend is derived.
create table if not exists budget_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  category_id uuid not null,
  vendor_id uuid,
  name text not null,
  qty text,                                                                              -- TEXT on purpose: the source sheet has "2", "180" and "100 liters (abundant)". Provenance only, never arithmetic
  unit_price_cents bigint check (unit_price_cents is null or unit_price_cents >= 0),      -- the sheet's "Each" column; informational, never auto-multiplied into a total (the sheet's own totals disagree with qty x each on 8 of 23 rows)
  benchmark_cents bigint check (benchmark_cents is null or benchmark_cents >= 0),         -- what the benchmark wedding actually paid for this line. The signature feature: shown beside the couple's number with a delta. NULL = unknown, 0 = genuinely nothing
  estimated_cents bigint,                                                                 -- deliberately NO >= 0 check: the seed writes one reconciliation row of -100000 to make a category match the client's own spreadsheet total
  quoted_cents bigint check (quoted_cents is null or quoted_cents >= 0),
  contracted_cents bigint check (contracted_cents is null or contracted_cents >= 0),
  contracted_source text not null default 'manual'
    check (contracted_source in ('manual','vendor')),                                     -- who last wrote contracted_cents, so the UI can say "synced from vendor" instead of silently replacing a number a human typed
  currency text not null default 'USD' check (char_length(currency) = 3),
  pending_guest_count boolean not null default false,                                     -- catering flag: this estimate cannot firm up until the final headcount lands. A badge beats a fake precise number
  is_reconciliation boolean not null default false,                                       -- rows the seed inserts to absorb the spreadsheet's own arithmetic gaps ("Not yet itemized", "Spreadsheet reconciliation"); the UI labels them rather than hiding them
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, wedding_id),
  constraint budget_items_category_fk
    foreign key (category_id, wedding_id)
    references budget_categories (id, wedding_id)
    on delete restrict,                                                                   -- deleting a category that still holds items must fail loudly, not silently orphan or delete money
  constraint budget_items_vendor_fk
    foreign key (vendor_id, wedding_id)
    references vendors (id, wedding_id)
    on delete restrict                                                                    -- the delete-vendor server action unlinks items first, then deletes
);

create index if not exists budget_items_category on budget_items (category_id, wedding_id);
create index if not exists budget_items_category_sort
  on budget_items (wedding_id, category_id, sort_order, name);
create index if not exists budget_items_vendor on budget_items (vendor_id, wedding_id);
create index if not exists budget_items_wedding on budget_items (wedding_id);

-- -------------------------------------------------------------- budget_payments
-- The payment ledger. Omitting this is The Knot's core failure — estimate-only
-- budgeting sends couples straight back to the spreadsheet.
--
-- There is no `paid` boolean: paid_at (a calendar date) IS the flag, per Binding
-- Decision 4 — "actual spend is always sum(amount_cents) where paid_at is not
-- null". One column cannot disagree with itself.
create table if not exists budget_payments (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  budget_item_id uuid not null,
  vendor_id uuid,                                                                         -- optional payee override; falls back to the item's vendor when null, so a payment keeps its payee if the item is re-categorised
  label text not null default 'Payment',                                                  -- "Deposit", "Final balance", "Second installment" — free text, users name their own schedule
  kind text not null default 'installment'
    check (kind in ('deposit','installment','final','refund')),
  amount_cents bigint not null,
  currency text not null default 'USD' check (char_length(currency) = 3),
  due_date date,                                                                          -- CALENDAR DATE, no timezone. Never pass to new Date(); use lib/format/wedding-date.ts and the venue's zone
  paid_at date,                                                                           -- CALENDAR DATE the money actually left. NULL = unpaid. This is the only paid flag
  method text,                                                                            -- free text ("Zelle", "Amex", "check #1042") — a check constraint here would pigeon-hole users
  reference text,                                                                         -- confirmation / check number
  receipt_url text,                                                                       -- a pasted link, NOT an upload (Binding Decision 6)
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_payments_amount_sign
    check ((kind = 'refund' and amount_cents < 0) or (kind <> 'refund' and amount_cents > 0)),  -- refunds are the only negative rows, so sum(amount_cents) where paid is simply "money spent"
  constraint budget_payments_item_fk
    foreign key (budget_item_id, wedding_id)
    references budget_items (id, wedding_id)
    on delete cascade,                                                                    -- a payment cannot outlive its line item
  constraint budget_payments_vendor_fk
    foreign key (vendor_id, wedding_id)
    references vendors (id, wedding_id)
    on delete restrict
);

create index if not exists budget_payments_item
  on budget_payments (budget_item_id, wedding_id);
create index if not exists budget_payments_item_sort
  on budget_payments (budget_item_id, sort_order, due_date);
create index if not exists budget_payments_due
  on budget_payments (wedding_id, due_date)
  where paid_at is null;                                                                  -- "Payments due this month", the overdue banner
create index if not exists budget_payments_paid
  on budget_payments (wedding_id, paid_at)
  where paid_at is not null;                                                              -- "Budget spent" and the spend-over-time bars
create index if not exists budget_payments_vendor
  on budget_payments (vendor_id, wedding_id);

-- --------------------------------------------------------------------------- RLS
-- Same shape as every other tenant table (0001's policy loop). The existence
-- guard keeps this file re-runnable; the four policies it creates are identical
-- to 0001's.
do $$
declare t text;
begin
  foreach t in array array['vendors','budget_categories','budget_items','budget_payments']
  loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute format('create policy %I_select on %I for select using (is_wedding_member(wedding_id))', t, t);
      execute format('create policy %I_insert on %I for insert with check (is_wedding_editor(wedding_id))', t, t);
      execute format('create policy %I_update on %I for update using (is_wedding_editor(wedding_id))', t, t);
      execute format('create policy %I_delete on %I for delete using (is_wedding_editor(wedding_id))', t, t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------- apply_payment_schedule
-- Deposit auto-split ("enter total + deposit, the balance is computed — never
-- make the user subtract") writes several rows at once and supabase-js has no
-- transactions. One RPC so a half-written schedule is impossible. It is also the
-- safe editor: PAID rows are never touched, and unpaid rows the payload omits are
-- removed, so calling it twice with the same payload produces the same ledger.
create or replace function apply_payment_schedule(
  p_wedding_id uuid,
  p_item_id uuid,
  p_schedule jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_keep uuid[] := '{}';
  v_id uuid;
  v_deleted int;
  v_written int := 0;
begin
  if not exists (select 1 from budget_items i
                  where i.id = p_item_id and i.wedding_id = p_wedding_id) then
    raise exception 'budget item not found in this wedding';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_schedule, '[]'::jsonb))
  loop
    v_id := nullif(r->>'id', '')::uuid;

    if v_id is not null then
      update budget_payments p set
        label        = coalesce(nullif(r->>'label',''), p.label),
        kind         = coalesce(nullif(r->>'kind',''), p.kind),
        amount_cents = coalesce((r->>'amount_cents')::bigint, p.amount_cents),
        currency     = coalesce(nullif(r->>'currency',''), p.currency),
        due_date     = nullif(r->>'due_date','')::date,
        vendor_id    = nullif(r->>'vendor_id','')::uuid,
        notes        = nullif(r->>'notes',''),
        sort_order   = coalesce((r->>'sort_order')::int, p.sort_order),
        updated_at   = now()
      where p.id = v_id
        and p.budget_item_id = p_item_id
        and p.wedding_id = p_wedding_id
        and p.paid_at is null;
      if not found then
        raise exception 'payment % is not an editable unpaid payment on this item', v_id;
      end if;
    else
      insert into budget_payments (
        wedding_id, budget_item_id, vendor_id, label, kind,
        amount_cents, currency, due_date, notes, sort_order
      ) values (
        p_wedding_id,
        p_item_id,
        nullif(r->>'vendor_id','')::uuid,
        coalesce(nullif(r->>'label',''), 'Payment'),
        coalesce(nullif(r->>'kind',''), 'installment'),
        (r->>'amount_cents')::bigint,
        coalesce(nullif(r->>'currency',''), 'USD'),
        nullif(r->>'due_date','')::date,
        nullif(r->>'notes',''),
        coalesce((r->>'sort_order')::int, 0)
      ) returning id into v_id;
    end if;

    v_keep := v_keep || v_id;
    v_written := v_written + 1;
  end loop;

  delete from budget_payments p
   where p.budget_item_id = p_item_id
     and p.wedding_id = p_wedding_id
     and p.paid_at is null
     and not (p.id = any(v_keep));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('written', v_written, 'deleted', v_deleted);
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default, and the anon key ships to every browser. The only caller is the
-- service-role client in lib/data/, whose grant is unaffected.
revoke execute on function apply_payment_schedule(uuid, uuid, jsonb) from public, anon, authenticated;

-- --------------------------------------------------- set_vendor_contracted_price
-- Vendor -> budget sync is ONE-DIRECTIONAL and EXPLICIT. Setting a vendor's
-- contracted price pushes it to every budget item linked to that vendor,
-- atomically, and RETURNS the before/after of each row it touched (including
-- whether the previous value was hand-typed) so the caller can tell the user
-- exactly what changed. The app must never silently overwrite a human's number.
-- Turning this diff into sentences is a pure, unit-tested module; this function
-- only reports facts.
create or replace function set_vendor_contracted_price(
  p_wedding_id uuid,
  p_vendor_id uuid,
  p_contracted_cents bigint,
  p_currency text default 'USD'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before bigint;
  v_changes jsonb := '[]'::jsonb;
  it record;
begin
  select v.contracted_cents into v_before
    from vendors v
   where v.id = p_vendor_id and v.wedding_id = p_wedding_id;
  if not found then
    raise exception 'vendor not found in this wedding';
  end if;

  update vendors set
    contracted_cents = p_contracted_cents,
    currency = coalesce(nullif(p_currency,''), currency),
    updated_at = now()
  where id = p_vendor_id and wedding_id = p_wedding_id;

  for it in
    select i.id, i.name, i.contracted_cents, i.contracted_source
      from budget_items i
     where i.vendor_id = p_vendor_id and i.wedding_id = p_wedding_id
     order by i.sort_order, i.name
  loop
    if it.contracted_cents is distinct from p_contracted_cents then
      update budget_items set
        contracted_cents = p_contracted_cents,
        contracted_source = 'vendor',
        currency = coalesce(nullif(p_currency,''), currency),
        updated_at = now()
      where id = it.id;

      v_changes := v_changes || jsonb_build_object(
        'item_id',    it.id,
        'item_name',  it.name,
        'from',       it.contracted_cents,
        'to',         p_contracted_cents,
        'was_manual', (it.contracted_source = 'manual' and it.contracted_cents is not null)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'vendor_from', v_before,
    'vendor_to',   p_contracted_cents,
    'items',       v_changes
  );
end;
$$;

revoke execute on function set_vendor_contracted_price(uuid, uuid, bigint, text) from public, anon, authenticated;

-- ------------------------------------------------------ category taxonomy (seed)
-- Per-wedding rows, seeded for the live wedding so the app has data the moment
-- this lands (0002_seed.sql precedent). The standard twelve categories, in the
-- couple's own spreadsheet order, with her real category money. Idempotent on
-- (wedding_id, slug): safe to re-run, and safe after Juliet renames a category
-- because a rename does not change the slug.
--
-- benchmark_cents null = the benchmark wedding's figure is unknown for that
-- category; 0 (Flights) = the benchmark wedding genuinely spent nothing.
-- Contingency is seeded mandatory but unvalued: the Budget page offers 5/8/10%
-- of weddings.budget_total_cents and must never silently pick one.
insert into budget_categories
  (wedding_id, slug, name, sort_order, benchmark_cents, target_cents, is_contingency)
values
  ('11111111-1111-1111-1111-111111111111','venue',                 'Venue',                 0,  807900, 1537000, false),
  ('11111111-1111-1111-1111-111111111111','food-and-beverage',     'Food and Beverage',     1,  993300, 1650000, false),
  ('11111111-1111-1111-1111-111111111111','music-and-photography', 'Music + Photography',   2,  698400,  830000, false),
  ('11111111-1111-1111-1111-111111111111','other-vendors',         'Other Vendors',         3,    null,   50000, false),
  ('11111111-1111-1111-1111-111111111111','attire-and-beauty',     'Attire + Beauty',       4,  409300,  520000, false),
  ('11111111-1111-1111-1111-111111111111','gifts',                 'Gifts',                 5,  426100,  200000, false),
  ('11111111-1111-1111-1111-111111111111','flowers-and-decor',     'Flowers + Decor',       6,  172200,  500000, false),
  ('11111111-1111-1111-1111-111111111111','printing',              'Printing',              7,   35500,   30000, false),
  ('11111111-1111-1111-1111-111111111111','misc',                  'Misc',                  8,  210100,  400000, false),
  ('11111111-1111-1111-1111-111111111111','hotels',                'Hotels',                9,  343300,  300000, false),
  ('11111111-1111-1111-1111-111111111111','flights',               'Flights',              10,       0,  280000, false),
  ('11111111-1111-1111-1111-111111111111','contingency',           'Contingency',          11,    null,    null, true)
on conflict (wedding_id, slug) do nothing;

-- The benchmark's real-world name lives in data, never in code (Binding
-- Decision 2): the column default is generic, and seeding names it for this one
-- wedding. Guarded on the default so a later rename by Juliet is never clobbered.
update weddings
   set budget_benchmark_label = 'Alison''s wedding',
       updated_at = now()
 where id = '11111111-1111-1111-1111-111111111111'
   and budget_benchmark_label = 'Reference wedding';
