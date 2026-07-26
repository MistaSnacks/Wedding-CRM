# Data-agnostic ingestion — roadmap (multi-tenant product)

**Status:** Deferred. Captured 2026-07-25 while building the Juliet import. Not scheduled — revisit when onboarding a second wedding.

**Why it matters:** every couple arrives with a differently-shaped spreadsheet. Today's importer handles exactly one shape and one vocabulary. It got 14 of 21 mappings right on the first real sheet, which flatters it — that sheet happened to use the header names we guessed.

## What's brittle today

`lib/csv/detect.ts` matches **headers only, by exact string equality** after lowercasing and stripping spaces/underscores/hyphens, against a hardcoded synonym list per field. It never reads a cell value.

Consequences:

| Header | Result |
|---|---|
| `First Name` | matches |
| `Guest First Name` | **no match** — normalizes to `guestfirstname`, not in the list |
| `Fname` | **no match** |
| `Nombre` | matches (it's in the list) |
| `Prénom` | **no match** |
| `Column F` / blank | **no match**, and unreachable by any synonym list |

A header typo defeats detection entirely and drops the user into the mapping drawer — the screen the redesign exists to keep her out of.

## Layer 1 — read the values, not the headers

Deterministic content inspection over a sample of rows. Highest value per unit of effort: no dependency, no latency, no cost, fully unit-testable, and it works when the header is missing, misspelled, or in an unanticipated language.

Signals worth implementing:

- **email** — most non-empty values contain `@` and a dot after it
- **zip** — 5 digits, or 5+4, or an alphanumeric postcode pattern
- **state** — two letters, or a member of a known state/province list
- **phone** — digit-heavy after stripping `+()-. `, length 7–15
- **country** — small distinct set matching known country names/codes
- **date** — parses as a date across most rows
- **name-like** — short values, one or two tokens, high cardinality relative to row count
- **surname-like** — name-like *and* low cardinality (repeats across rows), which distinguishes last name from first

Use content signals to **corroborate or override** header guesses, and report confidence so the UI can say "we think column F is email" rather than silently guessing.

## Layer 2 — detect the shape, not just the columns

**The real gap.** No mapping can express it, because it's structural.

A very common wedding-spreadsheet shape is **one row per household**:

```
Party Name    , Guest 1     , Guest 2      , Guest 3
Smith Family  , John Smith  , Sarah Smith  , Emma Smith
```

The engine assumes **one row per guest**. There is no `CsvMapping` that says "this row is three people." Today this file imports as three households of one guest each, named `John Smith` with an empty surname — silently wrong, and the confirmation screen would show a plausible-looking but incorrect count.

Shapes to detect and normalize *before* mapping runs:

1. **Wide/unpivoted** — `Guest 1..N` or `Partner 1/2` columns → unpivot to one row per guest, carrying household columns down.
2. **Full-name column** — a single `Name`/`Guest` column holding `"Sarah Smith"` → split on last whitespace, with honorific stripping (`Mr.`, `Mrs.`, `Dr.`, `Mr. & Mrs.`).
3. **Couple-in-one-cell** — `"John & Sarah Smith"`, `"Michael and Monica"` → two guests, one household. Already seen in the Save-the-Date sheet.
4. **Blank-row or indentation grouping** — households separated by empty rows rather than a shared key.

Each transform must be **visible and reversible in the UI** — "We read this as one row per household and split it into 3 guests" with a way to say no. Silent restructuring is worse than failing.

## Layer 3 — LLM assist for the long tail

Only when layers 1 and 2 are unsure. Send headers plus ~5 sample rows, receive a proposed mapping and shape, present as *"we think this is…"* for confirmation — never applied silently.

Not the primary path: slower, costs money, non-deterministic, and unavailable offline. It is the escape hatch that replaces "drop her into 21 dropdowns."

Prerequisites, neither currently present: an AI SDK dependency and `AI_GATEWAY_API_KEY`. Per `AGENTS.md`, route through Vercel AI Gateway and verify model IDs against `https://ai-gateway.vercel.sh/v1/models` rather than trusting remembered ones.

## Why aggressive guessing is safe now

The confirmation screen is the safety net. The user sees **"246 guests in 159 invitations"** with real names and readable household cards before anything is written. A wrong guess is obvious within seconds, and the mapping drawer is one click away.

This is the property that makes all three layers worth building. It did not hold under the old design, where mapping *was* the interface — which is precisely why that version had to interrogate the user about all 21 fields instead of guessing well.

## Suggested order

1. **Layer 1** — content detection. Self-contained, pure, testable, no dependencies.
2. **Layer 2** — shape detection, starting with wide/unpivoted and full-name splitting. Highest real-world impact; also the only one that is currently *silently wrong* rather than merely unhelpful.
3. **Layer 3** — only if the first two leave real gaps in practice.

Do not build Layer 3 first because it looks like it subsumes the others. It is the least deterministic and hardest to test of the three.

## Related

- `docs/superpowers/specs/2026-07-25-guest-import-experience-design.md` — the UI this feeds
- `docs/superpowers/specs/2026-07-24-guest-data-migration-design.md` — Save-the-Date sync, which faces the same fuzzy-identity problem from the other direction
- `docs/seating-roadmap.md` — the other deferred multi-tenant workstream
