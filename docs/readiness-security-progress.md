# Security, RSVP and household readiness implementation

Updated 2026-09-04. Changes are local; no production database migration, deployment, email send, or live-data mutation was performed by this agent.

## Audit coverage

| Findings | Implemented behavior |
| --- | --- |
| F01 | Explicit guest DTO and database projection exclude internal notes, relationship/VIP, hotel and administrative metadata. Submit returns the same safe DTO. |
| F02 | Invite, role change and removal share a transactional SQL owner guard, lock the wedding and revalidate the actor. Sole-owner reinvite/demotion/removal is rejected. Auth directory reads paginate. |
| F03, F56 | Next proxy forwards refreshed auth cookies on both request and response. OTP disables account creation; invalid/expired callbacks return useful sign-in recovery. |
| F05–F09 | Per-person/per-event attendance and eligible meals; status derives from expected active invited guest/event combinations. Missing rows count as pending. Incomplete final submissions roll back. Admin corrections and guest/invite/event/menu changes recompute status transactionally. Disabled events do not require an answer or accept writes. |
| F10–F12 | Plus-ones use stable persisted IDs and client retry IDs, explicit rename/removal, household locking, cap validation, and canonical autosave hydration. Editing caps below existing guests is rejected with a useful error. |
| F13 | Closed RSVP shows a read-only summary, plus each person's current published table for each invited event. Publishing validates attendance/invites/capacity; guest tablemates are filtered against live eligibility. |
| F14 | Runtime guest payload schema strips server-only fields. SQL validates guest ownership, active invite, meal wedding/event/age applicability, and question type/scope/ownership. |
| F17, F18, F20, F55 (owned portions) | Household list/search paginates all results; canonical search includes guest-name matches regardless of household matches and uses no raw PostgREST interpolation. No-table checks use guest plus event. Guest context/detail and seating reads propagate errors. |
| F49, F50 | Household and guest creation use atomic, retry-safe SQL including invitations, response placeholders, cap normalization and audit log. Invitation deltas are atomic. |
| F52, F54 (guest/household forms) | Mutation forms preserve drafts on failure, show useful outcomes, disable pending actions, and label fields contextually. |
| F57 | Household archive replaces destructive deletion. Archive preserves linked history, blocks guest access, excludes active workflows, and has a normal restore list. |
| F58 | Locale precedence is explicit choice, household preference, then browser; only deliberate changes persist. Document language and declined/completed confirmation copy reflect the actual experience. |

## Additional completed capabilities

- Guest name, age, relationship, VIP, dietary, allergy, accessibility and private-note editing preserves guest identity and linked records.
- Household email, phone, primary contact, locale, tags, address and limits are editable.
- Reviewed move/merge/split transfers preserve guest response/seat records and guest-scoped answers. The destination inherits source invitations; the UI explains the effect. Empty source households are archived. Household-scoped answers/history stay with the original household.
- RSVP confirmation is inserted into the durable outbox in the RSVP transaction, using a canonical response-version dedupe key. Actual sending is owned by the automation worker.
- Invited-event calendar download uses private no-store responses and a token-scoped lookup, includes UTC times/location/dress details, escapes ICS text and folds UTF-8 lines correctly.
- Readiness surfaces duplicate household email/name review warnings, canonical status drift, incompatible party limits, zero-owner health, missing eligible meals, unresolved delivery failures, and failed/stale/missing automation. Shared names/emails are never automatically merged.
- Seating publication is atomic and rejects stale, ineligible or overcapacity assignments. Guest table lookup only returns current eligible attendees in the same wedding/event.

## Database and verification

`0015_security_rsvp.sql` owns security/RSVP/household transactions. Additional publish/read-table functions were appended to the root-owned `0018_readiness_operations.sql` by agreement. Confirmation outbox requires `0017_automation_reliability.sql`; deploy the complete migration sequence before updated application code.

The shared `lib/testing/database.ts` harness applies every repository SQL migration in an isolated in-memory PostgreSQL engine. It does not read environment variables or connect to a remote database. Only unavailable `pg_trgm` extension/search indexes are omitted; business functions, tables, policies and triggers run unchanged.

Meaningful automated coverage includes owner guards, active event completeness, incomplete-submit rollback, stable plus-one retries/rename/removal/caps, invalid menus, transactional creation/idempotency, atomic confirmation dedupe/privacy, split preservation/retry, archived guest denial, privileged RPC grants, cookie forwarding, calendar output, publish eligibility/capacity and live tablemate filtering. Immediately before the final health additions the full suite passed **835 tests across 54 files** and TypeScript passed; four added readiness tests also passed separately. The root agent owns the final aggregate test/build result.

## Remaining validation and deliberate limits

- Apply migrations to a disposable Supabase staging project and rehearse deployment/rollback before production. PGlite verifies SQL logic, not Supabase/PostgREST deployment parity or true simultaneous multi-connection scheduling.
- Complete browser/device and assistive-technology QA, including expired-token navigation, fresh Spanish/Vietnamese visits, multiple events, plus-one back/edit/remove/retry, final decline, closed RSVP, published seating, archive/restore and merge/split.
- Verify actual production SMTP/auth rate limits, scheduler credentials/cadence and durable email delivery with controlled staging recipients. No claim is made that live delivery or production configuration has been tested.
- Guest-scoped custom questions remain retired for the Juliet flow; current rendered questions are household-scoped. Reintroducing that feature requires a product decision and matching UI.
- Archive is recoverable, but explicit individual guest/plus-one removal and all historical edits do not have a general versioned undo facility. Move/split/merge preserves records but does not offer one-click transactional undo; household answers intentionally remain with their original household.
- No new multitenant onboarding, billing or tenant-switching product workflow was added; existing wedding scoping is preserved and checked by privileged operations.
