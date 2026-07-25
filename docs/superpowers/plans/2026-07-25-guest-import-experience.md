# Guest Import Experience Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the 21-dropdown import wizard with a flow that shows Juliet her guests before it shows her a control.

**Architecture:** A new pure function `lib/csv/summary.ts` turns a `CsvValidation` into plain-language summary data (counts, what-else-was-found, per-person problem descriptions). `ImportWizard.tsx` becomes a small step machine — Upload → Review → Done — rendering focused child components under `components/admin/import/`. The validation engine, RPC, and migrations are untouched.

**Tech Stack:** TypeScript, Next.js 16.2.10, React 19, vitest, Tailwind.

## Global Constraints

- **The engine is not in scope.** `lib/csv/{parse,detect,normalize,group,fields,validate}.ts`, `lib/data/imports.ts`, the `import_households` RPC, and all migrations stay as they are. **All 95 existing tests must pass untouched.**
- **Confirmation precedes configuration.** No mapping control may appear before the user has seen her guest counts.
- **Never block on bad rows.** Import is always available and states how many guests it will import.
- **Problems name people, not lines.** Every user-facing problem message leads with the guest and household. Line numbers are secondary.
- **Errors and warnings are separate, complete, untruncated lists.** The current shared `.slice(0, 8)` is the specific bug that hid 16 warnings behind 12 errors.
- **No required-field asterisks.**
- **Ground-truth fixture:** `/private/tmp/claude-502/-Users-admin-guest-crm/4601fc73-6db9-42c1-85f6-f000f6565416/scratchpad/master-guest-list.csv` — the real 278-row sheet. Contains real personal data: use it for verification, never commit it, never paste its contents into a report.
- **Verified real numbers** with `envelope`+`isPlusOne`+`ageType`+tags mapped: **161 invitations, 246 named guests, 26 unnamed seats, 12 errors, 16 warnings** (12 "someone may be missing", 4 "only unnamed rows — skipped").
- **Read `node_modules/next/dist/docs/` before touching any Next.js API.** This repo's Next.js differs from public docs.
- **Test command:** `npx vitest run`. Vitest `include` is `lib/**/*.test.ts` — components are not covered, so `tsc`, `npm run build`, and real browser use are the verification for UI.
- **Dev server already runs detached on port 3006.** To free a port: `lsof -ti:<port> | xargs kill`. Never name-based kills.

## File Structure

| File | Responsibility |
|---|---|
| `lib/csv/summary.ts` | **New.** Pure: `CsvValidation` → `ImportSummary` (counts, extras found, per-person problems) |
| `lib/csv/summary.test.ts` | **New.** Unit tests — this is where the logic that matters now lives |
| `components/admin/import/UploadStep.tsx` | **New.** Dropzone + reading state |
| `components/admin/import/ReviewStep.tsx` | **New.** "We found X guests in Y invitations" + preview + problems + actions |
| `components/admin/import/ProblemList.tsx` | **New.** Errors and warnings as separate complete lists |
| `components/admin/import/ColumnMatches.tsx` | **New.** Collapsed "Columns look wrong?" — the old dropdowns, reframed |
| `components/admin/import/DoneStep.tsx` | **New.** Result + onward links |
| `components/admin/ImportWizard.tsx` | **Rewritten.** Step machine only |
| `app/admin/(dashboard)/imports/page.tsx` | Export-download feedback |

---

### Task 1: `lib/csv/summary.ts` — the plain-language layer

**Files:** Create `lib/csv/summary.ts`, `lib/csv/summary.test.ts`

**Interfaces produced:**

```ts
export type ImportProblem = {
  kind: "error" | "warning";
  line: number;
  who: string;         // "Miguel" or "The Smith Family" — never empty
  household: string;   // "Miguel Household"
  message: string;     // plain language, no jargon
};

export type ImportSummary = {
  invitations: number;
  namedGuests: number;
  unnamedSeats: number;
  extras: Array<{ label: string; count: number }>;  // only non-zero
  problems: { errors: ImportProblem[]; warnings: ImportProblem[] };  // complete, never truncated
  preview: Array<{ displayName: string; guests: string[]; seats: number; unnamed: number }>;
};

export function summarize(v: CsvValidation, rows: Record<string,string>[], mapping: CsvMapping): ImportSummary;
```

- [ ] **Step 1: Write the failing tests.** Cover, at minimum:
  - Counts: 3 households / 7 named / 2 unnamed → `invitations: 3, namedGuests: 7, unnamedSeats: 2`.
  - **Untruncated:** build a validation carrying 12 errors and 20 warnings; assert `problems.errors.length === 12` and `problems.warnings.length === 20`. This is the exact bug being fixed — it must fail against any capped implementation.
  - `extras` omits zero-count categories entirely, and is `[]` when nothing extra was found.
  - `extras` includes `{label: "mailing addresses", count: 2}` when two households have one.
  - A problem for a row missing a last name has `who` set to the guest's first name, not `""`, and `household` set to the group it belongs to.
  - A problem never has an empty `who` — if no name is recoverable, it falls back to the household name.
  - `preview` renders an unnamed seat as `unnamed: 1` alongside `guests: ["Ann One"]`, `seats: 2`.

- [ ] **Step 2: Run tests, confirm they fail** — `npx vitest run lib/csv/summary.test.ts`.
- [ ] **Step 3: Implement `summarize`.** To resolve `who`, look up the original row by `line` (line 1 is the header, so row index is `line - 2`) and read the mapped first/last name cells; fall back to the household display name. Keep it pure — no I/O, no React.
- [ ] **Step 4: Tests pass; `npx vitest run` shows 95 + your new tests.**
- [ ] **Step 5: Commit.**

---

### Task 2: The step components

**Files:** Create the five components under `components/admin/import/`. Do not wire them yet.

- [ ] **Step 1: `UploadStep`** — a real dropzone (drag-over state, click-to-browse), accepting `.csv`/`.xlsx`. Copy: **"Upload your guest list"** / *"A spreadsheet from Excel, Google Sheets, or Numbers. We'll work out the columns — you don't need a template."* Shows an explicit reading state while parsing. Never silent.

- [ ] **Step 2: `ReviewStep`** — renders an `ImportSummary`:
  - Headline: **"We found 246 guests in 161 invitations"** — numbers emphasised, sentence readable aloud.
  - One explanatory line: *"Guests who share an envelope are grouped into one invitation with one RSVP link."*
  - `extras` as a single quiet line, omitted entirely when empty.
  - Preview as **household cards** showing real names — `The Smith Family — John, Sarah, Emma · seats 3` — scrollable, not a data grid.
  - Primary action states the number: **"Import 234 guests"**. Secondary: the problems. A quiet `Columns look wrong?` link.

- [ ] **Step 3: `ProblemList`** — errors and warnings as **two separate, independently complete lists**, each collapsible, neither truncated. Every entry leads with the person: *"**Miguel** in Miguel Household — no last name (row 20)"*. Warnings are amber and explicitly non-blocking; errors are rose and explain the row will be skipped. Include a "Download these rows" action so the user can fix them in her sheet.

- [ ] **Step 4: `ColumnMatches`** — collapsed by default. When open, first a plain-language list of what was matched (`First Name → first name`), then the existing dropdowns for changing a match, then the tag and per-event pickers. **Reuse the existing `TagPicker` and `EventPicker` components unchanged.** No asterisks.

- [ ] **Step 5: `DoneStep`** — **"Your guest list is ready"**, the counts, a note about any skipped rows, and two real destinations: *View guest list* and *Send invitations*.

- [ ] **Step 6:** `npx tsc --noEmit` clean. Commit.

Follow existing Tailwind conventions in `ImportWizard.tsx` (`olive-deep`, `hairline`, `muted`, raw hex like `#dddbd0`).

---

### Task 3: Rewire `ImportWizard` as a step machine

**Files:** Rewrite `components/admin/ImportWizard.tsx`; adjust `app/admin/(dashboard)/imports/page.tsx` if props change.

- [ ] **Step 1:** Reduce `ImportWizard` to state (`step`, `rows`, `headers`, `mapping`, `runId`, `result`) plus handlers, rendering one step component at a time. All presentation moves to children.
- [ ] **Step 2:** On file drop — parse, `detectMapping`, `validateCsv` with the real `ImportContext`, `summarize`, then go straight to Review. **No configuration screen in between.**
- [ ] **Step 3:** Preserve the existing correctness guarantees exactly: the `generation` ref staleness guard on dry-run responses, `setRunId(null)` on every mapping mutation, and the dry-run-before-commit gate. These were hard-won — read the current file's comments before touching them.
- [ ] **Step 4:** If `detectMapping` finds no first/last name column, open `ColumnMatches` automatically with an explanation. This is the only case where mapping appears unprompted.
- [ ] **Step 5:** `npx vitest run` (95 + Task 1's), `npx tsc --noEmit`, `npm run build` — all clean. Commit.

---

### Task 4: Export feedback

**Files:** `app/admin/(dashboard)/imports/page.tsx`

- [ ] **Step 1:** The twelve export links are bare `<a href>` downloads that give no signal. Add a pending state on click and a brief confirmation that the file downloaded, so an export never "just happens" invisibly. Keep them real links (right-click/save must still work) — enhance, don't replace with JS-only handlers.
- [ ] **Step 2:** `npm run build` clean. Commit.

---

### Task 5: Verify by actually using it

**This task is the point.** The previous effort passed 95 tests, twelve task reviews and a whole-branch review, and still shipped an unusable screen, because nobody used it until the end.

- [ ] **Step 1:** Drive a real browser against `http://localhost:3006/admin/imports` (dev server already running detached). Sign in via `node scripts/dev-login.mjs`.
- [ ] **Step 2:** Upload the ground-truth fixture. Assert against the verified numbers:
  - Headline reads **161 invitations** and **246 guests** — not 122.
  - **All 16 warnings are reachable**, including all 12 "someone may be missing". Count them in the DOM.
  - All 12 errors are reachable and each **names a person**, not just a line number.
  - The import button states a guest count and is **enabled despite the 12 errors**.
- [ ] **Step 3:** Complete a real import. Confirm `/admin/guests` shows the households, then **delete the imported data** and confirm the database returns to 1 wedding / 3 households / 8 guests / 0 imports.
- [ ] **Step 4:** Capture screenshots of Upload, Review (with problems open), and Done into the scratchpad.
- [ ] **Step 5:** Report what was observed, including anything that felt confusing. Judgement is wanted here, not just assertions.

---

## Out of scope

Post-import editing of skipped rows, the Save-the-Date sync, event management UI, and any change to validation rules.
