# Juliet readiness — September 4, 2026

This is the current working-tree handoff. **Database migrations through 0019 are now applied to the linked guest-crm Supabase project**, and local dev runs on port 3006. Application code has not been deployed to Vercel. See [the migration execution record](2026-09-04-migration-execution.md) for target verification, backup scope and checks. Browser acceptance, real delivery and cron verification remain release gates. The original audit remains historical baseline evidence.

## Final local verification

September 4, 2026, after all three Astra implementation scopes were combined:

- `npm test`: **851 tests passed across 58 files**, including isolated PostgreSQL migration/transaction tests; baseline was 743 tests across 36 files.
- `npm run build`: **passed**, including TypeScript and all new routes.
- `npm audit --omit=dev --json`: **zero reported vulnerabilities**.
- `git diff --check`: **passed**.
- At the implementation checkpoint, no remote writes or messages were performed. The subsequent authorized database migration is recorded below; browser/device verification remains unavailable.

Detailed coverage: [security/RSVP](readiness-security-progress.md), [budget/vendors](readiness-budget-progress.md), [communications/automation/imports](readiness-automation-progress.md).

## Implemented work

| Audit findings | Current changes |
| --- | --- |
| F01–03 | Guest DTO limits browser fields; transactional last-owner protection; supported admin session-cookie refresh proxy. |
| F04 | Next updated to 16.3.4 and SheetJS to official 0.20.3 distribution; lockfile refreshed. |
| F05–14 | Per-event RSVP and menus; expected-answer completeness; final-submit validation; stable plus-one IDs/edit/remove; locked invitation limits; recomputation triggers; closed read-only summaries; SQL relationship checks. |
| F15–20 | Explicit event reports/print/cards; complete paginated reads; safe CSV escaping; query failures surfaced; null meal clearing; event-specific unseated/pending logic. |
| F21–23 | Atomic household seating, locked capacity/eligibility checks, stale-seat cleanup, publishing validation and live guest tablemate filtering. Subsequent saved edits remain visible while publication is enabled. |
| F24–29 | Budget drawer refresh and request-generation guards; usable vendor routes; separate currency ledgers; retained/idempotent payment drafts; visible cost warnings. |
| F30–39 | Frozen reviewed campaigns, real send results, durable outbox, suppression/retry controls, verified persisted webhooks, atomic confirmation enqueue and truthful RSVP result. |
| F40–46 | Ambiguous email review, stable source/content versions, transactional sync/review/create/undo, batch dedupe and run health; visible manual retry/CSV fallback. |
| F47–50 | Reviewed transactional CSV reconciliation, explicit contact conflicts, same-input retry dedupe, parser diagnostics, atomic household/guest creation and invite-derived pending reports. |
| F51 | Atomic shared Redis or PostgreSQL limiter; bounded local fallback only outside production; production local cache bypass. |
| F52–58 | Loading/error/not-found recovery, optimized static admin/mobile backdrop, keyboard seating, focus management and labels, canonical complete search, invited-only login recovery, household archive/restore and deliberate locale persistence. |
| F59–60 | Current setup/environment/release documentation, CI test/build/audit workflow, isolated SQL tests, budget clean-fixture reconciliation regression. |

Routine planning tools now include guest and household editing, guest moves/splits/merges, protected menu management, table editing, vendor/contact/contract workflows, private attachments, payment/task calendars, budget/payment/vendor, monthly cash-flow and vendor-cost exports and headcount cost proposals. Import drafts are opt-in sessionStorage (24-hour expiry; closing the tab clears them); saved column choices contain mappings rather than guest data.

## Automation

| Item | Current behavior |
| --- | --- |
| A1 | Needs attention derives corrective tasks and removes them when source facts are repaired. |
| A2 | Durable claimed outbox, stable provider keys, failure/suppression state and retry controls. Ambiguous delivery beyond the provider idempotency safety window is held for review. |
| A3 | Opt-in RSVP reminders, venue-local schedule, deadline/cooldown/cap checks and completion suppression. |
| A4 | Opt-in daily/weekly planning digest to a chosen planner, deduplicated by day and changed actionable snapshot. |
| A5 | Opt-in payment reminders and downloadable calendar; notifications never initiate payments. |
| A6 | Failed deliveries are visible for contact repair/retry; complaints remain suppressed. |
| A7 | Duplicate-safe Sheet/import reconciliation with explicit conflicts and recovery. |
| A8 | RSVP-reactive seat checks plus reviewed household suggestions; existing manual placements stay fixed. |
| A9 | Event-specific caterer Excel snapshot includes attendee detail, reconciled summary, meals by table ID and exceptions. CSV remains a flat attendee report. |
| A10 | Event/age headcount-linked estimates display deltas for approval; contracted prices remain protected. |
| A11 | Vendor booking links to budget and a reviewed payment schedule proposal. |
| A12 | Needs attention provides non-mutating checks; CI and isolated SQL regressions cover core invariants. |

Automatic campaigns/digests/payment notices default **off**. Users must configure and enable them. Already-approved manual campaigns and RSVP confirmations are processed independently. No emails were sent by the implementation work.

## Migration/release order

1. Back up the target database and verify restoration access before applying changes. Use an isolated preview/test project first. Existing migrations 0001–0014 stay unchanged.
2. Apply 0015_security_rsvp.sql, 0016_budget_vendor_readiness.sql, 0017_automation_reliability.sql, 0018_readiness_operations.sql and 0019_csv_reconciliation.sql in filename order (plus any later migration in this release). They add required RPCs/triggers/tables and a private document bucket. Code and migrations are a coordinated release.
3. Verify service-only RPC execution grants and RLS on new operational tables in real Supabase. PGlite tests cannot verify Supabase Storage APIs, PostgREST schema-cache refresh or hosted Auth behavior.
4. Confirm production env from `.env.example`: application URL, Supabase keys, session secret, verified Resend sender/reply-to and webhook secret; Google service-account sharing/range and cron secret as needed. Never copy development fixture credentials or reseed production.
5. Deploy a preview with new schema. Complete the browser walkthrough below before production release. New scheduling stays disabled until its audience/template and configuration are reviewed.
6. Verify a real authorized test delivery, webhook progression, repeated sync no-op/changed-row review, and a successful cron run. Verify backup retention and restore/export procedure.

Vercel has a 4.5 MB function request limit, so import validation caps UTF-8 structured payloads at 3 MB with a 4 MB Next action limit. Workbook file size is checked separately because decompressed rows may be larger. See [function limits](https://vercel.com/docs/functions/limitations). The five-minute automation cron requires a plan/scheduler supporting that cadence; Hobby permits daily jobs only. See [cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing). Confirm hosting plan before releasing `vercel.json`.

## Acceptance walkthrough

Use an isolated seeded wedding and intended test inboxes. No destructive or messaging probes should run against real guests.

- EN/ES/VI RSVP: different answers across two events, event menus/kids, plus-one add/rename/remove/retry, incomplete final rejection, decline, reopen/closed summary and every published table.
- Admin access: refresh-token navigation, expired login link, viewer/editor/owner gates and last-owner protection.
- Guests: edit contacts/locale/names, complete phone RSVP, change invitations, archive/restore, move/split/merge and confirm preserved responses.
- Seating: keyboard and pointer, last-chair conflict, group rollback, stale-seat release, reviewed suggestions, publish block and caterer/print totals for each event.
- Budget/vendors: fast drawer switching, save/refetch, failed payment draft/retry, mixed currencies, private attachment upload/download, linked contract/schedule and headcount delta approval.
- Imports: malformed quotes, multi-worksheet file, saved draft restore, same-file retry, conflicting contacts, append-only guests, concurrent edit rejection, 201+ households and 1,000+ responses.
- Automation: approved frozen audience, send failure/resume, bounce/complaint, early/out-of-order webhook, sync rerun/edit/undo and visible health.
- Phone/keyboard: 390px and zoom, focus/Escape, readable secondary text, long dietary content, pending/error states and no decorative video network request on admin/mobile/reduced-motion.

## Remaining factual decisions and limits

- Preserve deliberate direct name/email guest access unless the owner changes that policy. It is not proof of identity.
- Confirm the venue timezone and stored instants together (historical notes say Los Angeles for a Guadalajara venue). No timezone data was changed.
- Keep currencies separate until a conversion/budget policy is agreed.
- Browser automation is unavailable in this session (no enabled browser surfaces). Visual, mobile, actual login-cookie and real RSC payload acceptance remains unverified.
- Linked database migrations, new RLS/privileged RPC grants and the private bucket have been verified. The deployed application revision, real delivery, cron execution and full backup/restore capability remain unverified.
- Recovery is targeted: archive/restore and reviewed transactional sync undo are available; arbitrary undo of every historical edit is not provided. Database restore remains an operational requirement.
- Multitenancy is deliberately not certified. Active wedding selection, legacy tenant-consistent foreign keys, scoped service-role access and adversarial isolation tests remain a separate project.

Historical budget/handoff notes are preserved under `docs/archive/`.
