-- Table turn for the 3D venue editor (/venue-preview), in degrees (0-359).
-- The admin Seating canvas does not draw turns; it ignores this column.
--
-- Additive and safe to run on a live database: existing rows get 0.
-- No RLS or grant change is needed. The existing seating_tables row policies
-- (is_wedding_member / is_wedding_editor on wedding_id) and table grants
-- cover new columns, and the app writes through the service-role client
-- with an explicit wedding_id filter (lib/data/seating.ts turnTable).
-- The app works before this runs: it reads tables without the column and
-- treats every turn as 0 (lib/venue/live-load.ts, turnTable).
alter table seating_tables
  add column if not exists rotation real not null default 0;
