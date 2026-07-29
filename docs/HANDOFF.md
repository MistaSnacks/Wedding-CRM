# Guest CRM — Delivery Handoff

_Last updated: 2026-07-28 (deployed to production; Save-the-Date sync + "what's new" note shipped)._

## Deployed 2026-07-28

Live at **https://rsvp.julietandjuan.com**. Everything below through the Save-the-Date sync
is in production. Juliet (`julietle24@gmail.com`) already has `owner` access and last signed
in on 2026-07-11, so she can log straight in.

- **"What's new" note** — a one-time, dismissible summary of what changed since someone last
  signed in (`lib/changelog.ts` holds the entries, newest first; add to the top and never
  reuse an `id`). Read state lives in `activity_log` under `changelog.seen`, so it is
  per-account rather than per-browser and is filtered out of the couple's activity feed.
- **`CRON_SECRET`** is set in Vercel Production. The weekly cron endpoint verified live:
  401 without the secret, and with it returns a plain "not connected to Google yet" message
  rather than failing.

**Two things to know before the next session:**

1. **The Supabase CLI switched accounts mid-session** — `supabase projects list` started
   returning a different organisation with `guest-crm` absent, and `db push` began failing
   with `unexpected login role status 403`. Check `supabase projects list | grep guest-crm`
   before attempting any migration, and re-run `supabase login` if it's missing. (The
   changelog feature was deliberately built without a migration for this reason.)
2. **The wedding timezone is unresolved** — the record says `America/Los_Angeles` while the
   venue and emails say Guadalajara. Every displayed event time may be an hour off. Left
   untouched pending confirmation from Juliet.

## What shipped 2026-07-28 — Save-the-Date sync

Spec `docs/superpowers/specs/2026-07-26-save-the-date-sync-design.md`, plan
`docs/superpowers/plans/2026-07-27-save-the-date-sync.md` (which records three amendments
learned from running the one-off merge).

- **`sheet_submissions`** (migration `0010`) — one row per sheet response, unique on a
  content hash (`row_key`), RLS matching every other tenant table. Verified with the anon
  key: rows are invisible and writes are rejected (`42501`).
- **`lib/sync/match.ts`** — pure matcher. **Only an exact email match auto-applies**; a name
  match at any score, including 1.0, goes to review. It also never offers a candidate it
  can't explain in words, because an unexplainable suggestion beside a one-click apply is
  how a stranger's address ends up on a household.
- **`lib/sync/apply.ts`** — source precedence `admin > save_the_date > csv`, so a guest's
  own address replaces spreadsheet junk but never a hand edit, and never another guest's
  answer. Every write records its prior value for undo.
- **`lib/sync/run.ts`** — reconciles the whole sheet each run (not a delta), so a skipped
  cron week self-heals and a double-fire is a no-op. Zero rows read after previously reading
  many is treated as an outage, not as "no new responses". Has a dry-run mode.
- **Review inbox** on `/admin/imports` — four actions, one decision at a time, no bulk
  approve, each suggestion shown with its reasoning; applied items are reversible. Undo
  keeps `resolved_at` set so the weekly job cannot re-apply a decision a human reversed.
- **Weekly cron** — `vercel.json`, Mondays 15:00 UTC, `CRON_SECRET`-guarded.

Verified against the real 72-response export: 73 rows read, 67 auto-matched on email
identity **writing zero fields** (the one-off had already applied the same data — the two
systems agree exactly), 6 left for review, and a second run inserted and applied nothing.

### Still needed to run live: a Google service account

The sync cannot read the sheet until these exist in Vercel env (Production):

| Variable | Where it comes from |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the service account's address, `…@….iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | `private_key` from its JSON key (paste whole, `\n` escapes are handled) |
| `SAVE_THE_DATE_SHEET_ID` | `1UC5eOijap5kTmpN5hiMi7vgwoABe6sJuATEw0q-5UNU` |
| `SAVE_THE_DATE_RANGE` | optional; defaults to `Save My Spot!A:Z` |
| `CRON_SECRET` | any long random string |

Setup: in Google Cloud Console create (or reuse) a project → enable the **Google Sheets
API** → **Create service account** → **Keys → Add key → JSON** → then share the
Save-the-Date sheet with that service-account address as **Viewer**. Read-only by design;
the app never writes to the sheet.

Until then the inbox says it isn't connected, and existing responses can still be reviewed.
`importSheetCsv()` in `imports/review-actions.ts` accepts a CSV export as a manual fallback.

## What shipped 2026-07-26 — admin usability blockers

Spec: `docs/superpowers/specs/2026-07-26-admin-usability-blockers-design.md`. Four items from a browser-driven ease-of-use audit:

- **Safe sends.** `/admin/comms` composes → **Review campaign** (recipient count, skipped-no-email names, rendered per-locale preview) → confirm send. A stale review refuses to send (`review_token` guard). **Send a test to me** emails only the signed-in admin, `[Test]`-prefixed, never in History.
- **Mailing addresses** visible and editable on the household page — free-text, stored verbatim as `{raw, source:"admin"}`, provenance shown ("from the Save-the-Date form" / "from your spreadsheet import" / "edited by you"). Never parsed.
- **One search.** `lib/search/guest-query.ts` (diacritic-insensitive, tested) powers both the header search (real input now, live dropdown, was a `Link` styled as an input) and the Guests page (filters as you type; Search button removed).
- **Mobile admin** below 768px: drawer nav, card-based guest list, stacked household editor, responsive overview/comms; Seating is view+assign on phones (tap table → bottom sheet; arranging stays desktop). Guest RSVP flow was already fluid and is untouched.

Also: the Save-the-Date one-off merge ran (see `scripts/std-check.mjs` / `std-apply.mjs`), and metric cards no longer hide until hydration.

This doc is the single source of truth for handing the project off — to the client, or to a future working session. If you're an agent picking this up: read this file, then `docs/seating-roadmap.md` for deferred work.

## Live environment

- **Production app:** https://guest-crm-camrens-projects-24b42280.vercel.app
- **Guest RSVP entry:** `/rsvp` (code entry) and `/rsvp/h/[token]` (direct household links)
- **Admin dashboard:** `/admin` (magic-link login at `/admin/login`)
- **Hosting:** Vercel project `guest-crm` (team `camrens-projects-24b42280`), deployed with `vercel --prod --scope camrens-projects-24b42280`. There **is** a git remote: `origin` → `github.com/MistaSnacks/Wedding-CRM` (this doc previously said there wasn't).
- **Database/auth:** Supabase, project ref `lagjcyaquqbddmnmzvcm` (matches `NEXT_PUBLIC_SUPABASE_URL`). Corrected 2026-07-24:
  - The **CLI is linked to the correct project** and is authenticated — `supabase migration list` and `supabase db push` both work. This doc previously said it pointed at the wrong project; that is no longer true.
  - The **MCP server is unauthorized** (every call returns `Unauthorized. Please provide a valid access token`). Don't route this repo's work through it.
  - `db push` **refuses to re-apply an already-recorded migration** — a fix to applied SQL must go in a new numbered file.
  - Always use `create or replace function`, never `drop` + `create`: replace preserves privileges, whereas a drop-and-recreate silently restores Supabase's default `EXECUTE` grant to `anon` (see the security note below).
  - For data rather than DDL, use the service-role key in `.env.local` (patterns in `scripts/`).

## Giving the client access

```
node scripts/invite-admin.mjs juliet@example.com --role editor --link
```

Sends a Supabase invite email (custom template in `supabase/templates/invite.html`) and inserts their `wedding_members` row. `--link` also prints a direct sign-in URL (~1 hour validity) you can text them if email delivery is slow.

The admin auth callback accepts both PKCE (`?code=`) and `token_hash` links, so admin-generated links work without the email round-trip.

## What shipped in this delivery

- **Admin UX overhaul:** new sidebar (`AdminSidebar`), add-guest form, confirm-before-destructive-action button (replaces the old `Button`), dashboard layout rework.
- **Seating canvas:** major interaction improvements (~285 lines changed).
- **Guest RSVP flow:** reworked flow; plus-one saves are idempotent (autosave no longer consumes a second slot); friendly localized error messages (en/es/vi).
- **Invitation rules:** `openPlusOneSlots()` (UI never offers a slot the server would reject) and `normalizeHouseholdRules()` (party-size cap always fits named guests + granted plus-ones). Covered by tests.
- **Prod auth fixes:** Supabase `site_url` + redirect allow-list point at the production URL; no cookie writes during server-component render.
- **Ops scripts:** `scripts/invite-admin.mjs` (client access), `scripts/dev-login.mjs` (local login without email).

Verified at delivery: 42/42 tests pass, clean production build.

## What shipped 2026-07-24 — tenant-agnostic CSV importer

The `/admin/imports` wizard was a names-only importer. It now ingests a real guest list, driven entirely by column mapping so any wedding can use it — no client's spreadsheet vocabulary is hardcoded, and `lib/csv/generality.test.ts` fails the build if anyone adds some.

- **Households are envelopes, not surnames.** Grouping keys on `(Household, Envelope Name)`. A coarse family-cluster column is not a mailing unit — one real value spanned 13 people across 7 invitations, which under the old grouping would have shared a single RSVP link and party-size cap.
- **New mappings:** envelope, tags (with optional per-column prefixes), plus-one marker, structured + free-text mailing address, meal, dietary, notes, and one RSVP column per event including a not-invited state.
- **Blank-name rows become plus-one slots** instead of being silently dropped.
- **Transactional commit.** `commitHouseholds` now calls the `import_households` RPC, so a failure at household 90 of 140 rolls back completely instead of leaving a half-imported list with live invite codes.
- **Explicit dry run** persisted as an `imports` row, gating the commit button; changing any mapping invalidates it.
- **Free-text addresses are stored verbatim, never parsed** — international addresses defeat any parser and a wrong parse silently corrupts a mailing label.

Verified: 95/95 tests, clean `tsc` and production build.

### Security — two `security definer` RPCs were exposed to `anon`

Supabase grants `EXECUTE` on new `public`-schema functions to `anon` and `authenticated` by default, and the anon key ships to every browser. Both of these were confirmed exploitable before being fixed:

- `import_households` — could inject households, guests, invite codes and access tokens into **any** tenant. Revoked in migration `0004`.
- `submit_rsvp` (pre-existing, from `0001`) — keyed on `p_household_id`, bypassing the "the access token is the credential" model. Revoked in migration `0005`.

**Any new `security definer` function needs `revoke execute … from public, anon, authenticated`.** Revoking only `public` is not enough — the default privileges create explicit per-role grants. Do **not** revoke `is_wedding_member` / `is_wedding_editor`; RLS policies evaluate those as the calling role. To check a function, call it with the anon key: `42501` means revoked, a function-level error means still exposed.

## Pending — do NOT forget

1. **Run the master guest import.** The importer is built and tested but the real import has not been run — it needs a CSV export of the MASTER WEDDING LIST *Guest List* tab (sheet owned by julietle24@gmail.com). Full mapping instructions are in Task 13 of `docs/superpowers/plans/2026-07-24-tenant-agnostic-csv-importer.md`, including the expected dry-run sanity checks. That task also adds the Rehearsal Dinner event, which must be migration `0007` now that `0006` is taken.
2. **Save-the-Date weekly sync not built.** Design is approved in `docs/superpowers/specs/2026-07-24-guest-data-migration-design.md` (Google service account + Sheets API, Vercel Cron, a `sheet_submissions` table, a fuzzy matcher, and an admin review inbox for ambiguous matches). This is Plan B and has no implementation plan yet. Note the two sheets share no identifier and names do not match (`Alison Aw` → `Alison Aw-Irwin`, `Amadeo Guiao` → `Amadeo Cruz`), so the join needs human review by design.
3. ~~**Invite email template not yet live.**~~ **DONE** — confirmed 2026-07-28: `supabase config push` reports Remote Auth config up to date, so the branded templates are live. Original note: `supabase/config.toml` + `supabase/templates/invite.html` still need `supabase config push`. The blocker recorded here previously — "the CLI is linked to the wrong Supabase project" — **no longer applies**; the CLI is correctly linked, so this should just work. Until pushed, invites use the default Supabase template.
4. **Event management UI.** The schema supports arbitrary events with per-household invite lists, and the importer can now populate them, but there is no admin UI to create/edit/delete events. Spec'd as the follow-up to the migration design.
5. **Seating roadmap deferred** until this client is live — spec in `docs/seating-roadmap.md`.

## Local development

```
npm run dev          # Next.js on port 3006
npm run dev:login    # print a direct admin sign-in URL (bypasses email)
npm test             # vitest
```

Heads-up: this repo's Next.js version has breaking changes vs. public docs — read `node_modules/next/dist/docs/` before writing code (see `AGENTS.md`).
