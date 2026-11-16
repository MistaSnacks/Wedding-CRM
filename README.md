# Guest CRM & RSVP

Wedding guest management and RSVP in English, Spanish, and Vietnamese. Next.js App Router, Supabase/Postgres, Resend, and Vitest. Current work targets Juliet's single wedding; multi-wedding selection and comprehensive tenant isolation are a separate release.

## Local setup

1. Run `npm ci` with Node 22.
2. Copy `.env.example` to `.env.local` and fill in the required values.
3. Use an isolated Supabase development project. Apply **all** numbered migrations in `supabase/migrations` in order using the Supabase CLI. Migration `0002_seed.sql` supplies development fixtures; inspect seed-bearing migrations before pointing a fresh setup at real data. Do not reseed Juliet's live database.
4. Create an Auth user and an owner membership for the development wedding. Additional administrators are invited from the team page. Login uses invited-only email OTP.
5. Run `npm run dev`, then open `http://localhost:3006/admin` or `/rsvp`.

## Behavior

- Guest entry intentionally supports direct name/email lookup and household links. It is not verified-email authentication. Household links act as guest credentials. Guest responses receive a restricted DTO; administrative notes are excluded.
- RSVP, event invites, membership changes, household creation, seating groups, and import reconciliation have transactional database operations. SQL definitions are part of the application release.
- Imports support worksheet selection, validation, explicit duplicate reconciliation, reusable column mappings, and opt-in browser-tab drafts. Matching updates preserve RSVP state. Retrying the same committed input does not create it twice.
- Reports select an event for attendance, meals, dietary requirements and seating. Vendor/budget reports exclude benchmark reference data by default.
- Needs attention links to missing replies, contacts, meals, seats, upcoming payments, failed messages, and sync review. Vendor tasks, private documents, payment calendars, and headcount cost proposals are available in Admin.
- Email uses a durable database outbox with bounded claims/retries, suppression and verified webhook processing. Production refuses file-based email fallback. New scheduled reminders, digests, and payment notices are **off by default** and configured from Communications.
- Production rate limits use atomic Redis if configured, otherwise PostgreSQL. Backend failures fail closed. Process-local data caching is bypassed in production to preserve cross-instance freshness.

## Verification

- `npm test`: library, regression, and isolated PostgreSQL integration tests.
- `npm run test:db`: execute real migration/transaction tests in PGlite. No live DB is touched. The harness omits pg_trgm and trigram indexes unsupported by its WASM build; verify these on Supabase before release.
- `npm run build`: TypeScript and production route compilation.
- `npm run check`: tests and build.
- CI performs those checks and a production dependency audit. Branch protection must be configured in GitHub if these checks should block merges.

## Release and operations

Use [the current handoff](docs/HANDOFF.md) for migration order, production checks and Juliet's acceptance walkthrough. The September audit is historical baseline evidence, not a statement that its defects remain unchanged. Production deployment, migration application, credentials, actual mail delivery and browser acceptance must be verified for each release.

`vercel.json` schedules the Sheet sync weekly and outbox/automation processing every five minutes. Both endpoints require `CRON_SECRET`. The selected hosting plan or external authenticated scheduler must support the configured cadence. Cron processing of already-approved messages remains active while optional automatic campaigns are disabled. Set the production app URL, verified sender/reply-to, webhook secret and Google credentials as appropriate; never put server secrets in `NEXT_PUBLIC_*` values.
