-- 0010: Save-the-Date sheet submissions.
--
-- One row per response row in the Google Form sheet. `row_key` is a hash of the
-- row's stable content, unique per wedding, which is what makes the weekly cron
-- safe: a double-fire is a no-op and a skipped week is caught by the next run,
-- because the job reconciles the whole sheet rather than a delta.
--
-- `applied` records the prior value of every field a match wrote, so undo
-- restores rather than guesses.

create table sheet_submissions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  source text not null check (source in ('save_the_date')),
  row_key text not null,
  raw jsonb not null,
  received_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','matched','created','ignored')),
  household_id uuid references households(id) on delete set null,
  applied jsonb,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (wedding_id, source, row_key)
);

create index sheet_submissions_wedding_status on sheet_submissions (wedding_id, status);

alter table sheet_submissions enable row level security;

-- Same per-wedding shape as every other tenant table (see 0001's policy loop).
create policy sheet_submissions_select on sheet_submissions
  for select using (is_wedding_member(wedding_id));
create policy sheet_submissions_insert on sheet_submissions
  for insert with check (is_wedding_editor(wedding_id));
create policy sheet_submissions_update on sheet_submissions
  for update using (is_wedding_editor(wedding_id));
create policy sheet_submissions_delete on sheet_submissions
  for delete using (is_wedding_editor(wedding_id));
