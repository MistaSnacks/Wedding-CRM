# Save-the-Date Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Read the live Save-the-Date response sheet on a schedule, auto-apply only what is certain, and route everything else to a reversible human review inbox.

**Architecture:** Pure functions in `lib/sync/` (matcher, patch resolution, row keys) with vitest coverage; a `SheetReader` interface so the job is testable without network or credentials; a reconcile job that rewrites nothing it has already seen (`row_key` unique); a review inbox on `/admin/imports` writing through the service-role client.

**Tech Stack:** Next.js App Router, Supabase (service-role for the job, RLS for the UI), `jose` for the service-account JWT (already a dependency — do **not** add `googleapis`), vitest.

**Source spec:** `docs/superpowers/specs/2026-07-26-save-the-date-sync-design.md`.

## Amendments to the spec (learned by running the one-off merge on 2026-07-26)

These override the spec where they disagree. Each came from real data, not speculation.

1. **Source precedence replaces "fill blanks only."** Per the standing rule in
   `form-data-outranks-imports`: a `save_the_date` value MAY overwrite a `csv`-sourced value,
   MUST NOT overwrite an `admin`-sourced one, and MUST NOT overwrite another
   `save_the_date` value (form-vs-form conflicts are a human call — real case: Jauregui
   Household 2, two members submitted different Guadalajara addresses).
2. **Newly created households must be invited to every `visibility = 'all'` event.** The
   one-off missed this and three households were silently uninvited until caught by hand.
3. **Surnames change on marriage in ways no algorithm recovers.** Confirmed unrecoverable
   pairs: `Amadeo Guiao`→`Amadeo Cruz`, `Christine Dinh`→`Christine Le`. A matcher that
   "solves" these is overfitted and wrong. They must land in review, not auto-apply.
4. **Locale:** a blank `Language` column means `en`; only `es`/`vi` are meaningful overrides.

## Global Constraints

- Never parse addresses — store the submitted text verbatim as `{raw, source:"save_the_date"}`.
- Auto-apply **only** on exact normalized email identity. No name score, however high, auto-applies.
- Every applied change records prior values in `sheet_submissions.applied` so undo restores rather than guesses.
- Undo declines if the field changed since (do not clobber newer edits).
- A sync reading zero rows after previously reading many is an **error**, not "no new responses".
- No new `security definer` functions in this plan. If one is added later it needs
  `revoke execute … from public, anon, authenticated`.
- `npm test`, `npx tsc --noEmit`, `npm run build` green at every commit.

---

### Task 1: `sheet_submissions` table + data layer

**Files:** Create `supabase/migrations/0010_sheet_submissions.sql`, `lib/data/submissions.ts`

**Produces:** `SubmissionRow` type; `upsertMany(scope, rows)`, `listByStatus(scope, status)`, `markResolved(scope, id, patch)`, `byId(scope, id)`.

- [ ] Migration: table exactly as the spec's schema block, plus
      `create index sheet_submissions_wedding_status on sheet_submissions (wedding_id, status)`.
- [ ] RLS: `alter table sheet_submissions enable row level security` and the four policies
      matching `0001`'s loop — select via `is_wedding_member(wedding_id)`, insert/update/delete
      via `is_wedding_editor(wedding_id)`.
- [ ] Apply with `supabase db push` (the MCP is unauthenticated; CLI is the working path).
- [ ] Verify with `supabase migration list` and a service-role select.
- [ ] Commit.

### Task 2: the matcher (pure, tested)

**Files:** Create `lib/sync/match.ts`, `lib/sync/match.test.ts`

**Produces:** `normalizeName(s)`, `jaroWinkler(a,b)`, `scoreCandidates(submission, guests) → ScoredCandidate[]`,
`classify(candidates, submission) → {bucket: "auto_email" | "review" | "no_match", reasons: string[]}`.

- [ ] Port the scoring that was validated against all 72 real responses: given name by
      Jaro-Winkler, surname by token-set containment (so `Aw` scores 1.0 against `Aw-Irwin`),
      combined 50/50, with an ambiguity penalty when a second household scores within 0.08.
- [ ] Tests, all from the spec plus the amendments:
      `Alison Aw`→`Alison Aw-Irwin` scores high **and still reaches review**;
      `CECILIA GARZA`→`Cecilia Garza-Cohoon` likewise;
      **`Amadeo Guiao` must NOT auto-match `Amadeo Cruz`**;
      **`Christine Dinh` must NOT auto-match `Christine Le`**;
      `Blanca Viridiana Jauregui del Muro`→`Viridiana Del Muro` reaches review;
      exact normalized email auto-applies; a 1.0 name score does not;
      two close candidates both reach review with the penalty applied;
      Vietnamese (`Huyền`) and Spanish (`Muñoz`) normalize without mangling;
      multi-person rows (`Julie & Joseph`, `Chelsea / Max`) never auto-split.
- [ ] `reasons` must be human-readable — `"surname Aw is contained in Aw-Irwin"` — because the
      inbox shows them and that is what lets her trust or distrust a suggestion.
- [ ] Commit.

### Task 3: sheet reader

**Files:** Create `lib/sync/sheet.ts`, `lib/sync/sheet.test.ts`

**Produces:** `type SheetRow = Record<string,string>`; `type SheetReader = () => Promise<SheetRow[]>`;
`googleSheetReader(cfg)`, `csvReader(text)`, `rowKey(row)`.

- [ ] `rowKey` = sha256 of `timestamp|normalized email|normalized name`, hex. Stable across
      re-reads; a re-run is therefore a no-op and a cron double-fire changes nothing.
- [ ] `csvReader` parses with papaparse (already a dep) — used by tests and for a manual
      CSV fallback while Google credentials are pending.
- [ ] `googleSheetReader` mints a service-account JWT with `jose` (RS256, scope
      `https://www.googleapis.com/auth/spreadsheets.readonly`), exchanges it at
      `https://oauth2.googleapis.com/token`, then GETs
      `https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}`. Header row becomes keys.
- [ ] Failure modes surface as typed errors with plain-language messages, per the spec:
      sharing revoked, tab renamed, columns reordered, sheet moved.
- [ ] Tests: `rowKey` stability and sensitivity; csvReader header mapping; a reader returning
      zero rows raises rather than silently succeeding (guard lives in Task 5, assert the error type here).
- [ ] Commit.

### Task 4: apply + undo

**Files:** Create `lib/sync/apply.ts`, `lib/sync/apply.test.ts`

**Produces:** `resolveHouseholdPatch(household, submission) → {patch, applied}`;
`resolveUndo(household, applied) → {patch} | {declined: string}`.

- [ ] Precedence per amendment 1, evaluated per field (`email`, `phone`, `mailing_address`,
      `preferred_locale`): write when the field is empty or its stored `source` is `csv`;
      skip when `admin`; skip when `save_the_date` (form-vs-form → leave for a human).
- [ ] Notes append with the submission timestamp, never merge; an already-present line is not re-appended.
- [ ] `Opt Out` in notes sets `rsvp_status = 'declined'`.
- [ ] `applied` records `{field: {from, to}}` for every write.
- [ ] Undo: restore `from` for each field, but decline with a readable reason if the current
      value differs from `to` (someone edited it since).
- [ ] Tests: each precedence case; notes idempotency; opt-out; undo restores exactly; undo declines on drift.
- [ ] Commit.

### Task 5: reconcile job + cron

**Files:** Create `lib/sync/run.ts`, `app/api/cron/save-the-date/route.ts`, `vercel.json`; modify `lib/env.ts`

**Produces:** `runSync(scope, reader, opts) → SyncResult {read, inserted, autoApplied, pending, errors}`.

- [ ] Reconcile the **whole sheet** every run (not a delta) so a skipped week self-heals.
- [ ] Zero rows read when the table already holds rows for this wedding → throw; do not wipe or no-op silently.
- [ ] Upsert on `(wedding_id, source, row_key)`; existing rows are left untouched regardless of status.
- [ ] Auto-apply only exact-email identity matches, writing through Task 4 and logging
      `activity.log({actorType:"system", action:"sheet.auto_applied"})`.
- [ ] Route: `GET`, guarded by `CRON_SECRET` compared with `timingSafeEqual`; returns the `SyncResult` as JSON.
- [ ] `vercel.json`: `{"crons":[{"path":"/api/cron/save-the-date","schedule":"0 15 * * 1"}]}` (Mondays 15:00 UTC — cron runs UTC).
- [ ] Tests: two consecutive runs produce no duplicate submissions and no duplicate writes;
      zero-after-nonzero raises; a malformed row is skipped with its own pending entry rather than crashing the run.
- [ ] Commit.

### Task 6: review inbox

**Files:** Create `components/admin/ReviewInbox.tsx`, `app/admin/(dashboard)/imports/review-actions.ts`; modify `app/admin/(dashboard)/imports/page.tsx`

- [ ] Each item shows the submission as a person — name, email, address, notes, when it arrived —
      beside the top candidates with score **and** `reasons`.
- [ ] Four actions, one decision per submission, **no bulk approve in the ambiguous band**:
      Match to this household · Create a new household · Not a guest · Skip for now.
- [ ] **Create a new household must also insert `household_event_invites` for every event with
      `visibility = 'all'`** (amendment 2), and generate `invite_code`/`access_token` the same way
      `lib/data/imports.ts` does.
- [ ] Applied items appear in a reversible list: *"Added an address to The Smith Family from
      Sarah Smith's response · Undo."*
- [ ] Editor-gated (`requireEditor`); viewers see the inbox read-only.
- [ ] Keyboard: Tab moves between items, matching the import screen's proven flow.
- [ ] Verify by driving the browser at 1440px and 390px.
- [ ] Commit.

### Task 7: verification + credential handoff

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` green.
- [ ] Seed `sheet_submissions` from the real 72-row CSV via `csvReader` and confirm the buckets
      match what the one-off produced (41 exact-name / 21 strong / 10 review — noting that under
      the stricter auto-apply rule **all** of them reach review on the first sync, since the master
      had no emails; this is the spec's "the first sync is the expensive one").
- [ ] Write the Google service-account setup steps into `docs/HANDOFF.md` — the sync cannot read
      the live sheet until `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`,
      `SAVE_THE_DATE_SHEET_ID`, and `CRON_SECRET` exist in Vercel env.
