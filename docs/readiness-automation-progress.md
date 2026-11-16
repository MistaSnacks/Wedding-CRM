# Communications, automation, sync and CSV reconciliation — implementation record

Updated 2026-09-04. All changes are local. No production migrations, deployments, real emails, or external data mutations were performed.

## Implemented

- Campaign audiences include started RSVPs. Reminder eligibility uses the same seven-day cooldown across preview, UI and scheduled generation. Missing, archived, bounced and complained contacts are handled explicitly.
- Campaign review is a persisted actor-scoped, expiring snapshot of recipients and rendered content. Queueing locks the draft, refuses changed contacts/replies, and returns the same campaign on replay.
- `email_outbox` provides durable unique keys, claims, leases, bounded attempts/backoff, provider IDs and failure reasons. Manual send starts a five-message batch; the cron drains 25 per invocation. The sender/reply-to and rendered request are frozen before delivery. API failures and development previews never count as successful sends.
- Missing production email configuration and missing webhook authentication fail closed. Resend's installed SDK verifies webhook signatures. Webhooks are persisted before acknowledgement and replay after message correlation. SQL updates statuses monotonically, suppresses bounce/complaint addresses, and surfaces delivery issues.
- Outbox retries reuse the same provider key. Ambiguous attempts older than 20 hours become terminal failures and are never automatically reclaimed. This stays inside Resend's documented [24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys). A manual replacement requires confirmation that the original was not delivered; it never clears a complaint suppression. The original repair task closes only when the replacement is accepted.
- Guest confirmation insertion is coordinated with the security agent inside the RSVP transaction. Declined confirmation copy is localized separately; email failure cannot retroactively invalidate a successful RSVP.
- New settings in Communications support opt-in weekly guest reminders (start date, weekday, per-household cap, reviewed localized templates), daily/weekly planning digest and payment reminders at seven days, one day and once overdue. Every outbound schedule is **disabled by default**. User-approved manual campaigns and RSVP confirmations drain regardless of these schedule switches.
- Scheduled reminders stop at the deadline, after a reply, after archiving, or when invitations are removed. Delivery rechecks schedule pause/cap, current household/contact and current planner recipient. Payment reminders recheck paid state and due date immediately before sending. Revised due dates receive different keys; stale queued reminders are suppressed.
- The digest uses the shared readiness tasks, counts and up to five linked titles. It excludes guest notes, suppresses unchanged snapshots and atomically permits at most one digest per venue-local date. Repeated identical failures do not create repeated emails.
- `automation_runs` and `sync_runs` retain durable started/success/failed results. The app shows the last check, errors and timed-out runs. Unmatched webhook events cannot starve matched events.
- Sheet identity ambiguity stays in review when multiple households share an email. Candidate lists are deduplicated by household. Ambiguous free-text opt-out wording never auto-declines a guest and stays in review.
- Sheet ingestion deduplicates identical rows atomically and versions changed raw content. Edited resolved responses reopen for human review. The visible response version is pinned through resolution; an intervening sheet edit or household edit rejects the stale action.
- Sheet apply/create/ignore/undo are transactional RPCs that lock the submission and household, compare prior field values and retain an archive. Duplicate creates and repeated resolution are refused. Undo restores recorded values atomically without replacing newer edits.
- Sync fetches only household fields used by reconciliation, avoids fuzzy scoring for automatic identity matches, and bounds processing time. Remaining rows stay pending for the next run. Imports always shows connection/run state and a manual CSV upload, including an empty integration.
- CSV validation freezes normalized households, context, actor and file/mapping fingerprint. Commit is bound to that exact review. The transaction returns prior results for a repeated committed fingerprint, including across separate upload runs.
- CSV existing-household reconciliation requires explicit create/skip/append/update decisions. Append adds only new normalized-name guests and fills blank contacts; it preserves existing invitations and RSVP answers. Contact-only update changes conflict fields only when explicitly selected. Current household values and guest identities are compared against review before writing; concurrent edits cause a rollback. Existing-household IDs use the PostgreSQL UUID schema, including seeded IDs.
- Both CSV validate and commit enforce 10,000 rows / 3,000,000 UTF-8 bytes of serialized rows+mapping. Internal expected-value snapshots are retained on the server and excluded from client responses.

## Verification

- `npx tsc --noEmit --pretty false` clean during the final scoped check.
- 99 focused tests across 12 files passed, including 14 isolated PostgreSQL/PGlite integration tests running every migration unchanged apart from unsupported search indexes.
- Additional scheduler tests prove disabled schedules generate no mail while approved work drains, and scheduler failures still drain approved work and persist failure status.
- SQL tests cover queue/retry identity, exclusive claims, stale review rejection with rollback, early webhook recovery/no downgrade, suppression, terminal ambiguous delivery, defaults and digest dedupe, edited-row archives, repeated sheet create prevention, conflict-safe apply/undo, repeat-file reconciliation, reviewed updates, append and stale concurrent edits.
- No tests contact production, Google, or Resend.

## Operational handoff and intentional limits

1. Apply migrations `0017_automation_reliability.sql` and `0019_csv_reconciliation.sql` with the other readiness migrations in numeric order. `0017` relies on the archival column from `0015`; `0019` relies on the fingerprint column/index from `0018`.
2. Configure and verify the authenticated `/api/cron/automations` schedule every five minutes and existing weekly sheet schedule. Hosting plan support must be confirmed. Until cron is working, Communications has a manual bounded processing button; large campaigns remain visibly queued.
3. Confirm production sender/domain, reply-to, Resend credentials, webhook secret/events, Google service-account access, app URL and the wedding timezone. Production status was not inferred from old handoff notes.
4. Keep schedules disabled until Juliet reviews recipient, timing and message previews in Communications. Turning off a schedule suppresses its pending generated messages; it does not cancel manually approved campaigns or confirmations.
5. CSV append intentionally preserves existing RSVP/meal answers and curated invitation choices. It does not silently treat a master-sheet reimport as permission to overwrite live guest replies. A deliberate RSVP correction uses the household editor. Increasing plus-one capacity requires the invitation editor before appending a plus-one beyond existing slots.
6. Free-text opt-out ambiguity and shared-email identity remain human decisions. A name or approximate similarity never authorizes an automatic contact merge.
7. The worker reports provider acceptance separately from webhook delivery. A failed or uncertain message requires reconciliation/retry through the named issue; provider acceptance cannot prove inbox placement.
