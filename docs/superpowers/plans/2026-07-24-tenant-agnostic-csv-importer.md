# Tenant-Agnostic CSV Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `/admin/imports` CSV wizard so any wedding can ingest a real guest list — envelope-level households, plus-one slots, tags, addresses, meals, dietary, notes, and per-event invites — committed transactionally.

**Architecture:** `lib/csv.ts` is split into focused modules under `lib/csv/` behind a barrel, so the `@/lib/csv` import path is unchanged. All parsing/validation stays a pure function taking `(rows, mapping, context)` and returning `ImportHouseholdInput[]` plus errors and warnings, which means the client preview and the server commit are driven by identical logic. Writing becomes a single Postgres RPC so a mid-import failure rolls back.

**Tech Stack:** TypeScript, Next.js 16.2.10, React 19, vitest 4, papaparse, Supabase (Postgres + RLS).

## Global Constraints

- **Tenant-agnostic.** No literal from the Juliet & Juan sheet may appear in `lib/csv/**` or `lib/data/imports.ts`. `Envelope Name`, `A List`, `Plus One`, `Baby`, `Le 1`, `Wedding RSVP`, `Juliet`, `Juan` belong only in test fixtures. Behaviour is driven by column mapping, never by cell values specific to one wedding.
- **Every optional mapping stays optional.** A CSV with only first/last name must import exactly as it does today. All 42 existing tests must remain green at every task boundary.
- **`@/lib/csv` public surface is preserved:** `parseCsv`, `detectMapping`, `validateCsv`, and types `CsvMapping`, `RowError`, `CsvValidation`. Existing importers (`components/admin/ImportWizard.tsx`, `app/admin/(dashboard)/imports/actions.ts`) must not need import-path edits.
- **No schema migration for Tasks 1–8.** `households.tags`, `households.mailing_address`, `households.internal_notes`, `guests.origin`, `guests.dietary_restrictions`, `guest_event_responses.meal_option_id` all already exist in `supabase/migrations/0001_init.sql`. Only Task 9 adds SQL.
- **Read `node_modules/next/dist/docs/` before touching any Next.js API.** This repo's Next.js has breaking changes vs. public docs (`AGENTS.md`).
- **Test command:** `npx vitest run` (or `npm test`). Vitest `include` is `lib/**/*.test.ts` — tests live beside source under `lib/`.
- **Never run broad name-based process kills.** To free a port use `lsof -ti:<port> | xargs kill`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/csv/types.ts` | `CsvMapping`, `RowError`, `CsvValidation`, `ImportContext`, `MailingAddress` |
| `lib/csv/normalize.ts` | Pure helpers: `norm`, `normalizeAge`, `isTruthy`, `cleanValue` |
| `lib/csv/parse.ts` | `parseCsv` — papaparse wrapper |
| `lib/csv/detect.ts` | `detectMapping` — header auto-detection |
| `lib/csv/group.ts` | `groupKey`, `groupRows` — row → household grouping |
| `lib/csv/validate.ts` | `validateCsv` — orchestration, row→record mapping, errors/warnings |
| `lib/csv/index.ts` | Barrel re-exporting the public surface |
| `lib/csv/*.test.ts` | Unit tests, one file per concern |
| `lib/data/imports.ts` | `ImportHouseholdInput` type, `createRun`/`finishRun`, `commitHouseholds` via RPC |
| `supabase/migrations/0003_import_rpc.sql` | Transactional `import_households` function |
| `components/admin/ImportWizard.tsx` | Mapping UI for the new fields, dry-run + commit steps |
| `app/admin/(dashboard)/imports/actions.ts` | `validateCsvImport` (new) + `commitCsvImport` |

---

### Task 1: Split `lib/csv.ts` into modules (no behaviour change)

De-risks every later task. Pure refactor — the 42 existing tests are the proof.

**Files:**
- Create: `lib/csv/types.ts`, `lib/csv/normalize.ts`, `lib/csv/parse.ts`, `lib/csv/detect.ts`, `lib/csv/group.ts`, `lib/csv/validate.ts`, `lib/csv/index.ts`
- Delete: `lib/csv.ts`
- Move: `lib/csv.test.ts` → `lib/csv/validate.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `@/lib/csv` barrel exporting `parseCsv`, `detectMapping`, `validateCsv`, and types `CsvMapping`, `RowError`, `CsvValidation`. Internal modules export `norm(s?: string): string`, `normalizeAge(v?: string): AgeType`, `groupKey(row, mapping): string`.

- [ ] **Step 1: Move the test file first, confirm it still passes**

```bash
git mv lib/csv.test.ts lib/csv/validate.test.ts 2>/dev/null || { mkdir -p lib/csv && git mv lib/csv.test.ts lib/csv/validate.test.ts; }
```

Then change its import line from `from "./csv"` to `from "./index"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/csv/validate.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Create `lib/csv/types.ts`**

```ts
import type { AgeType } from "@/lib/types";

export type CsvMapping = {
  firstName: string;
  lastName: string;
  household?: string;
  email?: string;
  phone?: string;
  ageType?: string;
  relationship?: string;
  maxPartySize?: string;
  plusOneSlots?: string;
  locale?: string;
};

export type RowError = { line: number; message: string };

export type CsvValidation = {
  ok: boolean;
  households: import("@/lib/data/imports").ImportHouseholdInput[];
  errors: RowError[];
  warnings: RowError[];
};

export type { AgeType };
```

- [ ] **Step 4: Create `lib/csv/normalize.ts`**

```ts
import type { AgeType } from "@/lib/types";

/** Trim, collapse internal whitespace, lowercase. Used for all comparison keys. */
export function norm(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Trimmed display value, or undefined when empty. */
export function cleanValue(s: string | undefined | null): string | undefined {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : undefined;
}

export function normalizeAge(v: string | undefined): AgeType {
  const s = norm(v);
  if (s.startsWith("child") || s === "kid" || s === "niño") return "child";
  if (s.startsWith("infant") || s === "baby" || s === "bebé") return "infant";
  return "adult";
}
```

- [ ] **Step 5: Create `lib/csv/parse.ts` and `lib/csv/detect.ts`**

Move `parseCsv` verbatim from the old `lib/csv.ts` into `parse.ts` (keeping its `papaparse` import), and `detectMapping` verbatim into `detect.ts` (importing `CsvMapping` from `./types`).

- [ ] **Step 6: Create `lib/csv/group.ts`**

Extract today's grouping key expression from `validateCsv` unchanged:

```ts
import type { CsvMapping } from "./types";
import { norm } from "./normalize";

/** Today's behaviour: household column when present, else last name + email. */
export function groupKey(row: Record<string, string>, mapping: CsvMapping): string {
  if (mapping.household && row[mapping.household]?.trim()) {
    return `hh:${norm(row[mapping.household])}`;
  }
  const last = norm(row[mapping.lastName]);
  const email = mapping.email ? norm(row[mapping.email]) : "";
  return `auto:${last}|${email}`;
}
```

- [ ] **Step 7: Create `lib/csv/validate.ts`**

Move `validateCsv` from the old `lib/csv.ts`, importing `normalizeAge` from `./normalize`, `groupKey` from `./group`, and types from `./types`. Replace the inline key expression with `groupKey(row, mapping)`. Delete the now-dead `void key;` line. No other behaviour change.

- [ ] **Step 8: Create `lib/csv/index.ts`**

```ts
export { parseCsv } from "./parse";
export { detectMapping } from "./detect";
export { validateCsv } from "./validate";
export type { CsvMapping, RowError, CsvValidation } from "./types";
```

- [ ] **Step 9: Delete the old file and run the full suite**

```bash
git rm lib/csv.ts
npx vitest run
```

Expected: PASS, 42/42. If any test fails, the refactor changed behaviour — fix before continuing.

- [ ] **Step 10: Verify the app still builds**

Run: `npx tsc --noEmit`
Expected: no errors. `ImportWizard.tsx` and `actions.ts` import from `@/lib/csv`, which now resolves to `lib/csv/index.ts`.

- [ ] **Step 11: Commit**

```bash
git add -A lib/csv lib/csv.ts
git commit -m "refactor: split lib/csv.ts into focused modules behind a barrel"
```

---

### Task 2: Gap 1 — envelope-level grouping

**Files:**
- Modify: `lib/csv/types.ts` (add `envelope` to `CsvMapping`), `lib/csv/detect.ts`, `lib/csv/group.ts`, `lib/csv/validate.ts`
- Test: `lib/csv/group.test.ts` (create)

**Interfaces:**
- Consumes: `groupKey(row, mapping)`, `norm` from Task 1
- Produces: `CsvMapping.envelope?: string`. `groupKey` fallback order: `household+envelope` → `envelope` → `household` → last-name+email. `displayName` precedence: envelope value → household value → computed name.

- [ ] **Step 1: Write the failing test**

Create `lib/csv/group.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

const NESTED = `Household,Envelope Name,First Name,Last Name
Family Group A,Alpha One,Alpha,One
Family Group A,Beta Two & Gamma Three,Beta,Two
Family Group A,Beta Two & Gamma Three,Gamma,Three
Family Group A,Delta Four,Delta,Four
`;

describe("envelope grouping", () => {
  it("auto-detects an envelope column", () => {
    const { headers } = parseCsv(NESTED);
    expect(detectMapping(headers).envelope).toBe("Envelope Name");
  });

  it("splits one household value into per-envelope households", () => {
    const { headers, rows } = parseCsv(NESTED);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(3);
    expect(v.households.map((h) => h.displayName).sort()).toEqual([
      "Alpha One",
      "Beta Two & Gamma Three",
      "Delta Four",
    ]);
    const pair = v.households.find((h) => h.displayName === "Beta Two & Gamma Three")!;
    expect(pair.guests).toHaveLength(2);
    expect(pair.maxPartySize).toBe(2);
  });

  it("normalizes whitespace and case so variants do not split households", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group X ,Same  Envelope,Ann,One
group x,SAME Envelope,Ben,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(1);
    expect(v.households[0].guests).toHaveLength(2);
  });

  it("falls back to the household column when envelope is blank", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group Y,,Ann,One
Group Y,,Ben,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(1);
    expect(v.households[0].displayName).toBe("Group Y");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/group.test.ts`
Expected: FAIL — `detectMapping(...).envelope` is `undefined`; the split test reports 1 household.

- [ ] **Step 3: Add `envelope` to the mapping type**

In `lib/csv/types.ts`, add to `CsvMapping` directly after `household`:

```ts
  envelope?: string;
```

- [ ] **Step 4: Auto-detect the envelope column**

In `lib/csv/detect.ts`, add to the returned object after `household`:

```ts
    envelope: find("envelope", "envelopename", "invitationname", "mailto", "addressee") || undefined,
```

- [ ] **Step 5: Implement the composite key**

Replace `groupKey` in `lib/csv/group.ts`:

```ts
export function groupKey(row: Record<string, string>, mapping: CsvMapping): string {
  const hh = mapping.household ? norm(row[mapping.household]) : "";
  const env = mapping.envelope ? norm(row[mapping.envelope]) : "";
  if (hh && env) return `hh:${hh}|env:${env}`;
  if (env) return `env:${env}`;
  if (hh) return `hh:${hh}`;
  const last = norm(row[mapping.lastName]);
  const email = mapping.email ? norm(row[mapping.email]) : "";
  return `auto:${last}|${email}`;
}
```

- [ ] **Step 6: Use the envelope for the display name**

In `lib/csv/validate.ts`, replace the `displayName` expression with:

```ts
    const envelopeName = mapping.envelope ? first.row[mapping.envelope]?.trim() : "";
    const householdName = mapping.household ? first.row[mapping.household]?.trim() : "";
    const displayName =
      envelopeName ||
      householdName ||
      (group.rows.length > 1
        ? `The ${first.row[mapping.lastName].trim()} Family`
        : `${first.row[mapping.firstName].trim()} ${first.row[mapping.lastName].trim()}`);
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS — new group tests plus all 42 originals.

- [ ] **Step 8: Commit**

```bash
git add lib/csv
git commit -m "feat(import): group households by envelope column"
```

---

### Task 3: Gap 2 — blank-name rows become plus-one slots

**Files:**
- Modify: `lib/csv/validate.ts`
- Test: `lib/csv/slots.test.ts` (create)

**Interfaces:**
- Consumes: `groupKey` from Task 2
- Produces: a blank-name row inside a group increments that household's `plusOneSlots`. A blank-name row with no grouping value keeps today's `"Empty name — row skipped."` warning.

- [ ] **Step 1: Write the failing test**

Create `lib/csv/slots.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

describe("blank-name rows", () => {
  it("becomes a plus-one slot on its envelope's household", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann One,Ann,One,Primary
Group A,Ann One,,,Companion
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.households[0].guests).toHaveLength(1);
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(2);
  });

  it("does not depend on any category value", () => {
    // The blank row's category matches the named row's — a slot is still created.
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group B,Ben Two &,Ben,Two,Relatives
Group B,Ben Two &,,,Relatives
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(2);
  });

  it("counts multiple blank rows as multiple slots", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name
Group C,Cara,Three
Group C,,
Group C,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(2);
    expect(v.households[0].maxPartySize).toBe(3);
  });

  it("still warns and skips a row with no name and no grouping value", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name,Email\n,,\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(0);
    expect(v.warnings.some((w) => w.message.includes("Empty name"))).toBe(true);
  });

  it("adds slots on top of an explicit plus-one-slots column", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Plus Ones
Group D,Dana,Four,1
Group D,,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/slots.test.ts`
Expected: FAIL — blank rows are warned and dropped, so `plusOneSlots` is 0.

- [ ] **Step 3: Track blank rows per group**

In `lib/csv/validate.ts`, change the group accumulator to carry blank-row counts:

```ts
  const groups = new Map<
    string,
    { rows: Array<{ row: Record<string, string>; line: number }>; blankRows: number }
  >();
```

- [ ] **Step 4: Route blank-name rows into the group**

Replace the early-return blank check inside the row loop:

```ts
    if (!first && !last) {
      const key = groupKey(row, mapping);
      // A blank row with no grouping value is a stray line, not a seat.
      if (key.startsWith("auto:|")) {
        warnings.push({ line, message: "Empty name — row skipped." });
        return;
      }
      if (!groups.has(key)) groups.set(key, { rows: [], blankRows: 0 });
      groups.get(key)!.blankRows += 1;
      return;
    }
```

Update the named-row branch's initialiser to `{ rows: [], blankRows: 0 }` as well.

- [ ] **Step 5: Fold blank rows into the slot count**

In the household-building loop, after computing `plusOneSlots` from the mapped column:

```ts
    const plusOneSlots =
      (mapping.plusOneSlots ? parseInt(first.row[mapping.plusOneSlots] ?? "0", 10) || 0 : 0) +
      group.blankRows;
```

- [ ] **Step 6: Guard against a group with only blank rows**

At the top of the household-building loop, skip groups that produced no named guest — there is no household to attach a slot to:

```ts
    if (group.rows.length === 0) {
      warnings.push({ line: 1, message: `Group "${key}" has only unnamed rows — skipped.` });
      continue;
    }
    const first = group.rows[0];
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS. The original `"reports missing-name rows with line numbers"` test is unaffected — its rows each have one name present, so they remain errors.

- [ ] **Step 8: Commit**

```bash
git add lib/csv
git commit -m "feat(import): blank-name rows become plus-one slots"
```

---

### Task 4: Gap 3 — tags from mapped columns

**Files:**
- Modify: `lib/csv/types.ts`, `lib/csv/validate.ts`, `lib/data/imports.ts`
- Test: `lib/csv/tags.test.ts` (create)

**Interfaces:**
- Consumes: grouping from Task 2
- Produces: `CsvMapping.tags?: Array<{ column: string; prefix?: string }>`; `ImportHouseholdInput.tags?: string[]`. Tags are the union across a household's rows, prefixed when configured, trimmed, deduplicated, empties dropped.

- [ ] **Step 1: Write the failing test**

Create `lib/csv/tags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, validateCsv, detectMapping } from "./index";

const CSV = `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann One,Ann,One,Friends
Group A,Ann One,Bob,One,Friends
Group B,Cara Two,Cara,Two,Colleagues
`;

describe("tag mapping", () => {
  it("collects mapped column values as tags", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, { ...detectMapping(headers), tags: [{ column: "Category" }] });
    const a = v.households.find((h) => h.displayName === "Ann One")!;
    expect(a.tags).toEqual(["Friends"]);
  });

  it("applies a per-column prefix", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, {
      ...detectMapping(headers),
      tags: [{ column: "Category" }, { column: "Household", prefix: "family:" }],
    });
    const a = v.households.find((h) => h.displayName === "Ann One")!;
    expect(a.tags!.sort()).toEqual(["Friends", "family:Group A"]);
  });

  it("deduplicates across rows and drops blanks", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Category
Group C,Dan,Three,VIP
Group C,Eve,Three,VIP
Group C,Fay,Three,
`,
    );
    const v = validateCsv(rows, { ...detectMapping(headers), tags: [{ column: "Category" }] });
    expect(v.households[0].tags).toEqual(["VIP"]);
  });

  it("omits tags entirely when no tag columns are mapped", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].tags).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/tags.test.ts`
Expected: FAIL — `tags` is not a property of `CsvMapping` (TS error) and is `undefined` on the result.

- [ ] **Step 3: Extend the mapping type**

In `lib/csv/types.ts`, add to `CsvMapping`:

```ts
  tags?: Array<{ column: string; prefix?: string }>;
```

- [ ] **Step 4: Extend the import input type**

In `lib/data/imports.ts`, add to `ImportHouseholdInput` after `preferredLocale`:

```ts
  tags?: string[];
```

- [ ] **Step 5: Collect tags in `validateCsv`**

Inside the household-building loop, before the `households.push(...)` call:

```ts
    const tagSet = new Set<string>();
    for (const spec of mapping.tags ?? []) {
      for (const { row } of group.rows) {
        const raw = (row[spec.column] ?? "").trim();
        if (raw) tagSet.add(`${spec.prefix ?? ""}${raw}`);
      }
    }
```

Add `tags: tagSet.size > 0 ? [...tagSet] : undefined,` to the pushed object.

- [ ] **Step 6: Persist tags on insert**

In `lib/data/imports.ts` `commitHouseholds`, add to the `households` insert object:

```ts
        tags: input.tags ?? [],
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/csv lib/data/imports.ts
git commit -m "feat(import): map columns to household tags with optional prefixes"
```

---

### Task 5: Gap 4 — plus-one origin on named rows

**Files:**
- Modify: `lib/csv/types.ts`, `lib/csv/detect.ts`, `lib/csv/normalize.ts`, `lib/csv/validate.ts`, `lib/data/imports.ts`
- Test: `lib/csv/plus-one.test.ts` (create)

**Interfaces:**
- Consumes: `norm` from Task 1
- Produces: `isTruthy(v?: string): boolean` in `normalize.ts`; `CsvMapping.isPlusOne?: string`; `ImportHouseholdInput.guests[].origin?: "named" | "plus_one"`. A named row marked plus-one sets `origin` and does **not** increment `plusOneSlots`.

- [ ] **Step 1: Write the failing test**

Create `lib/csv/plus-one.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";
import { isTruthy } from "./normalize";

describe("isTruthy", () => {
  it("accepts common affirmative spellings", () => {
    for (const v of ["yes", "Y", "true", "1", "x", "Plus One", "plus-one", "+1"]) {
      expect(isTruthy(v)).toBe(true);
    }
  });

  it("rejects blanks and negatives", () => {
    for (const v of ["", "  ", "no", "false", "0", "Primary"]) {
      expect(isTruthy(v)).toBe(false);
    }
  });
});

describe("plus-one origin", () => {
  it("marks a named plus-one row without consuming a slot", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann & Guest,Ann,One,Primary
Group A,Ann & Guest,Guest,Person,Plus One
`,
    );
    const v = validateCsv(rows, { ...detectMapping(headers), isPlusOne: "Category" });
    const h = v.households[0];
    expect(h.guests).toHaveLength(2);
    expect(h.guests.find((g) => g.firstName === "Ann")!.origin).toBe("named");
    expect(h.guests.find((g) => g.firstName === "Guest")!.origin).toBe("plus_one");
    expect(h.plusOneSlots).toBe(0);
    expect(h.maxPartySize).toBe(2);
  });

  it("leaves origin undefined when no plus-one column is mapped", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].guests[0].origin).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/plus-one.test.ts`
Expected: FAIL — `isTruthy` is not exported.

- [ ] **Step 3: Add `isTruthy` to `lib/csv/normalize.ts`**

```ts
const AFFIRMATIVE = new Set(["yes", "y", "true", "t", "1", "x"]);

/** Affirmative cell value, or a plus-one marker phrase. */
export function isTruthy(v: string | undefined): boolean {
  const s = norm(v);
  if (!s) return false;
  if (AFFIRMATIVE.has(s)) return true;
  return s.includes("plus one") || s.includes("plus-one") || s.includes("+1");
}
```

- [ ] **Step 4: Extend the types**

In `lib/csv/types.ts` add `isPlusOne?: string;` to `CsvMapping`.

In `lib/data/imports.ts`, extend the guest shape in `ImportHouseholdInput`:

```ts
  guests: Array<{
    firstName: string;
    lastName: string;
    ageType?: "adult" | "child" | "infant";
    relationship?: string;
    origin?: "named" | "plus_one";
  }>;
```

- [ ] **Step 5: Set origin in `validateCsv`**

In the `guests: group.rows.map(...)` block, add:

```ts
        origin: mapping.isPlusOne
          ? isTruthy(row[mapping.isPlusOne])
            ? "plus_one"
            : "named"
          : undefined,
```

Import `isTruthy` from `./normalize`.

- [ ] **Step 6: Persist origin on insert**

In `lib/data/imports.ts` `commitHouseholds`, add to the guest insert mapping:

```ts
          origin: g.origin ?? "named",
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/csv lib/data/imports.ts
git commit -m "feat(import): mark named plus-one guests via a mapped column"
```

---

### Task 6: Gap 5 — mailing addresses

**Files:**
- Modify: `lib/csv/types.ts`, `lib/csv/detect.ts`, `lib/csv/validate.ts`, `lib/data/imports.ts`
- Test: `lib/csv/address.test.ts` (create)

**Interfaces:**
- Consumes: `cleanValue` from Task 1
- Produces: `MailingAddress = { raw?, street?, city?, state?, zip?, country?, source: "csv" | "save_the_date" }` exported from `lib/csv/types.ts`; `CsvMapping` gains `address?, street?, city?, state?, zip?, country?`; `ImportHouseholdInput.mailingAddress?: MailingAddress`. Free text is stored verbatim in `raw` and is never parsed.

- [ ] **Step 1: Write the failing test**

Create `lib/csv/address.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

describe("mailing address", () => {
  it("stores structured columns", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Street Address,City,State,Zip,Country
Ann,One,1 Main St,Springfield,CA,90001,USA
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress).toEqual({
      street: "1 Main St",
      city: "Springfield",
      state: "CA",
      zip: "90001",
      country: "USA",
      source: "csv",
    });
  });

  it("stores free text verbatim without parsing", () => {
    const messy = "114-0024  Japan Tokyo  Kita-ku, Nishigahara 1-46-14";
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Mailing Address\nAnn,One,"${messy}"\n`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress).toEqual({ raw: messy, source: "csv" });
  });

  it("takes the first row in the group that has address data", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Mailing Address
Group A,Ann,One,
Group A,Bob,One,2 Oak Ave
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress?.raw).toBe("2 Oak Ave");
  });

  it("omits the field entirely when no address data exists", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].mailingAddress).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/address.test.ts`
Expected: FAIL — `mailingAddress` is `undefined` in all cases.

- [ ] **Step 3: Add the `MailingAddress` type**

In `lib/csv/types.ts`:

```ts
export type MailingAddress = {
  raw?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  source: "csv" | "save_the_date";
};
```

Add to `CsvMapping`:

```ts
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
```

Re-export `MailingAddress` from `lib/csv/index.ts`.

- [ ] **Step 4: Auto-detect the address columns**

In `lib/csv/detect.ts`, add to the returned object:

```ts
    address: find("mailingaddress", "address", "fulladdress", "direccion") || undefined,
    street: find("streetaddress", "street", "address1", "addressline1") || undefined,
    city: find("city", "town", "ciudad") || undefined,
    state: find("state", "province", "region", "estado") || undefined,
    zip: find("zip", "zipcode", "postalcode", "postcode", "cp") || undefined,
    country: find("country", "pais") || undefined,
```

- [ ] **Step 5: Build the address in `validateCsv`**

Add a module-level helper in `lib/csv/validate.ts`:

```ts
function buildAddress(
  rows: Array<{ row: Record<string, string> }>,
  mapping: CsvMapping,
): MailingAddress | undefined {
  const fields = [
    ["raw", mapping.address],
    ["street", mapping.street],
    ["city", mapping.city],
    ["state", mapping.state],
    ["zip", mapping.zip],
    ["country", mapping.country],
  ] as const;
  for (const { row } of rows) {
    const built: Record<string, string> = {};
    for (const [key, column] of fields) {
      if (!column) continue;
      const value = cleanValue(row[column]);
      if (value) built[key] = value;
    }
    if (Object.keys(built).length > 0) return { ...built, source: "csv" };
  }
  return undefined;
}
```

Import `cleanValue` from `./normalize` and add `mailingAddress: buildAddress(group.rows, mapping),` to the pushed household.

- [ ] **Step 6: Persist the address**

In `lib/data/imports.ts`, add `mailingAddress?: MailingAddress;` to `ImportHouseholdInput` (importing the type from `@/lib/csv`), and add to the households insert:

```ts
        mailing_address: input.mailingAddress ?? null,
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/csv lib/data/imports.ts
git commit -m "feat(import): map mailing addresses, storing free text unparsed"
```

---

### Task 7: Gap 6 — meals, dietary restrictions, and notes

**Files:**
- Modify: `lib/csv/types.ts`, `lib/csv/detect.ts`, `lib/csv/validate.ts`, `lib/data/imports.ts`
- Test: `lib/csv/fields.test.ts` (create)

**Interfaces:**
- Consumes: `norm`, `cleanValue`
- Produces: `ImportContext = { events: Array<{id,name}>; mealOptions: Array<{id,name}> }` exported from `lib/csv/types.ts`. `validateCsv(rows, mapping, context?)` — third parameter optional, defaults to `{ events: [], mealOptions: [] }`, so all existing callers are unaffected. `CsvMapping` gains `meal?, dietary?, notes?`. `ImportHouseholdInput` gains `internalNotes?`; guests gain `dietaryRestrictions?` and `mealOptionId?`.

- [ ] **Step 1: Write the failing test**

Create `lib/csv/fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

const CONTEXT = {
  events: [],
  mealOptions: [
    { id: "meal-1", name: "Chicken" },
    { id: "meal-2", name: "Kids Meal" },
  ],
};

describe("meal, dietary and notes mapping", () => {
  it("resolves a meal name case-insensitively against the wedding's own options", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Meal Choice\nAnn,One,chicken\n`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.households[0].guests[0].mealOptionId).toBe("meal-1");
  });

  it("warns and leaves the meal unset when it does not match", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Meal Choice\nAnn,One,Lobster\n`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.ok).toBe(true);
    expect(v.households[0].guests[0].mealOptionId).toBeUndefined();
    expect(v.warnings.some((w) => w.message.includes("Lobster"))).toBe(true);
  });

  it("treats 'None' dietary values as no restriction", () => {
    const { headers, rows } = parseCsv(
      `First Name,Last Name,Dietary Restrictions
Ann,One,None
Bob,Two,Gluten-free
`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    const ann = v.households.find((h) => h.displayName === "Ann One")!;
    const bob = v.households.find((h) => h.displayName === "Bob Two")!;
    expect(ann.guests[0].dietaryRestrictions).toBeUndefined();
    expect(bob.guests[0].dietaryRestrictions).toBe("Gluten-free");
  });

  it("joins distinct notes across a household's rows", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Notes
Group A,Ann,One,Needs parking
Group A,Bob,One,Needs parking
Group A,Cal,One,Arriving late
`,
    );
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.households[0].internalNotes).toBe("Needs parking\nArriving late");
  });

  it("works with no context supplied", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/fields.test.ts`
Expected: FAIL — `validateCsv` takes two parameters; `mealOptionId` is undefined.

- [ ] **Step 3: Add `ImportContext` and the new mappings**

In `lib/csv/types.ts`:

```ts
export type ImportContext = {
  events: Array<{ id: string; name: string }>;
  mealOptions: Array<{ id: string; name: string }>;
};
```

Add to `CsvMapping`: `meal?: string; dietary?: string; notes?: string;`

Re-export `ImportContext` from `lib/csv/index.ts`.

- [ ] **Step 4: Auto-detect the columns**

In `lib/csv/detect.ts`:

```ts
    meal: find("mealchoice", "meal", "entree", "dinnerchoice") || undefined,
    dietary: find("dietaryrestrictions", "dietary", "diet", "restrictions") || undefined,
    notes: find("notes", "note", "comments", "notas") || undefined,
```

- [ ] **Step 5: Change the `validateCsv` signature**

```ts
const EMPTY_CONTEXT: ImportContext = { events: [], mealOptions: [] };

export function validateCsv(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  context: ImportContext = EMPTY_CONTEXT,
): CsvValidation {
```

- [ ] **Step 6: Resolve meals, dietary and notes**

Add a module-level helper:

```ts
const NO_RESTRICTION = new Set(["none", "n/a", "na", "no", "-"]);

function resolveMeal(
  value: string | undefined,
  context: ImportContext,
  line: number,
  warnings: RowError[],
): string | undefined {
  const wanted = norm(value);
  if (!wanted) return undefined;
  const hit = context.mealOptions.find((m) => norm(m.name) === wanted);
  if (hit) return hit.id;
  warnings.push({ line, message: `Meal "${value!.trim()}" doesn't match any meal option — left unset.` });
  return undefined;
}
```

In the guest mapping, add:

```ts
        dietaryRestrictions: (() => {
          const d = cleanValue(mapping.dietary ? row[mapping.dietary] : undefined);
          return d && !NO_RESTRICTION.has(norm(d)) ? d : undefined;
        })(),
        mealOptionId: mapping.meal ? resolveMeal(row[mapping.meal], context, line, warnings) : undefined,
```

The guest mapping callback must destructure `line` as well as `row`: change it to `group.rows.map(({ row, line }) => ({ ... }))`.

For notes, before the push:

```ts
    const noteSet = new Set<string>();
    if (mapping.notes) {
      for (const { row } of group.rows) {
        const n = cleanValue(row[mapping.notes]);
        if (n) noteSet.add(n);
      }
    }
```

Add `internalNotes: noteSet.size > 0 ? [...noteSet].join("\n") : undefined,` to the pushed household.

- [ ] **Step 7: Extend `ImportHouseholdInput` and persist**

In `lib/data/imports.ts` add `internalNotes?: string;` to the household and `dietaryRestrictions?: string; mealOptionId?: string;` to the guest shape. Add `internal_notes: input.internalNotes ?? null,` to the households insert and `dietary_restrictions: g.dietaryRestrictions ?? null,` to the guests insert.

Meal ids attach to responses, which Task 8 rewrites — for now, carry `mealOptionId` through without writing it, and add a `// wired to responses in Task 8` comment.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/csv lib/data/imports.ts
git commit -m "feat(import): map meals, dietary restrictions and notes"
```

---

### Task 8: Gap 7 — per-event invites and responses

**Files:**
- Modify: `lib/csv/types.ts`, `lib/csv/validate.ts`, `lib/data/imports.ts`
- Test: `lib/csv/events.test.ts` (create)

**Interfaces:**
- Consumes: `ImportContext` from Task 7
- Produces: `CsvMapping.events?: Array<{ column: string; eventId: string }>`; `ImportHouseholdInput.notInvitedEventIds?: string[]`; guests gain `attendingByEventId?: Record<string, "pending" | "yes" | "no">`. A not-invited value suppresses both the invite row and the response rows for that event.

- [ ] **Step 1: Write the failing test**

Create `lib/csv/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

const CONTEXT = {
  events: [
    { id: "ev-main", name: "Main" },
    { id: "ev-extra", name: "Extra" },
  ],
  mealOptions: [],
};

const CSV = `Household,First Name,Last Name,Main RSVP,Extra RSVP
Group A,Ann,One,Attending,Not Invited
Group A,Bob,One,Declined,Not Invited
Group B,Cal,Two,Pending,Attending
`;

const MAPPING_EVENTS = [
  { column: "Main RSVP", eventId: "ev-main" },
  { column: "Extra RSVP", eventId: "ev-extra" },
];

describe("per-event mapping", () => {
  it("translates rsvp values into per-event attendance", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, { ...detectMapping(headers), events: MAPPING_EVENTS }, CONTEXT);
    const a = v.households.find((h) => h.displayName === "Group A")!;
    expect(a.guests.find((g) => g.firstName === "Ann")!.attendingByEventId).toEqual({
      "ev-main": "yes",
    });
    expect(a.guests.find((g) => g.firstName === "Bob")!.attendingByEventId).toEqual({
      "ev-main": "no",
    });
  });

  it("records a not-invited event on the household", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, { ...detectMapping(headers), events: MAPPING_EVENTS }, CONTEXT);
    const a = v.households.find((h) => h.displayName === "Group A")!;
    const b = v.households.find((h) => h.displayName === "Group B")!;
    expect(a.notInvitedEventIds).toEqual(["ev-extra"]);
    expect(b.notInvitedEventIds ?? []).toEqual([]);
    expect(b.guests[0].attendingByEventId).toEqual({ "ev-main": "pending", "ev-extra": "yes" });
  });

  it("omits event data entirely when no event columns are mapped", () => {
    const { headers, rows } = parseCsv(CSV);
    const v = validateCsv(rows, detectMapping(headers), CONTEXT);
    expect(v.households[0].notInvitedEventIds).toBeUndefined();
    expect(v.households[0].guests[0].attendingByEventId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/events.test.ts`
Expected: FAIL — `events` is not a property of `CsvMapping`.

- [ ] **Step 3: Extend the types**

`lib/csv/types.ts` — add to `CsvMapping`:

```ts
  events?: Array<{ column: string; eventId: string }>;
```

`lib/data/imports.ts` — add `notInvitedEventIds?: string[];` to the household and `attendingByEventId?: Record<string, "pending" | "yes" | "no">;` to the guest shape.

- [ ] **Step 4: Add the value translator**

In `lib/csv/validate.ts`:

```ts
const NOT_INVITED = new Set(["not invited", "notinvited", "n/a", "excluded"]);

function toAttending(value: string | undefined): "pending" | "yes" | "no" | "not_invited" {
  const s = norm(value);
  if (!s) return "pending";
  if (NOT_INVITED.has(s)) return "not_invited";
  if (s === "attending" || s === "yes" || s === "y" || s === "accepted") return "yes";
  if (s === "declined" || s === "no" || s === "n" || s === "regrets") return "no";
  return "pending";
}
```

- [ ] **Step 5: Build per-household and per-guest event data**

Before the push, compute the not-invited set from the household's first row:

```ts
    const notInvited: string[] = [];
    for (const spec of mapping.events ?? []) {
      if (toAttending(first.row[spec.column]) === "not_invited") notInvited.push(spec.eventId);
    }
```

In the guest mapping:

```ts
        attendingByEventId: mapping.events
          ? Object.fromEntries(
              mapping.events
                .filter((spec) => !notInvited.includes(spec.eventId))
                .map((spec) => [spec.eventId, toAttending(row[spec.column]) as "pending" | "yes" | "no"]),
            )
          : undefined,
```

Add `notInvitedEventIds: mapping.events ? notInvited : undefined,` to the pushed household.

- [ ] **Step 6: Honour invites in `commitHouseholds`**

In `lib/data/imports.ts`, replace the unconditional invite/response block with:

```ts
    const notInvited = new Set(input.notInvitedEventIds ?? []);
    const invitedEventIds = eventIds.filter((id) => !notInvited.has(id));

    if (invitedEventIds.length) {
      await scope.db.from("household_event_invites").insert(
        invitedEventIds.map((eventId) => ({
          household_id: hh.id,
          event_id: eventId,
          wedding_id: scope.weddingId,
        })),
      );
      await scope.db.from("guest_event_responses").insert(
        (guests ?? []).flatMap((g: { id: string }, i: number) =>
          invitedEventIds.map((eventId) => ({
            guest_id: g.id,
            event_id: eventId,
            wedding_id: scope.weddingId,
            attending: input.guests[i]?.attendingByEventId?.[eventId] ?? "pending",
            meal_option_id: input.guests[i]?.mealOptionId ?? null,
          })),
        ),
      );
    }
```

This also completes the Task 7 meal wiring.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/csv lib/data/imports.ts
git commit -m "feat(import): per-event invites and rsvp values from mapped columns"
```

---

### Task 9: Gap 8 — transactional commit + persisted dry run

The only task that touches SQL. There is no database test harness in this repo (vitest is `environment: "node"` over `lib/**` pure functions), so this task is verified by a real run against the dev project, not by a unit test. Do not fabricate a passing DB unit test.

**This task supersedes the TypeScript insert edits made in Tasks 4–8.** Those tasks each added one field to the row-by-row insert in `commitHouseholds`; this task replaces that whole function with a single RPC call, and the SQL below covers every field. The duplication is deliberate: it keeps each intermediate task's importer fully functional, so no commit in the sequence silently drops data. Expect to delete the per-field insert lines you wrote earlier — that is correct, not a mistake.

**Files:**
- Create: `supabase/migrations/0003_import_rpc.sql`, `scripts/verify-import-rpc.mjs`
- Modify: `lib/data/imports.ts`

**Interfaces:**
- Consumes: `ImportHouseholdInput` as extended by Tasks 4–8
- Produces: Postgres function `import_households(p_wedding_id uuid, p_run_id uuid, p_households jsonb) returns jsonb` (`{households, guests}`), called by `commitHouseholds`. `createRun(scope, filename)` gains a `status` argument defaulting to `'pending'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_import_rpc.sql`. The function body loops the JSON array inserting households, guests, invites and responses. Because it is a single function invocation, Postgres wraps it in one transaction — any failure rolls the whole import back.

```sql
create or replace function import_households(
  p_wedding_id uuid,
  p_run_id uuid,
  p_households jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hh jsonb;
  g jsonb;
  new_household_id uuid;
  new_guest_id uuid;
  ev record;
  household_count int := 0;
  guest_count int := 0;
  not_invited jsonb;
begin
  for hh in select * from jsonb_array_elements(p_households) loop
    insert into households (
      wedding_id, display_name, primary_contact_name, email, phone,
      mailing_address, max_party_size, plus_one_slots, preferred_locale,
      tags, internal_notes, invite_code, access_token
    ) values (
      p_wedding_id,
      hh->>'displayName',
      hh->>'primaryContactName',
      hh->>'email',
      hh->>'phone',
      hh->'mailingAddress',
      (hh->>'maxPartySize')::int,
      (hh->>'plusOneSlots')::int,
      coalesce(hh->>'preferredLocale', 'en'),
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(hh->'tags')),
        '{}'
      ),
      hh->>'internalNotes',
      hh->>'inviteCode',
      hh->>'accessToken'
    ) returning id into new_household_id;

    household_count := household_count + 1;
    not_invited := coalesce(hh->'notInvitedEventIds', '[]'::jsonb);

    for ev in
      select id from events
      where wedding_id = p_wedding_id
        and not (not_invited ? id::text)
    loop
      insert into household_event_invites (household_id, event_id, wedding_id)
      values (new_household_id, ev.id, p_wedding_id);
    end loop;

    for g in select * from jsonb_array_elements(hh->'guests') loop
      insert into guests (
        wedding_id, household_id, first_name, last_name,
        age_type, relationship, origin, dietary_restrictions
      ) values (
        p_wedding_id,
        new_household_id,
        g->>'firstName',
        g->>'lastName',
        coalesce(g->>'ageType', 'adult'),
        g->>'relationship',
        coalesce(g->>'origin', 'named'),
        g->>'dietaryRestrictions'
      ) returning id into new_guest_id;

      guest_count := guest_count + 1;

      for ev in
        select id from events
        where wedding_id = p_wedding_id
          and not (not_invited ? id::text)
      loop
        insert into guest_event_responses (guest_id, event_id, wedding_id, attending, meal_option_id)
        values (
          new_guest_id,
          ev.id,
          p_wedding_id,
          coalesce(g->'attendingByEventId'->>ev.id::text, 'pending'),
          nullif(g->>'mealOptionId', '')::uuid
        );
      end loop;
    end loop;
  end loop;

  update imports set status = 'committed',
    stats = jsonb_build_object('households', household_count, 'guests', guest_count)
  where id = p_run_id and wedding_id = p_wedding_id;

  return jsonb_build_object('households', household_count, 'guests', guest_count);
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool, or the service-role key from `.env.local`. **Before applying, confirm you are targeting the correct project** — the local Supabase CLI and MCP are linked to the wrong account (`docs/HANDOFF.md`).

- [ ] **Step 3: Generate codes in TypeScript, then call the RPC**

Rewrite `commitHouseholds` in `lib/data/imports.ts`. Invite codes and access tokens stay in TS (they already use `nanoid` + `crypto`), so the payload arrives complete:

```ts
export async function commitHouseholds(
  scope: WeddingScope,
  runId: string,
  inputs: ImportHouseholdInput[],
  actorId?: string,
): Promise<{ households: number; guests: number }> {
  const payload = inputs.map((input) => ({
    ...input,
    inviteCode: newInviteCode(),
    accessToken: newAccessToken(),
  }));

  const { data, error } = await scope.db.rpc("import_households", {
    p_wedding_id: scope.weddingId,
    p_run_id: runId,
    p_households: payload,
  });
  if (error) throw new Error(error.message);

  const result = data as { households: number; guests: number };
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "import.completed",
    payload: { runId, ...result },
  });
  return result;
}
```

- [ ] **Step 4: Let `createRun` record a dry run**

```ts
export async function createRun(
  scope: WeddingScope,
  filename: string,
  status: "pending" | "validated" = "pending",
  stats?: unknown,
): Promise<{ id: string }> {
  const { data, error } = await scope.db
    .from("imports")
    .insert({ wedding_id: scope.weddingId, filename, status, stats: stats ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}
```

- [ ] **Step 5: Write the verification script**

Create `scripts/verify-import-rpc.mjs`. It must prove two things against the dev database: a good payload commits fully, and a bad payload writes nothing.

```js
// Usage: node scripts/verify-import-rpc.mjs
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const WEDDING = "11111111-1111-1111-1111-111111111111";

const count = async () =>
  (await db.from("households").select("id", { count: "exact", head: true }).eq("wedding_id", WEDDING)).count;

const before = await count();

const { data: run } = await db
  .from("imports")
  .insert({ wedding_id: WEDDING, filename: "rpc-verify.csv", status: "validated" })
  .select("id")
  .single();

// Rollback check: second household has a null display_name, violating NOT NULL.
const bad = [
  { displayName: "RPC Verify Good", maxPartySize: 1, plusOneSlots: 0, tags: [], guests: [{ firstName: "A", lastName: "B" }], inviteCode: "VRFY-0001", accessToken: "verify-token-0001" },
  { displayName: null, maxPartySize: 1, plusOneSlots: 0, tags: [], guests: [], inviteCode: "VRFY-0002", accessToken: "verify-token-0002" },
];
const { error: badErr } = await db.rpc("import_households", {
  p_wedding_id: WEDDING, p_run_id: run.id, p_households: bad,
});
const afterBad = await count();
console.log(badErr ? "rollback: errored as expected" : "rollback: NO ERROR — FAIL");
console.log(afterBad === before ? "rollback: no rows written — PASS" : `rollback: leaked ${afterBad - before} rows — FAIL`);

// Success check.
const good = [
  { displayName: "RPC Verify Household", maxPartySize: 2, plusOneSlots: 1, tags: ["verify"], guests: [{ firstName: "Ver", lastName: "Ify" }], inviteCode: "VRFY-0003", accessToken: "verify-token-0003" },
];
const { data: ok, error: okErr } = await db.rpc("import_households", {
  p_wedding_id: WEDDING, p_run_id: run.id, p_households: good,
});
console.log(okErr ? `commit: FAILED ${okErr.message}` : `commit: PASS ${JSON.stringify(ok)}`);

// Clean up.
await db.from("households").delete().eq("wedding_id", WEDDING).like("display_name", "RPC Verify%");
await db.from("imports").delete().eq("id", run.id);
console.log("cleaned up");
```

- [ ] **Step 6: Run the verification**

Run: `node scripts/verify-import-rpc.mjs`
Expected output: `rollback: errored as expected`, `rollback: no rows written — PASS`, `commit: PASS {"households":1,"guests":1}`, `cleaned up`.

If the rollback line reports leaked rows, the function is not atomic — stop and fix before continuing.

- [ ] **Step 7: Run the unit suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0003_import_rpc.sql scripts/verify-import-rpc.mjs lib/data/imports.ts
git commit -m "feat(import): commit through a transactional RPC, persist dry runs"
```

---

### Task 10: Wire the new mappings into the wizard

**Files:**
- Modify: `components/admin/ImportWizard.tsx`, `app/admin/(dashboard)/imports/actions.ts`
- Read first: `node_modules/next/dist/docs/` for server-action conventions in this Next.js version

**Interfaces:**
- Consumes: everything from Tasks 2–9
- Produces: server action `validateCsvImport(filename, rows, mapping)` returning `{ runId, households, guests, errors, warnings }`; `commitCsvImport(runId, rows, mapping)` now takes a `runId` from the dry run.

- [ ] **Step 1: Add `loadImportContext` to the data layer**

Create it in `lib/data/imports.ts` so both server actions share one definition:

```ts
import type { ImportContext } from "@/lib/csv";

export async function loadImportContext(scope: WeddingScope): Promise<ImportContext> {
  const [{ data: events }, { data: meals }] = await Promise.all([
    scope.db.from("events").select("id, name").eq("wedding_id", scope.weddingId).order("sort_order"),
    scope.db.from("meal_options").select("id, name").eq("wedding_id", scope.weddingId).order("sort_order"),
  ]);
  return { events: events ?? [], mealOptions: meals ?? [] };
}
```

- [ ] **Step 2: Pass the events list into the wizard**

In `app/admin/(dashboard)/imports/page.tsx`, make the component async and load the context, following the `requireEditor` + `forWedding` pattern already used in `actions.ts`:

```tsx
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { loadImportContext } from "@/lib/data/imports";

export default async function ImportsPage() {
  const admin = await requireEditor();
  const context = await loadImportContext(forWedding(admin.weddingId));
  // ...
  //   <ImportWizard events={context.events} />
}
```

`ImportWizard` gains `{ events }: { events: Array<{ id: string; name: string }> }`. Meal options are not needed client-side — the server action resolves meal names at validate time.

- [ ] **Step 3: Add the single-column mapping controls**

Extend `MAPPING_FIELDS` in `ImportWizard.tsx`:

```ts
  { key: "envelope", label: "Envelope / invitation name" },
  { key: "isPlusOne", label: "Plus-one marker" },
  { key: "address", label: "Mailing address (free text)" },
  { key: "street", label: "Street" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "Zip" },
  { key: "country", label: "Country" },
  { key: "meal", label: "Meal choice" },
  { key: "dietary", label: "Dietary restrictions" },
  { key: "notes", label: "Notes" },
```

`MAPPING_FIELDS` is typed `Array<{ key: keyof CsvMapping; ... }>`, and `tags` and `events` are arrays rather than `string`, so they must be excluded from it. Narrow the type:

```ts
type SingleColumnKey = Exclude<keyof CsvMapping, "tags" | "events">;
const MAPPING_FIELDS: Array<{ key: SingleColumnKey; label: string; required?: boolean }> = [ /* ... */ ];
```

and change `remap`'s signature to `(key: SingleColumnKey, value: string)`.

- [ ] **Step 4: Add the tag-column control**

Tags are a list of `{ column, prefix? }`, so they need their own control — a checkbox per header plus a prefix input on the checked ones:

```tsx
function TagPicker({
  headers,
  value,
  onChange,
}: {
  headers: string[];
  value: Array<{ column: string; prefix?: string }>;
  onChange: (next: Array<{ column: string; prefix?: string }>) => void;
}) {
  const toggle = (column: string) =>
    onChange(
      value.some((t) => t.column === column)
        ? value.filter((t) => t.column !== column)
        : [...value, { column }],
    );
  const setPrefix = (column: string, prefix: string) =>
    onChange(value.map((t) => (t.column === column ? { ...t, prefix: prefix || undefined } : t)));

  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold tracking-wide text-[#6b7167]">TAG COLUMNS</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {headers.map((h) => {
          const picked = value.find((t) => t.column === h);
          return (
            <span key={h} className="flex items-center gap-1.5 rounded-lg border border-[#dddbd0] px-2.5 py-1.5">
              <input type="checkbox" checked={!!picked} onChange={() => toggle(h)} />
              <span className="text-[12.5px]">{h}</span>
              {picked && (
                <input
                  type="text"
                  placeholder="prefix"
                  value={picked.prefix ?? ""}
                  onChange={(e) => setPrefix(h, e.target.value)}
                  className="w-20 rounded border border-[#dddbd0] px-1.5 py-0.5 text-[11.5px]"
                />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the per-event control**

One row per event, each choosing which CSV column carries that event's RSVP:

```tsx
function EventPicker({
  headers,
  events,
  value,
  onChange,
}: {
  headers: string[];
  events: Array<{ id: string; name: string }>;
  value: Array<{ column: string; eventId: string }>;
  onChange: (next: Array<{ column: string; eventId: string }>) => void;
}) {
  const set = (eventId: string, column: string) =>
    onChange(
      column
        ? [...value.filter((e) => e.eventId !== eventId), { eventId, column }]
        : value.filter((e) => e.eventId !== eventId),
    );

  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold tracking-wide text-[#6b7167]">RSVP COLUMN PER EVENT</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {events.map((ev) => (
          <label key={ev.id} className="flex items-center gap-1.5 text-[12.5px]">
            {ev.name}
            <select
              value={value.find((e) => e.eventId === ev.id)?.column ?? ""}
              onChange={(e) => set(ev.id, e.target.value)}
              className="rounded-lg border border-[#dddbd0] bg-white px-2 py-1.5 text-[12.5px]"
            >
              <option value="">—</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
```

Render both pickers inside the existing `{mapping && headers.length > 0 && (...)}` block, after the `MAPPING_FIELDS` grid. Wire each to `setMapping` plus a re-validate, mirroring `remap`.

- [ ] **Step 6: Implement the server actions**

Replace the contents of `app/admin/(dashboard)/imports/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as importsData from "@/lib/data/imports";
import { validateCsv, type CsvMapping, type RowError } from "@/lib/csv";

export type ValidateResult =
  | { ok: true; runId: string; households: number; guests: number; warnings: RowError[] }
  | { ok: false; errors: RowError[]; warnings: RowError[] };

export type CommitResult =
  | { ok: true; households: number; guests: number }
  | { ok: false; errors: RowError[] };

/** Dry run: persists an `imports` row with status 'validated', writes no domain data. */
export async function validateCsvImport(
  filename: string,
  rows: Record<string, string>[],
  mapping: CsvMapping,
): Promise<ValidateResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const context = await importsData.loadImportContext(scope);
  const validation = validateCsv(rows, mapping, context);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  const stats = {
    households: validation.households.length,
    guests: validation.households.reduce((n, h) => n + h.guests.length, 0),
  };
  const run = await importsData.createRun(scope, filename, "validated", stats);
  return { ok: true, runId: run.id, ...stats, warnings: validation.warnings };
}

/** Commits a previously validated run. Re-validates server-side against the same context. */
export async function commitCsvImport(
  runId: string,
  rows: Record<string, string>[],
  mapping: CsvMapping,
): Promise<CommitResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const context = await importsData.loadImportContext(scope);

  const validation = validateCsv(rows, mapping, context);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  try {
    const result = await importsData.commitHouseholds(scope, runId, validation.households, admin.userId);
    revalidatePath("/admin/guests");
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    await importsData.finishRun(scope, runId, "failed", null, { message });
    return { ok: false, errors: [{ line: 0, message }] };
  }
}
```

Note `commitHouseholds` already sets the run to `committed` inside the RPC (Task 9), so no `finishRun` call is needed on the success path.

- [ ] **Step 7: Add the explicit dry-run step to the wizard**

The live client-side preview stays as instant feedback while remapping. Add a **Run dry run** button that calls `validateCsvImport` and stores the returned `runId` in state:

```tsx
const [runId, setRunId] = useState<string | null>(null);

function dryRun() {
  if (!mapping) return;
  startTransition(async () => {
    const r = await validateCsvImport(filename, rows, mapping);
    setRunId(r.ok ? r.runId : null);
    setResult(r.ok ? null : { ok: false, errors: r.errors });
  });
}
```

Every call to `remap` (and the two pickers' `onChange`) must also `setRunId(null)`, so a mapping change invalidates the dry run. The **Commit import** button's `disabled` becomes `!runId || pending`, and `commit()` calls `commitCsvImport(runId, rows, mapping)`.

- [ ] **Step 8: Verify in the running app**

```bash
npm run dev            # port 3006
npm run dev:login      # prints a direct admin sign-in URL
```

Open `/admin/imports`, upload a small CSV exercising envelope grouping, a blank-name row, a tag column, and an address column. Confirm the preview counts, run the dry run, commit, then check `/admin/guests` shows the households with correct party sizes and tags.

To free port 3006 if occupied: `lsof -ti:3006 | xargs kill`. Never use a name-based kill.

- [ ] **Step 9: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add components/admin/ImportWizard.tsx "app/admin/(dashboard)/imports"
git commit -m "feat(import): expose new mappings and an explicit dry-run step in the wizard"
```

---

### Task 11: Tenant-agnostic guard test

Makes the Global Constraint enforceable rather than aspirational.

**Files:**
- Test: `lib/csv/generality.test.ts` (create)

**Interfaces:**
- Consumes: the full public surface
- Produces: nothing consumed downstream

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parseCsv, detectMapping, validateCsv } from "./index";

const FORBIDDEN = ["Le 1", "Envelope Name", "A List", "Plus One", "Baby", "Wedding RSVP", "Juliet", "Juan"];

describe("tenant agnosticism", () => {
  it("contains no wedding-specific literals in importer source", () => {
    const dir = path.resolve(__dirname);
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(dir, f));
    sources.push(path.resolve(__dirname, "../data/imports.ts"));

    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const literal of FORBIDDEN) {
        if (text.includes(literal)) offenders.push(`${path.basename(file)}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports a CSV with entirely unrelated column names", () => {
    const csv = `Party,Mail To,Guest,Surname,Segment,Meal
Table Group 1,Smith Residence,Ana,Silva,VIP,Steak
Table Group 1,Smith Residence,Bruno,Silva,VIP,Salmon
Table Group 1,Smith Residence,,,,
`;
    const { headers, rows } = parseCsv(csv);
    const mapping = {
      firstName: "Guest",
      lastName: "Surname",
      household: "Party",
      envelope: "Mail To",
      meal: "Meal",
      tags: [{ column: "Segment" }],
    };
    const context = {
      events: [],
      mealOptions: [{ id: "m1", name: "Steak" }, { id: "m2", name: "Salmon" }],
    };
    const v = validateCsv(rows, mapping, context);
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.households[0].displayName).toBe("Smith Residence");
    expect(v.households[0].guests).toHaveLength(2);
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(3);
    expect(v.households[0].tags).toEqual(["VIP"]);
    expect(v.households[0].guests[0].mealOptionId).toBe("m1");
    expect(headers).toContain("Segment");
    expect(detectMapping(headers).firstName).toBe("");
  });

  it("still imports a bare first/last-name CSV with no optional mappings", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\nBob,Two\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run lib/csv/generality.test.ts`
Expected: PASS. If the literal check fails, remove the offending literal from source — it belongs in a fixture.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 4: Commit**

```bash
git add lib/csv/generality.test.ts
git commit -m "test(import): guard tenant agnosticism and bare-CSV compatibility"
```

---

### Task 12: Under-populated envelope warning

The spec's safeguard against silently dropping a guest: an envelope naming more people than it has rows. Warning only, never an error — envelope names are free text and false positives are expected.

**Files:**
- Modify: `lib/csv/validate.ts`
- Test: `lib/csv/envelope-warning.test.ts` (create)

**Interfaces:**
- Consumes: grouping from Task 2, slot counting from Task 3
- Produces: `countEnvelopeNames(envelope: string): number` exported from `lib/csv/normalize.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";
import { countEnvelopeNames } from "./normalize";

describe("countEnvelopeNames", () => {
  it("counts ampersand and comma separated names", () => {
    expect(countEnvelopeNames("Ann One")).toBe(1);
    expect(countEnvelopeNames("Ann One & Bob Two")).toBe(2);
    expect(countEnvelopeNames("Ann, Bob, Cal & Dee")).toBe(4);
    expect(countEnvelopeNames("Ann One and Bob Two")).toBe(2);
  });

  it("ignores a dangling separator", () => {
    expect(countEnvelopeNames("Ann One &")).toBe(1);
    expect(countEnvelopeNames("Ann One & ")).toBe(1);
  });

  it("returns zero for blanks", () => {
    expect(countEnvelopeNames("")).toBe(0);
    expect(countEnvelopeNames("   ")).toBe(0);
  });
});

describe("under-populated envelope warning", () => {
  it("warns when an envelope names more people than it has seats", () => {
    // Four names, three seats — the third person has no row.
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group A,"Ann, Bob, Cal & Dee",Ann,One
Group A,"Ann, Bob, Cal & Dee",Bob,One
Group A,"Ann, Bob, Cal & Dee",Dee,One
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.warnings.some((w) => w.message.includes("names 4") && w.message.includes("3"))).toBe(true);
  });

  it("counts plus-one slots as seats", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group B,Ann One & Guest,Ann,One
Group B,Ann One & Guest,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.warnings.filter((w) => w.message.includes("names"))).toHaveLength(0);
  });

  it("does not warn when the counts agree", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group C,Ann One & Bob Two,Ann,One
Group C,Ann One & Bob Two,Bob,Two
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.warnings.filter((w) => w.message.includes("names"))).toHaveLength(0);
  });

  it("never warns when no envelope column is mapped", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.warnings.filter((w) => w.message.includes("names"))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/envelope-warning.test.ts`
Expected: FAIL — `countEnvelopeNames` is not exported.

- [ ] **Step 3: Implement the counter**

Add to `lib/csv/normalize.ts`:

```ts
/**
 * Rough count of how many people an envelope name refers to.
 * "Ann, Bob & Cal" -> 3. Deliberately naive: used only to raise a warning.
 */
export function countEnvelopeNames(envelope: string | undefined): number {
  const t = (envelope ?? "").trim();
  if (!t) return 0;
  return t
    .split(/\s*(?:&|,|\band\b|\+)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}
```

- [ ] **Step 4: Emit the warning**

In `lib/csv/validate.ts`, inside the household-building loop after `maxPartySize` is computed:

```ts
    if (mapping.envelope) {
      const named = countEnvelopeNames(first.row[mapping.envelope]);
      const seats = group.rows.length + group.blankRows;
      if (named > seats) {
        warnings.push({
          line: first.line,
          message: `"${displayName}" names ${named} people but has only ${seats} row${seats === 1 ? "" : "s"} — someone may be missing.`,
        });
      }
    }
```

Import `countEnvelopeNames` from `./normalize`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/csv
git commit -m "feat(import): warn when an envelope names more people than it has rows"
```

---

### Task 13: Import the master guest list (operational)

**Blocked until** a CSV export of the MASTER WEDDING LIST *Guest List* tab is available. The sheet (`1M_B0aCWzn1OIO5vmfdWBLDaL5NZgWCy9GsNYt-RNgBI`) is owned by julietle24@gmail.com.

**Files:**
- Create: `supabase/migrations/0004_rehearsal_dinner_event.sql`

**Interfaces:**
- Consumes: the finished importer
- Produces: populated `households` / `guests` for the Juliet & Juan wedding

- [ ] **Step 1: Add the Rehearsal Dinner event and the missing meal option**

Wedding-specific *data*, not code — event CRUD UI is a separate spec.

```sql
insert into events (wedding_id, name, sort_order)
values ('11111111-1111-1111-1111-111111111111', 'Rehearsal Dinner', 2);

insert into meal_options (wedding_id, name, is_kids_meal, sort_order)
values ('11111111-1111-1111-1111-111111111111', 'No Meal Needed', false, 6);
```

- [ ] **Step 2: Export the Guest List tab to CSV**

File → Download → Comma-separated values, from the Guest List tab only. Save outside the repo (it contains PII and must not be committed).

- [ ] **Step 3: Upload and map**

At `/admin/imports`, set: First name → `First Name`, Last name → `Last Name`, Household → `Household`, Envelope → `Envelope Name`, Age type → `List`, Plus-one marker → `List`, Tags → `List` (no prefix) and `Household` (prefix `family:`), Street/City/State/Zip/Country → their columns, Meal → `Meal Choice`, Dietary → `Dietary Restrictions`, Notes → `Notes`, Events → Ceremony=`Wedding RSVP`, Reception=`Wedding RSVP`, Rehearsal Dinner=`Rehearsal Dinner RSVP`.

- [ ] **Step 4: Check the dry run against known expectations**

Before committing, confirm from the preview:
- `Le 1 Household` produced **7** households, not 1
- `Boyd Household` produced **2**
- Total households is meaningfully above 116 (envelope-level, ~140 expected)
- The `Susan, Annabelle, Zion & Dustin` envelope shows **3** guests — Zion has no row in the sheet and must be added by hand afterward
- Households whose Rehearsal Dinner column reads `Not Invited` show no rehearsal invite

If any of these are wrong, stop and fix the importer — do not commit.

- [ ] **Step 5: Commit the import, then spot-check**

Commit in the wizard, then open `/admin/guests` and verify a household from each shape: a couple, a large family, one with a plus-one slot, one marked not-invited to the rehearsal.

- [ ] **Step 6: Commit the migration**

```bash
git add supabase/migrations/0004_rehearsal_dinner_event.sql
git commit -m "feat: add Rehearsal Dinner event and No Meal Needed option"
```

---

## Not in this plan

Plan B covers the recurring Save-the-Date sync: Google service account, Vercel Cron, the `sheet_submissions` table, the fuzzy matcher, and the admin review inbox. It depends on this plan being complete, because the matcher enriches households this importer creates.
