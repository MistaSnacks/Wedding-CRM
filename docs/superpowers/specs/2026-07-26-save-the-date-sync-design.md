# Save-the-Date sync — design

- **Date:** 2026-07-26
- **Status:** Approved to build
- **Revises:** the sync half of `2026-07-24-guest-data-migration-design.md`, which was written before the matching research below. Where they disagree, this document wins.
- **Scope:** Reading the live Save-the-Date response sheet on a schedule and merging contact details into existing households, with human review of anything uncertain.

## The situation

The master guest list is imported. It has names and household structure and **almost no contact data** — measured across 246 imported guests: 1 mailing address, 0 email addresses.

Meanwhile a Google Form is still collecting exactly what's missing — mailing address, email, phone, language, free-text notes — into a sheet owned by **Camren's** Google account (`1UC5eOij…`), separate from the master, which is owned by Juliet.

The two sources share no identifier and the names do not match:

| Save-the-Date | Master |
|---|---|
| `Alison Aw` | `Alison Aw-Irwin` |
| `CECILIA GARZA` | `Cecilia Garza-Cohoon` |
| `Blanca Viridiana Jauregui del Muro` | `Viridiana Del Muro` |
| `Amadeo Guiao` | `Amadeo Cruz` |

The last one is **not recoverable by any algorithm** — different surname, no shared token. It is a human fact, and the design must accept that rather than pretend a better matcher would find it.

## Evidence from the field

Full notes in `sheet-sync-research.md`.

- **Service account is correct for a third-party-owned sheet.** Per-user OAuth dies silently when the owner changes their password or revokes access; a published CSV makes 250 people's home addresses world-readable with no failure signal.
- **Vercel Cron delivery is best-effort** — it can skip an invocation or double-fire. Vercel's own guidance is to write reconciliation-based idempotent jobs, not retry logic.
- **Jaro-Winkler is the practitioner consensus for personal names**, but whole-string similarity fails the maiden/hyphenated case (`Aw` → `Aw-Irwin`). That needs token-containment scoring.
- **HubSpot and Google Contacts — the two most-copied dedupe UIs — both make merges effectively irreversible.** That is the anti-pattern to avoid, not the model to copy.
- **Bulk-approve is only ever offered for already-confident duplicate pairs, never for the ambiguous band.**

## The core risk

> A wrong match silently writes a stranger's address onto a household, and nobody notices for weeks.

Everything below is shaped by that. In a low-touch weekly workflow run by a bride, a bad merge has no natural discovery moment — it surfaces when an invitation arrives at the wrong house.

## Decisions

1. **Fill blanks only. Never overwrite.** A sync may populate an empty `mailing_address`, `email`, `phone` or `preferred_locale`. It never replaces a value already present. This bounds the worst case: a wrong match can add wrong data to an empty field, but can never destroy correct data.
2. **Every applied change is logged with provenance and is reversible.** Which submission, which row, when, what it wrote. Undo restores the previous value. The research's central finding is that the widely-copied dedupe UIs are irreversible; we are not copying that.
3. **Auto-apply only on identity, not similarity.** An exact normalized email match against a household or guest is identity and auto-applies. A name match — at any score — goes to review. This is stricter than the previous spec, which auto-applied confident name matches.
4. **No bulk-approve in the ambiguous band.** One decision per submission. Bulk actions are the exact mechanism behind the reported case of a competitor silently wiping RSVPs.
5. **Notes are appended, never merged.** Free-text notes carry plus-one requests and opt-outs; they accumulate with their timestamp.
6. **Plus-one requests are never auto-granted.** `"May I add a plus 1?"` is a cost decision belonging to the couple.
7. **Opt-outs are honoured immediately.** `"Opt Out"` in the notes sets `rsvp_status = 'declined'` and suppresses invites. Confirmed present in real data (`Ty Huynh`).

### The first sync is the expensive one

Because the master has no emails, **decision 3 means the first sync has nothing to auto-match on** — every response is name-matched and reviewed. Once a review writes an email onto a household, that household is identity-matchable forever after.

So the cost curve is front-loaded: a large first review pass, then near-zero ongoing. The UI must be built for the first pass being long, not for the steady state.

## Architecture

```
Google Sheet ──service account, read-only──► weekly Vercel Cron
                                                   │
                                         upsert into sheet_submissions
                                            (unique on row identity)
                                                   │
                                         matcher — pure function
                                                   │
                        exact email ────────────────┴──────────────── everything else
                             │                                              │
                    auto-apply, logged                              review inbox
                                                                            │
                                                    Match · Create new · Not a guest · Skip
```

The matcher is a pure function — `(submission, candidate households) → scored candidates` — so the hard cases can be unit-tested without a database or a network.

### Access

A Google Cloud service account with read-only Sheets scope; the sheet is shared to its address as Viewer. Key in Vercel env, never in git, never under `NEXT_PUBLIC_`.

Failure modes to handle explicitly, because they are the ones that actually happen: sharing revoked, tab renamed, columns reordered, sheet moved. Each must surface as a plain-language admin notice — *"We can't read the Save-the-Date sheet any more"* — not a silent no-op. **A sync that reads zero rows when it previously read many is treated as an error, not as "no new responses."**

### Change detection

There is no stable row ID, and rows can be edited or deleted. Identity is a hash of the row's stable content (timestamp + normalized email + normalized name), stored unique per wedding. Re-running is therefore a no-op, which is what makes the best-effort cron safe. A double-fire changes nothing; a skipped week is caught by the next run, since the job reconciles the whole sheet rather than processing a delta.

### Matching

Diacritic-normalized, lowercased, punctuation-stripped. Score combines:

- **Given name** — Jaro-Winkler, which handles transliteration and short forms well.
- **Surname** — token-set containment rather than whole-string similarity, so `Aw` scores highly against `Aw-Irwin`, and `Garza` against `Garza-Cohoon`.
- A penalty when a second candidate scores close behind, because ambiguity matters more than absolute score.

`rapidfuzz` is the recommended library rather than a full record-linkage framework — the training machinery in Splink or dedupe is overkill at ~270 records total.

Multi-person rows (`Julie & Joseph`, `Chelsea / Max`) are never auto-split; they go to review as one item.

## The review inbox

A tab on `/admin/imports`. Each item shows the submission as a human — name, email, address, notes, when it arrived — beside the top candidates with their scores and *why* they scored (`surname Aw is contained in Aw-Irwin`). Showing the reason is what lets her trust or distrust a suggestion rather than rubber-stamping it.

Four actions: **Match to this household** · **Create a new household** · **Not a guest** · **Skip for now**.

Every decision persists so the item never returns. Given the first pass is long, keyboard navigation matters — the import screen's Tab-through flow proved that pattern works here.

Applied matches appear in a reversible activity list: *"Added an address to The Smith Family from Sarah Smith's response · Undo."*

## Schema

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
  applied jsonb,          -- what was written, for undo
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (wedding_id, source, row_key)
);
```

`applied` is what makes decision 2 real: it records the prior value of every field written, so undo restores rather than guesses.

RLS follows the existing per-wedding pattern. **The sync writes via the service-role client only** — and per the standing rule in this codebase, any new `security definer` function needs `revoke execute … from public, anon, authenticated`.

## Error handling

- **Sheet unreadable** — plain admin notice naming the likely cause; the previous sync's data is untouched.
- **Zero rows where there were previously many** — treated as an error, not an empty result.
- **A malformed row** — skipped with its own review-inbox entry, never crashing the run.
- **Cron double-fire** — no-op by construction via `row_key`.
- **Undo after the household changed** — if the field has since been edited by hand, undo declines and says so rather than clobbering the newer value.

## Testing

The matcher is pure, so the hard cases are unit tests:

- `Alison Aw` → `Alison Aw-Irwin` scores high but still reaches review.
- `CECILIA GARZA` → `Cecilia Garza-Cohoon` likewise.
- **`Amadeo Guiao` must NOT match `Amadeo Cruz`** — the unrecoverable case; a matcher that "solves" it is wrong.
- `Blanca Viridiana Jauregui del Muro` → `Viridiana Del Muro` reaches review.
- An exact email match auto-applies; **a high-scoring name match never does.**
- Two candidates scoring close both reach review, with the ambiguity penalty applied.
- Vietnamese and Spanish names normalize without mangling.

Behavioural:

- Fill-blanks-only: a matched submission writes an address but leaves an admin-edited email untouched.
- Undo restores the previous value exactly, and declines if the field changed since.
- `Ty Huynh`'s opt-out sets `declined` and suppresses invites.
- The Djenohan double-submission collapses to one household.
- Two consecutive syncs produce no duplicate submissions and no duplicate writes.
- A sync returning zero rows after a non-zero sync raises an error.

## Deferred

SMS delivery, per-guest (rather than per-household) contact data, and writing anything back to the sheet. The sheet is read-only to us — after import, the app is the source of truth.
