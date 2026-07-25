# Guest import experience — redesign

- **Date:** 2026-07-25
- **Status:** Approved to build (user directed: "fix this entirely with me out of the loop")
- **Supersedes the UI half of:** `2026-07-24-guest-data-migration-design.md`
- **Scope:** The `/admin/imports` experience. The validation engine and commit RPC underneath are unchanged.

## What went wrong the first time

The previous spec designed a *data migration* and called it a product feature. Across ~1,400 lines of spec and plan, the words "confusing", "understand", "explain" and "learn" appear **zero** times. "Juliet" appears 14 times — every one of them as the owner of a Google Sheet we needed read access to, never as someone who uses the software.

Decision 7 of that spec said "The importer is a product feature, not a migration script," then immediately defined that as *"nothing may be hardcoded to this wedding's column names"* — translating a usability requirement into a code-correctness property. A guard test was then written to enforce it. The result: an abstraction only developers can perceive was protected by automated tests, while the bride was shown 21 dropdowns.

Because each of the seven capability tasks added a mapping, and the UI was a one-to-one projection of the schema, the interface grew a control per capability. The wizard task was titled "Wire the new mappings into the wizard" — sized as wiring, placed tenth of thirteen.

Twelve task reviews and a whole-branch review all measured conformance to that spec. Review verifies you built the thing right; nothing asked whether it was the right thing.

## Who this is for

**Juliet.** Planning her own wedding, not technical, will use this once or twice under time pressure, has no support channel. Her mental model is *"upload my guest list, see my guests, invite them."* She does not think in columns, fields, or mappings. She thinks "the Smiths are one invite."

Every decision below is tested against: *would Juliet know what to do next without asking anyone?*

## Evidence from the field

Researched Zola, The Knot, Joy, Appy Couple, Minted, plus CSV-import tooling literature (Dromo, OneSchema). Findings in `competitor-import-research.md`. What matters:

- **Joy** shows valid / needs-review / skipped counts with per-row reasons **immediately after upload**, then offers "Import Valid Contacts" — partial import, not all-or-nothing. The most sophisticated documented flow in the set.
- **No competitor** shows a mapping configuration screen as the primary path. Where mapping exists (Zola) it is framed as *"match"* or *"confirm"*, never *"configure"*.
- **No competitor** asks the user to define households as an abstract pre-import field. Zola infers grouping from same-row placement; Appy Couple defers grouping to a post-import step.
- **No competitor** exposes "age type", "envelope", "max party size", "plus-one slots", or per-event RSVP columns as things the bride configures at import time.
- Current CSV-tooling guidance names **`"row 47 is invalid"` as an explicit UX failure**. Errors must identify the *person*, not the line.

The category moved to *auto-map → confirm → partial import → fix the rest later*. Our wizard is solving the 2019 problem.

## The core inversion

**Confirmation before configuration.**

Today: 21 dropdowns → dense table → Commit.
After: **"We found 252 guests in 140 invitations"** → import → refine only if something looks wrong.

Auto-detection already resolves **14 of 21** mappings on the real sheet. Of the 7 it misses, 5 are fields the sheet genuinely does not have. Only **2** are real judgment calls. The wizard currently asks Juliet to review 21 decisions when at most 2 need a human — and it asks *before* she has seen a single guest name.

## Screen flow

### 1. Upload

One dropzone. Not a file input styled as a button.

> **Upload your guest list**
> A spreadsheet from Excel, Google Sheets, or Numbers. We'll work out the columns — you don't need a template.

While parsing: an explicit reading state. Never silence.

### 2. What we found

The heart of the redesign. Everything here is plain language.

> ## We found **252 guests** in **140 invitations**
> Guests who share an envelope are grouped into one invitation with one RSVP link.

Then what else came along, only listing what was actually found:

> Also picked up: **mailing addresses** for 8 · **email** for 3 · **meal choices** for 2 · **dietary notes** for 2

Then a **readable** preview — household cards showing real names, not a data grid:

> **The Smith Family** — John, Sarah, Emma · seats 3
> **Kevin & Nancy Bui** — Kevin Bui, Nancy Bui · seats 2
> **Ann One & Guest** — Ann One · seats 2 *(1 unnamed)*

If anything needs attention, a calm section — amber, not red, and never a wall:

> **12 rows need a last name** — these won't be imported until you add one.
> Row 20 · `Miguel` in *Miguel Household* — no last name
> Row 100 · `Rhonda` in *Rhonda Household* — no last name
> [Download these 12 rows] [Show all]

Actions:

> [**Import 240 guests**] [Fix these 12 first]
> *Columns look wrong?* ← quiet link, opens §4

### 3. Done

> ## Your guest list is ready
> **140 invitations · 240 guests**
> 12 rows were skipped — [download them] to fix and re-upload.
>
> [View guest list] [Send invitations]

A real destination. The import is not the goal; inviting people is.

### 4. "Columns look wrong?" — collapsed by default

Everything the wizard is today lives here, reframed as correction rather than configuration. Opens showing what was matched, in plain language:

> We matched **14 of your columns** automatically:
> `First Name` → first name · `Envelope Name` → invitation name · …

Only then the dropdowns, for changing a match or filling one we missed. Advanced controls — tag columns, per-event RSVP columns — live here and nowhere else.

## The two judgment calls

`ageType` and `isPlusOne` both come from the sheet's `List` column. No detector can infer that, but Juliet should never see a dropdown for it. Instead, **after** the confirmation, offer at most two plain questions — and only when a candidate column plausibly qualifies:

> Your sheet has a column called **List** with values like *A List - Juliet*, *Plus One*, *Baby*.
> Does it mark who's a plus-one? [Yes] [No]
> Does it mark children and babies? [Yes] [No]

Answering improves the import. Skipping is fine and costs only precision. These are refinements, never gates.

## Decisions

1. **Confirmation precedes configuration.** Juliet sees her guests before she sees a control.
2. **Never block on bad rows.** Import what is valid; hold the rest. Import is always available, and the button says how many will be imported.
3. **Problems identify people, not lines.** Every message names the guest and their household. Line numbers are secondary, for finding the row in the sheet.
4. **Errors and warnings are separate, complete lists.** Never a shared truncated list — the current bug that makes warnings unreachable.
5. **Mapping is collapsed by default.** Auto-detection is the path; manual mapping is the escape hatch.
6. **Judgment calls are questions, not dropdowns**, and are optional.
7. **Keep every data capability** — meal, dietary, notes, addresses, per-event invites all still import. The research suggests dropping them from import entirely; we do not, because this sheet genuinely contains that data and discarding it would lose real information. We remove the *configuration burden*, not the capability: all four auto-detect today.
8. **Every action confirms itself**, including export downloads, which are currently silent.
9. **No required-field asterisks.** They marked an internal constraint as a user instruction. If a required mapping is missing, say so in words at the point it matters.

## What changes, what does not

**Unchanged:** `lib/csv/**` (validation engine, 95 tests), `import_households` RPC, migrations, `lib/data/**` apart from one export helper. The engine is well-tested and correct; this is an interface problem.

**Rewritten:** `components/admin/ImportWizard.tsx` — from one 240-line dropdown grid into a small step machine with focused child components.

**New:**
- `lib/csv/summary.ts` — pure function turning a `CsvValidation` into the plain-language summary the confirmation screen renders (counts, what-else-was-found, per-person problem descriptions). Pure so it is unit-testable, which the current UI logic is not.
- Step components under `components/admin/import/`.

**Fixed:**
- Errors/warnings truncation (`ImportWizard.tsx:238`).
- Silent export downloads (`imports/page.tsx`).

## Error handling

- **Unreadable file** — plain message naming the likely cause (not a CSV, empty, wrong tab), never a parser exception.
- **No rows** — "That file didn't have any guests in it."
- **No name columns found** — the one case where mapping opens automatically, with an explanation: "We couldn't tell which columns hold names. Point us at them."
- **Commit fails** — the household name from the RPC's error attribution, plus the fact that nothing was written.

## Testing

The engine's 95 tests continue to pass untouched.

**New unit tests** on `lib/csv/summary.ts`, which is where the logic that matters now lives:
- 252 guests / 140 households summarises correctly.
- Problem rows are described by person and household, not line alone.
- Errors and warnings are returned as separate complete lists — no truncation at any count. Explicitly test 12 errors + 20 warnings, the exact case that failed.
- "Also picked up" lists only categories actually present, and is omitted entirely when nothing extra was found.
- A household with an unnamed plus-one seat renders as "seats 2 (1 unnamed)".

**Manual verification** against the real 252-row sheet: household count is ~140 not 122, all 20 warnings reachable, the 12 problem rows name real people, and partial import commits 240 guests.

## Out of scope

Post-import editing of quarantined rows (they download and re-upload), the Save-the-Date sync, event management UI, and any change to the validation engine's rules.
