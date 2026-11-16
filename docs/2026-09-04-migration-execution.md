# Database migration execution — September 4, 2026

User authorized application of the readiness migrations and authenticated the Supabase CLI. Target: **guest-crm**, project `lagjcyaquqbddmnmzvcm`, matching the repository link and `.env.local` app URL.

## Applied

- Verified the remote timestamped entries `20260730061226` and `20260820174859` contain the exact local 0012 and 0013 SQL. Normalized only their history version/name metadata to match the repository, with content-hash guards and a saved copy of the original records.
- Discovered 0014 was not recorded remotely; all RSVP questions were already inactive. Included 0014 with 0015–0019.
- Applied **0014–0019 in one transaction**, including their migration-history records, an advisory migration lock and bounded lock/statement timeouts. Notified PostgREST to reload its schema.
- `supabase db push --dry-run` failed with `failed to read profile: Unsupported Config Type ""` in CLI 2.109.0, including with explicit default profile. Used the authenticated CLI's `db query --linked --file` instead. No credentials were printed or copied into source.

## Verification

- Remote/local migration history now matches through 0019; no migrations remain pending.
- Preserved record counts: 156 households, 248 guests, 76 budget items, 13 payments.
- All nine checked operational tables have RLS enabled.
- No new security-definer RPC grants unexpected execution to anon/authenticated.
- `wedding-documents` bucket exists and is private.
- Zero enabled automatic schedules; outbox empty. No emails sent.
- Local dev started at `http://localhost:3006`; `/admin/login` and `/rsvp` both returned HTTP200.

## Snapshot and limits

Supabase's backup listing returned no available restore points and PITR disabled. The native CLI dump path was unavailable because Docker is not installed. Before schema changes, saved a private snapshot outside git at `/Users/admin/.codex/backups/guest-crm/2026-09-04-readiness/`: all 21 public tables/1,458 records, public function definitions and ACLs, schema catalog, and migration history. Directory permissions 0700; files 0600.

This is an application-data/catalog snapshot, **not a full cluster/Auth/Storage backup**. Full hosted restore readiness remains to be established. No hosting deployment or scheduled-message activation was performed.
