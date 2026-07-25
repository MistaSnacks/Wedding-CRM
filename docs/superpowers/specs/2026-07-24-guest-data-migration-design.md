# Guest data migration — design

- **Date:** 2026-07-24
- **Status:** Approved (design); pending implementation plan
- **Scope:** Extending the in-app CSV importer into a general-purpose ingestion feature, then using it for the one-shot master guest import + recurring Save-the-Date enrichment sync + admin review inbox
- **Out of scope:** Event management UI (own spec, immediately after this one); seating (`docs/seating-roadmap.md`); the multi-tenant guest entry work (`2026-07-23-multi-tenant-guest-entry-design.md`)

## Background

The Juliet & Juan wedding data lives in two Google Sheets that serve different purposes.

**MASTER WEDDING LIST** — file id `1M_B0aCWzn1OIO5vmfdWBLDaL5NZgWCy9GsNYt-RNgBI`, owned by `julietle24@gmail.com`, shared with `cmcmath89@gmail.com`. 252 guest rows across 116 `Household` values. Tabs: Guest List, Dashboard (rollup formulas), Lists (dropdown options), How to use, Save the Date message.

Guest List columns:

```
Household | List | Envelope Name | First Name | Last Name | Email | Phone |
Street Address | City | State | Zip | Country | Wedding RSVP |
Rehearsal Dinner RSVP | Meal Choice | Dietary Restrictions |
Save the Date sent | Physical Invitations Mailed | RSVP Received Date |
Household Size | Table Number | Notes
```

Critically, **Email, Phone, and the address columns are essentially empty** — 2 of ~110 inspected rows carried anything. The master knows *who* is invited and *how they group*; it does not know how to reach them.

**J&J Save the Date ~ Mailing Form** — file id `1UC5eOijap5kTmpN5hiMi7vgwoABe6sJuATEw0q-5UNU`, owned by `cmcmath89@gmail.com`. A live Google Form response sheet, ~72 rows as of 2026-07-24, still receiving submissions. Columns:

```
Received At | First Name | Last Name | Mailing Address | Email | Phone |
Notes | No Mailing Address | Language
```

This is exactly the contact data the master lacks. The two sheets share no identifier, and names do not match reliably.

This supersedes the older "wait for ~200 more responses before importing" plan. With a recurring sync, the master can be imported and the app taken live now; late Save-the-Date responses flow in on their own.

## Decisions

1. **The app becomes the source of truth after import.** The master imports once as a snapshot. Juliet then works in `/admin`; she can use the existing CSV import for any further ad-hoc additions. No write-back to Google Sheets, no conflict resolution on master fields.
2. **Save-the-Date is enrichment only, and fills blanks only.** It may populate an empty `mailing_address`, `email`, `phone`, or `preferred_locale`. It never overwrites a value an admin has set.
3. **A household is an envelope, not a surname.** Grouping key is `(Household, Envelope Name)`, not `Household`.
4. **Ambiguous matches go to a human.** Confident matches auto-apply; everything else lands in an admin review inbox whose decisions persist.
5. **Google service account + Sheets API** for recurring reads, on a weekly Vercel Cron.
6. **Rehearsal Dinner** is added as a third event via DB migration. Event CRUD UI is a separate spec.
7. **The importer is a product feature, not a migration script.** Every couple on the multi-tenant platform will onboard through it. Nothing may be hardcoded to this wedding's column names or cell values.

## Design principle: the importer must stay tenant-agnostic

The Juliet & Juan sheet is a *test case*, not a schema. Every gap below is closed with a general mechanism driven by the wizard's column mapping, never by a literal from this sheet.

| Tempting shortcut | Required instead |
|---|---|
| Detect plus-ones by `List == "Plus One"` | An optional **Plus-one** column mapping; any truthy/`plus one`-ish value marks the row |
| Detect infants by `List == "Baby"` | The existing **Age type** mapping plus `normalizeAge`, which already resolves `baby` → `infant` |
| Hardcode `Envelope Name` as the grouping column | An optional second grouping mapping labelled **Envelope / invitation name**, with documented fallback order |
| Hardcode `Wedding RSVP` → Ceremony + Reception | Per-event column mappings the user assigns to their own events |
| Hardcode meal names | Case-insensitive match against that wedding's own `meal_options`, unmatched values warned |
| Special-case `Le 1 Household` | Nothing wedding-specific reaches the code; this sheet's quirks live only in tests as fixtures |

A column may feed more than one mapping — this sheet's `List` drives age type, plus-one detection, *and* tags simultaneously. Mappings are independent by design.

## Architecture

Three units with clean boundaries, each independently testable:

| Unit | Responsibility | Depends on |
|---|---|---|
| **Master importer** | Sheet rows → households/guests/invites/responses, once | `lib/data/imports.ts`, `lib/csv.ts` |
| **Save-the-Date sync** | Fetch sheet → record submissions → match → auto-apply or queue | Sheets API, matcher |
| **Review inbox** | Resolve queued submissions to a household | `sheet_submissions` |

The matcher is a pure function (submission + candidate households → scored candidates) so it can be tested against the known-hard name pairs without touching a database or a network.

### Data flow

```
MASTER SHEET ──(one-shot, dry-run → commit)──► households + guests + invites + responses
                                                        ▲
                                                        │ fill blanks only
SAVE-THE-DATE SHEET ──(weekly cron)──► sheet_submissions │
                                              │         │
                                    ┌─────────┴─────────┴──┐
                                    │  matcher (pure fn)   │
                                    └─────────┬────────────┘
                              confident ──────┤────── ambiguous
                                   auto-apply │        review inbox
                                              │             │
                                              └─────────────┘
```

## Part 1 — Extending the importer

### What exists today

`/admin/imports` already ships a working wizard (`components/admin/ImportWizard.tsx`): file picker → `parseCsv` → `detectMapping` auto-detection → editable per-field column dropdowns → dry-run preview (household/guest counts, errors, warnings, preview table) → **Commit import** via the `commitCsvImport` server action, which re-validates server-side before writing. 42/42 tests pass.

The shell is sound and is kept: file handling, the mapping UI, the preview table, and the commit action all stay. The gaps are in `lib/csv.ts` `validateCsv` and `lib/data/imports.ts` `commitHouseholds`.

### The eight gaps

Verified against the current code on 2026-07-24. None of these can be worked around by column mapping alone; each needs code.

| # | Gap | Consequence today | Fix |
|---|---|---|---|
| 1 | `validateCsv` groups by the household column only | 13 Le relatives collapse into one household sharing one RSVP link | Optional second grouping mapping (envelope), composite key with fallback |
| 2 | Blank-name rows are discarded — `"Empty name — row skipped."` | Every plus-one placeholder is silently lost (Cruz, Lauren, Mala, Minor, Gonzales, Stephan Nguyen) | Blank-name row inside a group becomes `plus_one_slots += 1` |
| 3 | No tag support in `CsvMapping`, `ImportHouseholdInput`, or the `households` insert | `List` and the family cluster cannot be imported | Multi-column tag mapping → `households.tags` |
| 4 | The `guests` insert never sets `origin` | Named plus-ones import as regular named guests | Optional plus-one column mapping → `origin = 'plus_one'` |
| 5 | No address fields anywhere in the import path | Blocks the whole Save-the-Date enrichment path | Structured address mappings plus a single free-text fallback → `mailing_address` jsonb |
| 6 | No meal, dietary, or notes mapping | Meal Choice, Dietary Restrictions and Notes are dropped | Add mappings; meals resolve case-insensitively against that wedding's `meal_options` |
| 7 | `commitHouseholds` invites **every** household to **every** event unconditionally | Rehearsal Dinner "Not Invited" cannot be honored | Per-event column mapping with a not-invited value → omit the `household_event_invites` row |
| 8 | Per-household insert loop, no transaction | A failure at household 90 of 140 leaves partial data; the run is marked `failed` but nothing rolls back | Commit through a single transactional RPC |

### Two spec corrections

- The `imports` table's `validated` status is declared in `finishRun`'s type but **never used** — `createRun` only fires at commit time, so no dry-run record is ever persisted. Persisting the dry run is new work, not reuse.
- The dry-run preview is currently client-side only. Server-side re-validation happens at commit, which is correct for safety, but means the preview and the commit can in principle disagree. They must be driven by the same pure function.

### Grouping

Group rows by `(trim(lower(Household)), trim(lower(Envelope Name)))`. Where `Envelope Name` is blank, the key falls back to `Household` alone.

Normalization is required, not cosmetic: the sheet contains `"Juliet Family "` alongside `"Juliet Family"` and `"Jauregui Household 4 "` alongside `"Jauregui Household 4"`. Untrimmed keys produce spurious duplicate households.

`display_name` = `Envelope Name` when present, else the `Household` value.

**Why envelope, not household.** The `Household` column is a family-cluster label ("Juliet's Le relatives"), not a residence. `Le 1 Household` contains 13 people across 7 envelopes; `Boyd Household` contains Lacee Boyd plus the unrelated Mary & Salvador Chavez. In this schema a household owns one `invite_code`, one `access_token`, and one `max_party_size` — that is an envelope. Grouping on `Household` would give 13 Le relatives a single shared RSVP link, letting whoever opens it first RSVP for the rest and consume the party-size cap.

Worked example — `Le 1 Household`:

| Envelope Name | Rows | Result |
|---|---|---|
| Lanchi Le | Lanchi Le | 1 guest, max 1 |
| Di Lien Le & Dượng Hung Nguyen | Lien Le, Hung Nguyen | 2 guests, max 2 |
| Di Hoa Le & Mark Manchester | Mary Le, Mark Manchester | 2 guests, max 2 |
| Di Huyen Le | Maryanne Le | 1 guest, max 1 |
| Susan, Annabelle, Zion & Dustin | Susan Le, Annabelle Le, Dustin T | 3 guests, max 3 |
| Natalia Manchester & Ron Mancheser | Ron Manchester, Natalia Manchester | 2 guests, max 2 |
| Stephan Nguyen & | Stephan Nguyen, *(blank row)* | 1 guest + 1 slot, max 2 |

Expected total household count rises from 116 to roughly 140.

Vietnamese kinship titles appear inside envelope names (`Di`, `Dượng`, `Bac`, `Cậu` — aunt/uncle honorifics). These are display text only. The matcher must not treat them as given names.

### Row → record mapping

| Sheet column | Destination | Rule |
|---|---|---|
| `First Name`, `Last Name` | `guests.first_name` / `last_name` | Trimmed |
| `List = "Baby"` | `guests.age_type` | `'infant'` |
| `List = "Plus One"` + name present | `guests.origin` | `'plus_one'`; does **not** also consume a slot |
| **any blank-name row** | `households.plus_one_slots += 1` | No guest record. Independent of `List` value — see below |
| `List` (all values) | `households.tags` | e.g. `A List - Juliet`, `Juan Family` |
| `Household` | `households.tags` | Verbatim trimmed value prefixed with `family:` — `Le 1 Household` → `family:Le 1 Household`. Preserves the family cluster for filtering and later seating |
| `Email`, `Phone` | `households.email` / `phone` | Rarely populated |
| `Street/City/State/Zip/Country` | `households.mailing_address` | jsonb, structured fields |
| `Wedding RSVP` | `guest_event_responses.attending` on Ceremony **and** Reception | `Pending→pending`, `Attending→yes`, `Declined→no` |
| `Rehearsal Dinner RSVP = "Not Invited"` | *(absence of)* `household_event_invites` row | Otherwise invite + response row |
| `Meal Choice` | `guest_event_responses.meal_option_id` | `Child Meal → Kids Meal`; new `No Meal Needed` option required |
| `Dietary Restrictions` | `guests.dietary_restrictions` | `"None"` → null |
| `Notes` | `households.internal_notes` | |
| `Save the Date sent` | `households.tags` | Adds `std-sent` when the cell is non-empty and not a note. Values are inconsistent — `sent`, `Sent`, and free text like `Info requested from mom` all appear — so match case-insensitively on `sent`; anything else is appended to `internal_notes` instead |
| `Physical Invitations Mailed` | `households.tags` | Adds `invitation-mailed` under the same case-insensitive rule. Empty throughout the sheet today |
| `Household Size` | — | Ignored; computed |
| `Table Number` | — | Ignored (seating deferred; column empty) |

`max_party_size` = named guests + `plus_one_slots`.

`invite_code` and `access_token` are generated per household by the existing `lib/data/imports.ts` helpers.

### The blank-name rule

Any row with no `First Name` and no `Last Name` becomes a plus-one slot on its envelope's household, **regardless of its `List` value**.

The narrower rule ("blank name *and* `List = "Plus One"`") is wrong. `Le 1 Household / Stephan Nguyen &` has a blank row whose `List` is `Juliet Family`; under the narrow rule Stephan's partner is silently dropped and the household is capped at 1. An envelope name ending in `&` or containing `& Guest Name` corroborates the expected companion but is not required to trigger the rule.

### Under-populated envelope warning

If an envelope name references more people than the group has rows, the dry-run report emits a warning. `Susan, Annabelle, Zion & Dustin` has rows for Susan, Annabelle and Dustin but **none for Zion** — he would otherwise be imported silently missing. Heuristic: count `&`/`,`-separated name tokens in the envelope, compare against row count, warn on shortfall. A warning, never a hard failure — envelope names are free text and false positives are expected.

### Safety

The import runs dry-run first. The `imports` table already declares a `validated → committed` status flow but never exercises `validated`; persisting the dry-run record is new work (gap correction above). The dry-run report shows per-household guest counts, slot counts, tag assignments, warnings, and errors before anything is written. Committing is a separate explicit action and runs inside a single transaction, so a mid-import failure leaves no partial data. Re-committing an already-committed run is blocked. All writes are recorded through `activity.log`.

Preview and commit are driven by the same pure `validateCsv` so they cannot disagree.

## Part 2 — Weekly Save-the-Date sync

### Access

A Google Cloud service account with read-only Sheets API scope. The Save-the-Date sheet is shared to the service account's address as Viewer. The key is stored in Vercel env vars, never in git and never under a `NEXT_PUBLIC_` prefix.

The publish-to-web CSV alternative was rejected: it produces an unauthenticated URL exposing ~72 people's home addresses, emails, and phone numbers, and remains live until explicitly unpublished.

Only the Save-the-Date sheet needs recurring access. The master is a one-shot and can arrive as a CSV export.

### Schedule

Vercel Cron, weekly, invoking `GET /api/cron/std-sync`. Cron runs in UTC and triggers the production URL. The endpoint requires a `CRON_SECRET` and rejects unauthenticated calls. Re-running within the same period is a no-op.

### Per-row processing

Each sheet row gets a stable `row_key`. Unseen rows are inserted into `sheet_submissions` with their raw payload. Previously resolved rows are skipped entirely — a resolved row never reappears.

The matcher scores each new submission against the wedding's households and guests:

- **Exact email match** against a household or guest → auto-apply.
- **Single name candidate above the confidence threshold** → auto-apply.
- **Zero candidates, multiple candidates, or a single low-confidence candidate** → review inbox.

### Auto-apply semantics

Fill blanks only. `mailing_address`, `email`, `phone`, `preferred_locale` are written only where the existing value is null or empty. `Notes` is **appended** to `internal_notes` with its `Received At` timestamp; existing notes are never replaced.

### Hard rules

- **Opt-out.** `Notes` containing `"opt out"` (case-insensitive) sets `households.rsvp_status = 'declined'` and suppresses the invite. `Ty Huynh` is a confirmed live instance — this resolves the earlier open question about whether opt-outs reach the sheet. They do.
- **Plus-one requests are never auto-granted.** Notes such as `"May I add a plus 1?"`, `"Plus 1: Vinhngan Nguyen"`, `"If plus ones are allowed Joe will come too"` are flagged for review. Party size is a cost decision and belongs to the couple.
- **Multi-person rows always go to review.** `"Julie & Joseph"`, `"Michael and Monica"`, `"Chelsea / Max"` are never auto-split.
- **Duplicate submissions.** Rows sharing a normalized email collapse to the latest `Received At`. The Djenohan pair (2026-07-17 10:04 and 11:26, same address and email) is the live case.
- **Blank rows** are skipped. A `#ERROR!` note value is dropped while the rest of the row is kept — `An Nguyen` has a valid name, email, and address behind one.
- **Language** maps to `preferred_locale` (`en` / `es`; blank → `en`).

### Addresses

Stored as `{ raw, street?, city?, state?, zip?, country?, source }` where `source` is `'master'` or `'std'`.

Save-the-Date addresses are free text and are **not** parsed. The sheet contains `114-0024 Japan Tokyo Kita-ku, Nishigahara 1-46-14`, `Av Belisario Domínguez 3500. Int. 0601 B, Guadalajara, Jalisco, México, C.P. 44300`, and `3 al atabka street Apartment 3 floor 1 Sidi Gaber Alexandria Egypt 21523`. No practical parser handles these correctly, and raw text is sufficient for mailing labels. Structured subfields are populated only when they come from the master's already-split columns.

## Part 3 — Review inbox

A new tab on the existing `/admin/imports` page.

Each unresolved submission displays its raw row alongside the top three candidate households with match scores. Three actions:

- **Match to household** — applies the enrichment under fill-blanks-only rules.
- **Create new household** — the submitter is not on the master; creates a household and guest from the row.
- **Ignore** — dismisses without writing.

Every action sets `sheet_submissions.status` and records `resolved_by` / `resolved_at`, so the row never returns to the queue on a later sync.

## Schema changes

```sql
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
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (wedding_id, source, row_key)
);
```

Also required:

- A `Rehearsal Dinner` row in `events` for the Juliet & Juan wedding.
- A `No Meal Needed` row in `meal_options` (the master's dropdown offers it; the app's seed does not).
- RLS policies matching the existing per-wedding pattern used by the other domain tables.

## Environment variables

| Name | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account identity |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Private key (Vercel env var, not git) |
| `STD_SHEET_ID` | `1UC5eOijap5kTmpN5hiMi7vgwoABe6sJuATEw0q-5UNU` |
| `CRON_SECRET` | Authenticates the weekly cron call |

## Testing

**Importer generality** — guards the multi-tenant requirement
- A CSV with entirely different column names (`Party`, `Mail To`, `Guest`, `Category`) imports correctly through mapping alone, with no code change.
- A wedding whose meal options are `Steak / Salmon / Kids` resolves meals correctly; this sheet's `Chicken / Beef / Fish / Vegetarian / Vegan / Kids Meal / No Meal Needed` is just another fixture.
- No literal from the Juliet & Juan sheet appears outside test fixtures — asserted by a grep-style test over `lib/csv.ts` and `lib/data/imports.ts` for `Le 1`, `Envelope Name`, `A List`, `Plus One`, `Baby`, `Wedding RSVP`.
- Omitting every optional mapping still produces a valid import (names + auto-grouping only), preserving today's behaviour for existing users.
- One column mapped to age type, plus-one, and tags simultaneously feeds all three without interference.

**Importer gaps** — one per numbered gap
1. Two grouping columns produce envelope-level households; envelope column absent falls back to household column; both absent falls back to today's last-name+email heuristic.
2. A blank-name row increments `plus_one_slots` and creates no guest; it is no longer reported as a skipped-row warning.
3. Mapped tag columns land in `households.tags`, trimmed and deduplicated.
4. A plus-one-marked named row sets `origin = 'plus_one'` and does not also increment slots.
5. Structured address columns and a single free-text address column both populate `mailing_address`; `source` is recorded.
6. Meal names resolve case-insensitively against the wedding's own options; an unrecognised meal warns and leaves `meal_option_id` null rather than failing the row.
7. A row marked not-invited for an event produces no `household_event_invites` row for it, and no response row.
8. A commit that fails partway writes nothing — assert household count is unchanged after an induced mid-import error.

**Dry run**
- The dry run persists an `imports` row with status `validated` and writes no domain data.
- Preview counts equal post-commit counts for the same input.

**Grouping**
- `Le 1 Household` produces 7 households; `Boyd Household` produces 2, with the Chavezes in their own envelope.
- Trailing-whitespace variants (`"Juliet Family "`) do not create duplicate households.
- Blank `Envelope Name` falls back to the `Household` value.

**Plus-ones and guests**
- Blank-name row → slot, including the `Stephan Nguyen &` row whose `List` is `Juliet Family`.
- Named plus-one (`Chance Crisler`, `Dustin T`) → guest with `origin = 'plus_one'`, no extra slot consumed.
- `List = "Baby"` (`Millie Irwin`) → `age_type = 'infant'`.
- `max_party_size` always equals named guests + slots.

**Warnings**
- `Susan, Annabelle, Zion & Dustin` (3 rows, 4 names) emits an under-populated warning and still imports.

**Matcher** — the cases that matter
- `Alison Aw` → `Alison Aw-Irwin` reaches review, does not auto-apply.
- `CECILIA GARZA` → `Cecilia Garza-Cohoon` reaches review.
- `Amadeo Guiao` **must not** auto-match `Amadeo Cruz`.
- `Blanca Viridiana Jauregui del Muro` → `Viridiana Del Muro` reaches review.
- An exact email match auto-applies.
- `Julie & Joseph`, `Michael and Monica`, `Chelsea / Max` always reach review.

**Fill-blanks-only**
- A matched submission writes address and phone but leaves an admin-edited email untouched.
- Notes append; prior `internal_notes` content survives.

**Review inbox**
- Match, Create new, and Ignore each persist, and the row does not reappear on the next sync.
- Matching applies the same fill-blanks-only rules as auto-apply.

**Hard rules**
- `Ty Huynh` → `rsvp_status = 'declined'`, no invite sent.
- The Djenohan double-submission resolves to one household.
- A `#ERROR!` note is dropped; the rest of `An Nguyen`'s row imports.
- Blank rows are skipped.

**Cron**
- Rejects calls without a valid `CRON_SECRET`.
- Two consecutive runs produce no duplicate submissions or duplicate writes.

**Import safety**
- Dry-run writes nothing.
- Committing an already-committed run is refused.

## Open items

- The master sheet is owned by Juliet. Implementation needs either a CSV export of the Guest List tab or the sheet shared to the service account.
- The confidence threshold for auto-applying a name match is set during implementation, calibrated against the matcher test cases above.
