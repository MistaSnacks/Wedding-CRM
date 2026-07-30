# GOAL — Budget & Vendor Management for Juliet and Juan's wedding CRM

> **This file is the contract and the ledger.** It is the single source of truth for what "done"
> means, and it is where progress is recorded. Read it top to bottom at the start of every
> iteration. Update the checkboxes as you finish work — with evidence, not optimism.

**Repo:** `/Users/admin/guest-crm` · **Branch:** `feat/budget-vendors` · **Dev server:** port 3006
**Started:** 2026-07-29 · **Owner:** Camren (asleep — this runs unattended)

---

## What we are building and why

Juliet and Juan are getting married. The app already runs their real wedding: ~200 guests,
household-level RSVPs, per-event invites, a drag-and-drop seating chart, meal and dietary counts,
guest communications, a bilingual guest-facing RSVP flow, and an import review inbox. What it does
not have is money.

Right now the budget lives in a spreadsheet, and the vendors live in Juliet's head and her inbox.
The spreadsheet is genuinely good — good enough that it tells us exactly what to build. Its columns
are `Item, Qty, Each, Alisons Wedding Actual Cost, Juliet Estimated Cost, Juliet Actual Cost, Notes`.
Juliet is not just tracking what she spends. She is forecasting against a **real wedding that
already happened** — her friend Alison's, which came in at **$40,962** — and using it to sanity-check
her own forecast, category by category. (The sheet's stated total is $60,170, but that figure
excludes the Flights category; the eleven allocations actually sum to $62,970. Compute the total,
never hardcode either number — see Binding Decisions.)

That comparison is the whole idea. Every commercial tool seeds your budget from a national average
or a made-up calculator, and wedding planners publicly rubbish those numbers as fantasy — $50 a head
for catering against a real $150–250, $1–3k for photography against a real $4.5–8k. Juliet has
something better than an average: she has one real wedding's real receipts. **Keep the benchmark
column in front of her at all times.** It is the feature.

Two people use this. It is not a SaaS product. There are no leads, no proposals, no profit-and-loss,
no client portals. There is one wedding and a hard date.

## The bar

Better than what she could have bought. Concretely, that means beating these specific failures,
each of which is documented in the research and each of which we structurally avoid:

| What the commercial tools get wrong | What we do instead |
| --- | --- |
| The Knot's budget tool has no payment ledger — no installments, no deposits, no due dates. Couples go back to the spreadsheet. | A real ledger: every item carries its own payment schedule with due dates and paid-on dates. |
| Zola and The Knot seed from invented averages. | Seed from Alison's actual receipts, shown inline next to every number Juliet enters. |
| The Knot and Joy don't link vendors to the budget at all. | Booking a vendor writes its contracted price to the budget line — visibly, never silently. |
| Old Knot budgeter's fixed categories made couples feel "pigeon-holed". | Categories and items are per-wedding rows. Juliet's own structure wins over any generic taxonomy. |
| Nobody lets you attach the contract or the receipt to the line item. | A contract link on every vendor and a receipt link on every payment. |
| Zola A/B-tested hiding estimated-vs-actual behind a toggle. Users hated it. | Adjacent columns. Always. Never a tab. |
| Reminders that require opening the app. | Due dates surface on the Overview and in email, on the venue's calendar, not the server's. |
| Aisle Planner and Planning Pod do all of this but are planner-facing and clunky. | Warm and editorial, addressed to a bride, on a phone, standing in a venue. |

## How to read this document

- **Milestones run in order.** Milestone 0 blocks everything. Do not start Milestone 2 with
  Milestone 1 unchecked.
- **Every checkbox has a "Done when:"** clause. That clause is the definition of done — a command's
  output, a query result, or something observable in a browser. A checkbox is checked only after
  you have personally observed that proof in this iteration.
- **The sections after the milestones are reference**, not work: the data model, the screen specs,
  the copy decks, the seed mapping. Consult them; do not re-derive them.
- **Open questions are at the bottom.** They are deliberately unanswered. Do not guess at them, do
  not silently pick an answer, and do not let one block a milestone — build the accommodating thing
  and add a note to the list for Juliet.

---

## Binding decisions — these override everything below

The reference sections were drafted independently and **they contradict each other in a dozen places**.
Where a reference section disagrees with this list, **this list wins**. Do not re-open these. Do not
average them. If you find a contradiction that is not listed here, resolve it in favour of the
simplest option that keeps the gates green, and add it to this list in the same iteration.

1. **The total budget lives in `weddings.budget_total_cents`** (nullable `bigint`, added by an
   additive `alter`). There is **no `budget_settings` table** — one reference section invents one;
   ignore that. Alongside it: `weddings.budget_currency text not null default 'USD'` and
   `weddings.budget_benchmark_label text not null default 'Reference wedding'`.

2. **The benchmark label is never hardcoded.** It is read from
   `weddings.budget_benchmark_label`. A case-insensitive grep for `alison` in **non-test** source
   (`app/`, `components/`, `lib/`, excluding `*.test.ts`) must return zero hits. Scope it that
   way: a repo-wide grep also matches guest-name fixtures, because Alison is herself an invited
   guest on this list — 18 legitimate hits in existing tests. Seeding sets the label to `Alison's wedding`;
   the code never knows that name. This also lets Juliet rename it if sharing the screen feels
   awkward.

3. **Benchmark is stored at both levels.** `budget_items.benchmark_cents` is primary;
   `budget_categories.benchmark_cents` is a **nullable override** used only when present, because
   the real spreadsheet's category totals do not reconcile with the sum of their children. Rule:
   `categoryBenchmark = category.benchmark_cents ?? sum(item.benchmark_cents)`. `null` means
   unknown and renders as `—`; `0` means genuinely spent nothing. Never conflate the two.

4. **There is no `actual_cents` column.** Actual spend is always
   `sum(amount_cents) where paid_at is not null`. Payment status
   (`unpaid | partial | paid | overdue`) is always derived. Storing either invites drift and is
   forbidden.

5. **Category money columns are `target_cents` and the nullable `benchmark_cents` override, and
   nothing else.** Category forecast = sum of its items' forecasts, falling back to `target_cents`
   only when the category has **zero** items. Never add the two together.

6. **Attachments are URL columns, not a table and not file upload.** `vendors.contract_url` and
   `budget_payments.receipt_url`, both nullable `text`. There is no Blob or Storage integration
   configured in this project and tonight is not when to add one. Juliet pastes a Drive or Dropbox
   link. Ignore the reference section that specifies a `budget_attachments` table and a Storage
   bucket — that is a future migration, deliberately not built.

7. **Budget metrics are their own function and their own type.** Add
   `metrics.budget(scope, now?): Promise<BudgetMetrics>` in `lib/data/metrics.ts` and a new
   `BudgetMetrics` type. **Do not extend `OverviewMetrics`** — its 18 keys and `metrics.test.ts`
   stay byte-for-byte unchanged. The Overview page calls both inside its existing `Promise.all`.
   The budget cache key **must** include the venue's calendar day:
   `metrics:{weddingId}:budget:{venueCalendarDay}` — without the day segment, "due today" survives
   midnight and the dashboard lies.

8. **`daysUntilCalendarDate` is floored at zero and therefore cannot detect overdue.** Add a signed
   `calendarDayDelta(date, now, timeZone)` to `lib/format/wedding-date.ts` (append-only; do not
   change the existing export or its tests). Every due-date feature uses the signed version.
   Negative means overdue, in the venue's timezone, not the server's.

9. **On-screen labels are fixed**, because the client's spec uses two names for the same idea.
   "Remaining Balance" is called **"Still to pay"**. "Budget Remaining" is called
   **"Left in budget"**. These exact strings are used in the UI *and* as CSV export headers, so the
   two never drift apart.

10. **Foreign keys to vendors and categories are `on delete restrict`.** Deleting a vendor or a
    category that is still linked must **refuse** with a clear message naming what is linked, and
    offer to unlink first. Never cascade a delete into someone's budget.

11. **Migration numbers are allocated here.** Two reference sections both claim `0011` and both
    claim `0012`. The allocation is:
    | File | Contents | Milestone |
    | --- | --- | --- |
    | `0011_hot_path_indexes.sql` | the two missing indexes | 0 |
    | `0012_budget_vendors.sql` | vendors, budget_categories, budget_items, budget_payments, the `weddings` columns, the URL columns | 1 |
    | `0013_vendor_tasks.sql` | vendor_tasks | 7 |
    | `0014+` | anything Tier 3 needs (e.g. `guests.nickname`) | 9 |

12. **Tier 1 of the tighten milestone is split in two.** The audit's fifteen Tier 1 items are all
    real, but only some of them set patterns the new modules would copy, and Juliet's feature should
    not sit behind the rest. **Tier 1a** runs first as Milestone 0 and blocks everything:
    the invite-code fix, the `wedding_id` scoping sweep in `lib/data/seating.ts` and
    `lib/data/comms.ts`, the seven unguarded seating actions, cache invalidation moved into the
    data layer, and the two deadline/timezone date bugs. Everything else in the audit's Tier 1 is
    **Tier 1b** and runs in Milestone 8, before Tier 2. Nothing is dropped; the order changes.

13. **Milestone 0's first item is already done.** The invite-code wildcard hole was fixed and
    committed before this loop started (`e5716cf`). The fix **rejects** codes containing anything
    outside `[A-Za-z0-9-]` rather than stripping them as the audit suggested — stripping would turn
    `AB%%` into a silent two-character lookup, and rejecting states the intent. The validator is
    `normalizeInviteCode` in `lib/domain/invitation-rules.ts`, with seven regression tests. Do not
    redo this item; check the box and move on.

### Two data facts that will otherwise waste an iteration

- **The spreadsheet's stated `$60,170` total excludes the Flights category.** The eleven category
  allocations actually sum to **$62,970**. Do **not** hardcode either figure as a passing condition.
  The seed gate is: *the computed forecast total equals the sum of the seeded item forecasts, and
  that number is reported in the Iteration Log.* Whether Flights belongs in the wedding total is
  Open Question 6, for Juliet.
- **Alison-only rows must import with `benchmark_cents` set and the couple's columns left `NULL`,
  not `0`.** A zero would read as "we plan to spend nothing on this", which is a different claim
  from "we haven't priced this yet", and it would quietly distort every delta on the page.

---

## Milestones

Work them in order. Each milestone ends with a gate; do not open the next one until the gate is
green. The reference sections further down this document contain the detail — the exact SQL, the
exact columns, the exact copy. Consult them rather than re-deriving.

---

### Milestone 0 — Safety first (blocks everything)

Only **Tier 1a** (see Binding Decision 12): the five items whose patterns the new modules would
otherwise copy, plus the security fix. Fixing these after the budget module exists means fixing
them twice, in twice as many files.

- [x] **Invite-code wildcards** — done before the loop started, commit `e5716cf`. See Binding
      Decision 13. Do not redo.
- [x] **`wedding_id` scoping sweep** in `lib/data/seating.ts` and `lib/data/comms.ts` — audit Tier 1
      item 7. **Done:** grep count is **14** (gate ≥ 8). Added `requireTable()` / `requireEventId()`
      guards; `upsertTable` no longer upserts on a client-supplied PK (it now splits insert/update),
      and `assign` validates table, event and guest ownership *before* the write. Also swept
      `comms.create`, `markByMessageId`, `setRecipientMessageId`, `guests.create`, and three reads in
      `households.getDetail`. New `lib/data/seating.test.ts` (12) and `lib/data/comms.test.ts` (6)
      use a two-wedding in-memory fake, so a forgotten filter fails the suite.
- [x] **Seven unguarded seating actions** — audit Tier 1 item 8. **Done:** all seven now return
      `Promise<ActionResult>` with `requireEditor()` first and `unstable_rethrow(error)` opening every
      catch; `grep -c 'unstable_rethrow(error)'` is **7**. `SeatingCanvas` funnels all seven call
      sites through one `commit()` helper that rolls back the optimistic seat and renders a
      `role="alert"` line with a working "Try again". **Gate corrected this iteration** — it
      originally asked for a bare `unstable_rethrow` count of 7, which the import line makes
      unreachable, and an agent had reworded a doc comment to hit it. Prose restored, gate fixed.
- [x] **Cache invalidation moved into the data layer** — audit Tier 1 item 5. **Done:** count is
      **10** (gate ≥ 5). A local `invalidateMetrics(scope)` sits beside each write in
      `guests.create/update/remove`, `households.update/createWithGuests/remove`,
      `imports.commitHouseholds`, and `seating.assign/unassign/deleteTable/upsertTable`. Its prefix
      `metrics:{weddingId}` also covers the future `metrics:{weddingId}:budget:{day}` key.
- [x] **The two deadline/timezone date bugs** — audit Tier 1 item 6. **Done, after the adversarial
      pass caught two defects in the first attempt.** Added append-only `calendarDayIn`,
      `calendarDayDelta` (signed) and the pure `rsvpDeadlineNotice` to `lib/format/wedding-date.ts`.
      Verified in-browser: the header reads "RSVPs close in 257 days" (2026-07-29 → 2027-04-12 at the
      venue is exactly 257), and the guest page reads "12 de abril de 2027" with no console warnings.
      **Two fixes applied on top of the agent's work — see the Iteration Log.**

Everything else the audit filed under Tier 1 is **Tier 1b** and belongs to Milestone 8. Do not do
it here, and do not drop it.

**Gate:** `npm test` (257+ passing — the baseline rose when the security fix landed) ·
`npx tsc --noEmit` clean · every box above checked with evidence.

---

### Milestone 1 — Foundations

The schema and the pure logic. No screens yet. This milestone is where correctness is cheap.

- [x] **Migration `0012_budget_vendors.sql`** applied via Supabase MCP. **Verified independently by
      the orchestrator, not self-reported:** all four tables exist with `relrowsecurity = true` and
      exactly **4 policies each**. Additive only — 248 guests / 161 households unchanged before and
      after. Composite FKs include `wedding_id`, so a row cannot point at a parent in another wedding
      even if the app layer has a bug. 12 categories seeded, exactly 1 flagged `is_contingency`.
- [x] **Grants verified.** **Checked by the orchestrator against `has_function_privilege`:** both new
      security-definer functions — `apply_payment_schedule` and `set_vendor_contracted_price` — are
      `anon_can_execute = false` and `authenticated_can_execute = false`. The only anon-executable
      definers remain `is_wedding_member` / `is_wedding_editor`, which is correct and required: RLS
      policies call them, and revoking those would break every policy in the database.
- [x] **Types added** to `lib/types.ts` and imported by the new modules. `npx tsc --noEmit` clean.
- [x] **`lib/format/money.ts`** (347 lines, **63 tests**). Keeps `null` ("not priced yet", renders
      as an em dash) distinct from `0` ("spent nothing") — conflating them would quietly distort every
      delta on the page. The benchmark label is a *parameter* with a neutral default, never a constant.
- [x] **`lib/data/budget-rules.ts`** (1,066 lines, **152 tests**), including the mandatory timezone
      case — a payment due today at the venue while UTC is already tomorrow reads as due, not overdue.
- [x] **`lib/data/vendor-rules.ts`** (920 lines, **133 tests**), including `syncPlan`'s conflict
      case — a vendor price change that would overwrite a human-typed budget number returns a
      conflict for the UI to surface rather than writing silently.
- [x] **`lib/data/budget.ts` and `lib/data/vendors.ts`** — the I/O shells, every function scoped by
      `wedding_id`. `npx tsc --noEmit` clean.

**Gate:** all of the above · `npm run build` clean.

---

### Milestone 2 — Seed the real data

Nothing here is visible yet, but this is what makes every later screen real instead of a mockup.

- [ ] **Seed script** at `scripts/` following the existing `*.mjs` convention. Idempotent,
      re-runnable, refuses to double-insert, reports what it did. Done when: running it twice
      produces the same row counts and says so.
- [ ] **The full CSV is loaded** — every category and item from Juliet's spreadsheet, with Alison's
      actuals as the benchmark and Juliet's estimates as the forecast.
- [ ] **Totals reconcile.** Done when: a SQL query returns the benchmark grand total **$40,962**,
      and the forecast grand total equals the sum of the seeded item forecasts — **compute it, do
      not assert the sheet's $60,170**, which excludes Flights (see Binding Decisions). Report the
      computed figure in the Iteration Log. Every category subtotal matches the mapping table in
      the reference section. Any row where the spreadsheet's own arithmetic disagrees is resolved
      by the documented rule, never by a silent guess, and is listed in the Open Questions.

**Gate:** benchmark total is $40,962; forecast total is computed, reported, and internally
consistent between the table footer and the summary cards.

---

### Milestone 3 — The budget screens

- [ ] **Nav entry** added to the `NAV` array in `components/admin/SideNav.tsx`.
- [ ] **`/admin/budget` renders the seeded tree** — categories, items, subtotals, grand totals.
      Done when: seen in a browser at 1280px with real numbers.
- [ ] **The benchmark column sits adjacent to the couple's numbers**, with the delta, never behind a
      toggle. Done when: seen on screen; a reviewer can compare Alison's number to Juliet's without
      clicking anything.
- [ ] **Summary cards** per the reference section's chosen set, arithmetically consistent with the
      table's footer totals. Done when: the cards and the footer agree on every number.
- [ ] **Inline editing works end to end** — edit a cost, it saves, it's visibly confirmed, it
      survives a reload. Done when: done in a real browser, not asserted.
- [ ] **The item drawer** with the payment schedule, deposit auto-split, vendor link, and notes.
- [ ] **Payments** — add an installment, mark it paid, see overdue styling. Done when: exercised in
      a browser and the derived status matches the ledger.
- [ ] **Phone layout.** Done when: seen at 390px; the desktop table is hidden and the card list is
      usable with a thumb.
- [ ] **Empty states** for a fresh wedding with no budget yet.

**Gate:** browser pass at 1280px and 390px, console clean · gates green.

---

### Milestone 4 — Vendors, and the link to money

- [ ] **Nav entry** added.
- [ ] **`/admin/vendors`** — list, status filter chips, badges, live search, phone card list.
- [ ] **"Build your wedding team"** — unfilled vendor roles as the empty state, not a flat list.
- [ ] **Vendor profile page** — General, Contact, and Financial groups per the reference section.
- [ ] **Quote comparison within a category** — the thing couples keep spreadsheets for.
- [ ] **Vendor → budget sync.** Done when: changing a vendor's contracted price updates the linked
      budget item **and the UI says so explicitly**. Verify the negative case too: it must never
      silently overwrite a number a human typed on the budget side.
- [ ] **Activity log entries** for booking, status changes, and payment marks.

**Gate:** browser pass · sync verified in both directions · gates green.

---

### Milestone 5 — The Overview dashboard

- [ ] **New cards** on `/admin` per the reference section's final set, coexisting with the existing
      guest and RSVP cards without becoming a wall of numbers.
- [ ] **"Days until wedding"** uses `daysUntilCalendarDate` with the venue timezone. Done when: a
      unit test pins the boundary case and it passes.
- [ ] **Cache invalidation.** Done when: editing a payment and returning to `/admin` shows the new
      number immediately — not after 60 seconds.

**Gate:** browser pass · the staleness check above, performed manually.

---

### Milestone 6 — Exports and attachments

- [ ] **Five reports** — Full Budget, Outstanding Payments, Paid Expenses, Vendor Cost Summary,
      Payment Schedule — added to `app/api/export/[report]/route.ts` and surfaced in
      `components/admin/ExportCenter.tsx`. Done when: each downloads and opens with correct headers.
- [ ] **Attachments** for contracts and receipts, per the storage design in the reference section.
      Private bucket, signed URLs. Done when: a file uploads, and its URL is not readable
      unauthenticated.

**Gate:** each export downloaded and inspected · unauthenticated fetch of an attachment fails.

---

### Milestone 7 — Tasks and reminders

- [ ] **`vendor_tasks` table** (additive migration) and the "Tasks Due This Week" card wired to it.
- [ ] **Task CRUD** on the vendor profile.
- [ ] **Payment due reminders built behind a dry-run that logs instead of sending.** Done when: the
      dry-run prints the correct recipients and dates. **Send nothing.**

**Gate:** gates green · no email sent (verify: no Resend API call in the logs).

---

### Milestone 8 — The rest of the defects, then consistency

**Tier 1b first** — every item the audit filed under Tier 1 that Milestone 0 deferred: the seat
lookups ignoring `event_id` (which prints the wrong table on real place cards), the serial
campaign send that swallows failures, the `defaultScope()` sweep, the two catch blocks that turn
failures into "not found", the `runSync` N+1, the `households.search` filter interpolation, the
non-US address round-trip, the missing indexes, the dead guest-session module, and the rate
limiter's imaginary Redis backend.

**Then Tier 2** — the shared primitives that stop the drift (one `rsvp-status` module, one
`time-ago` module), the `--muted` contrast fix, route error and loading boundaries, the phone
layouts, and the accessibility work on the seating canvas.

**Gate:** browser pass over *every* admin route at 1280px and 390px, console clean, no horizontal
scroll at 390px, no hydration warnings.

---

### Milestone 9 — Exceed the competition

**Tier 3** items. At most six. If the night runs short, this is the milestone to leave unfinished —
leave the unchecked boxes in place with a note, rather than half-building three of them.

---

### Milestone 10 — Handoff

- [ ] **`docs/HANDOFF.md`** gets a new top section, "What shipped 2026-07-30 — Budget & Vendors",
      in the existing format.
- [ ] **A design doc** at `docs/superpowers/specs/2026-07-29-budget-vendors-design.md` recording the
      decisions actually made, following the existing spec format.
- [ ] **Open Questions updated** so Juliet's answers are all that's left.
- [ ] **The Iteration Log below is complete** and honest about what was skipped.

**Gate:** the full Definition of Done above.

---

## Milestone: Tighten What's Already Shipped

Three independent audits (surface quality, competitive gaps, correctness/security/performance) converged on the same conclusion: the shipped app is sound in shape but leaks in the seams, and the seams are exactly what the next modules will copy. **Tier 1 blocks everything else** — do not start Tier 2, Tier 3, or any module specced elsewhere until every Tier 1 box is checked, because the patterns fixed there (scoped queries, typed action results, cache invalidation in the data layer, timezone-correct date math) are the patterns a new module will inherit by imitation. Tier 2 extracts the shared primitives that stop the drift the audits already found (three copies of one badge map, two `timeAgo`s that disagree) and fixes the accessibility and mobile breakage that blocks Juliet from using the app on a phone at the venue. Tier 3 is a short, deliberately small list of additions that put this app ahead of Zola/Knot/Joy for *this* wedding — bilingual, Guadalajara, guests flying in.

Two standing constraints for the whole milestone: **do not change `weddings.timezone`** (the `America/Los_Angeles` vs Guadalajara question is unresolved and belongs to Juliet — label times, never rewrite the stored value), and **do not build Budget or Vendor surfaces** here; they are specced separately.

---

### Tier 1 — Correctness and safety (must all land before any other tier)

- [ ] **Invite-code login accepts SQL wildcards** — replace `.ilike("invite_code", code.trim())` with a normalized exact match: `const clean = code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "")`, reject if `clean.length !== 9`, then `.eq("invite_code", clean)` (`lib/data/households.ts:180`). Also enforce the same normalization + length in `app/(guest)/rsvp/actions.ts:21` before calling. Done when: a new `lib/data/households.test.ts`-adjacent rules test proves `normalizeInviteCode("AB%%")` yields `"AB"` and is rejected, and POSTing the code `AB%%` at `localhost:3006/rsvp` returns the "we couldn't find that code" path instead of a redirect to `/rsvp/h/…`.
- [ ] **The rate limiter's Redis backend does not exist** — `lib/limiter.ts:1-12` promises an Upstash swap that is not in the repo; `buckets`/`cacheStore` are per-instance `Map`s, so every limit resets on cold start. Either implement the Upstash REST path behind `UPSTASH_REDIS_REST_URL`/`TOKEN`, or delete the promise from the docblock, drop both vars from `lib/env.ts:14-15`, and rename the export to make "best-effort, per-instance" explicit. Done when: `grep -rn "Upstash" lib/` either returns real fetch calls to the REST API or returns nothing at all — no docblock claiming a backend that isn't there.
- [ ] **Seat lookups ignore `event_id` and will print the wrong table** — `seat_assignments` is keyed `(guest_id, event_id)`; thread an explicit `eventId` (the reception, or a picker) through and filter `s.event_id === eventId` at `app/admin/print/escort-cards/page.tsx:21`, `app/admin/print/place-cards/page.tsx:22-30` (which also buckets by `t.name` across events, silently merging a Ceremony "Table 1" with a Reception "Table 1"), `app/admin/(dashboard)/meals/page.tsx:31`, and `app/api/export/[report]/route.ts:64`. Same file, line 26: the place-card meal is picked with `responses.find(r => r.guest_id === g.id && r.meal_option_id)` — the first response for *any* event; filter by the seat's `event_id`. Done when: seat one guest at a Ceremony table and a Reception table in the live DB, then `/admin/print/escort-cards` and `/admin/print/place-cards` both show only the reception table across three consecutive reloads, and `curl localhost:3006/api/export/caterer` shows that guest once with the reception table.
- [ ] **`sendCampaign` sends 161 emails serially and swallows every failure** — replace the `for` loop with Resend's `/emails/batch` (100 per call) or a throttled queue under `waitUntil`; when `sendEmail` returns `id: null`, write a per-recipient `failed` status instead of skipping, and return `{ sent, failed }` (`app/admin/(dashboard)/comms/actions.ts:139-145`, `lib/email/send.ts:37-40`). Surface failures in the composer on the standard error line: `rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep`, copy "N of M messages didn't send. They're marked failed in History — you can retry just those." Done when: with an invalid `RESEND_API_KEY`, sending a campaign at `localhost:3006/admin/comms` leaves zero recipients in `queued`, shows the failure count on screen, and the History panel lists them as failed.
- [ ] **No admin mutation invalidates the metrics cache** — the 60s `cache()` at `lib/data/metrics.ts:31` is only ever cleared by `lib/data/rsvp.ts:123`, so Overview shows pre-edit counts for up to a minute. Call `invalidateCache(\`metrics:${scope.weddingId}\`)` **in the data layer, not the actions** — from `guests.create/update/remove`, `households.update/createWithGuests/remove`, `imports.commitHouseholds`, and `seating.assign/unassign/deleteTable/upsertTable` — so no future call site can miss it. Done when: `grep -rn "invalidateCache" lib/data/ | wc -l` is ≥ 5, and adding a guest at `localhost:3006/admin/guests` then loading `/admin/overview` shows the new count immediately, not after 60s.
- [ ] **Two deadline bugs: instant math and client-zone formatting** — `app/admin/(dashboard)/layout.tsx:28` counts `Math.ceil((deadline - Date.now()) / 86400_000)`, so four hours before close it reads "RSVPs close in 1 days" and after close it pins at "0 days" forever; count calendar days at the venue zone via `daysUntilCalendarDate` (`lib/format/wedding-date.ts`), singularize ("1 day"), and render a distinct "RSVPs closed" state at ≤ 0. `components/guest/RsvpFlow.tsx:69-75` formats with no `timeZone`, so it server-renders UTC and hydrates to the browser's zone — pass the wedding's `timezone` in and set `timeZone` on the `Intl.DateTimeFormat`. Done when: `npm test` includes a case pinning the deadline label at 20:00 venue-local on the day before ("closes tomorrow"/"1 day") and a "closed" case, and `localhost:3006/rsvp/h/<token>` shows the same date string before and after hydration with no React text-mismatch warning in the console.
- [ ] **Seating's data layer trusts client ids and never filters `wedding_id`** — add the `requireEvent()` guard `lib/data/events.ts` already uses, plus a `requireTable()`, and `.eq("wedding_id", scope.weddingId)` throughout `lib/data/seating.ts`: `upsertTable` (`:26-43`, currently upserts on a client-supplied PK and would rewrite a foreign row's `wedding_id`), `assign` (`:63-86`, including the unfiltered `guests` lookup at `:77`), and all four queries in `guestTable` (`:113-141`). While in the same class of bug, add the missing `.eq("wedding_id", …)` to `lib/data/comms.ts:36-39` and `markByMessageId` (`:82-92`). Done when: `grep -c 'eq("wedding_id"' lib/data/seating.ts` is ≥ 8, and calling `assignGuest` with a `tableId` from a different `wedding_id` throws rather than writing.
- [ ] **Every seating mutation is an unguarded `await`** — all seven actions in `app/admin/(dashboard)/seating/actions.ts` return `Promise<void>` with no try/catch and no `unstable_rethrow`, breaking the stated convention (events: 9/9, team: 5/5, seating: 0/0). Convert each to `Promise<{ ok: boolean; message?: string }>` with `catch (error) { unstable_rethrow(error); return { ok: false, message: "…" }; }`, and land failures on one `role="alert"` line above the canvas using the exact `EventsScreen.tsx:176-192` block: `rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep` with a "Try again" retry. **DONE in Milestone 0.** Done when: `grep -c 'unstable_rethrow(error)' "app/admin/(dashboard)/seating/actions.ts"` is 7 (count calls, not the symbol — the import line makes a bare grep unreachable at 7), and seating a guest at `localhost:3006/admin/seating` with the network offline shows the alert line instead of silently reverting the optimistic seat.
- [ ] **Seven admin pages read the hardcoded default wedding** — swap `defaultScope()` for `forWedding(admin.weddingId)` in `app/admin/(dashboard)/{layout,page}.tsx`, `comms/page.tsx:17`, `meals/page.tsx:9`, `seating/page.tsx:16`, `guests/page.tsx:32`, `guests/[householdId]/page.tsx:42`, and add `.eq("wedding_id", …)` to the membership lookup at `lib/admin-auth.ts:20-25`. Done when: `grep -rn "defaultScope" "app/admin/"` returns nothing and every admin route still renders at `localhost:3006`.
- [ ] **Two catch blocks turn real failures into "not found"** — `app/api/export/[report]/route.ts:261-266` wraps seven table reads in `catch { 404 "unknown report" }`; validate `report` against a known-name list *before* querying, add `unstable_rethrow(error)`, and return 500 for everything else. `app/admin/(dashboard)/guests/[householdId]/page.tsx:45-49` does `catch { notFound() }` around `getDetail`; narrow it to Postgres code `PGRST116` and rethrow the rest. Done when: `curl -i localhost:3006/api/export/nonsense` is 404 while a forced DB error on a valid report name is 500, and a forced DB error on a household detail page hits the error boundary rather than "not found".
- [ ] **`runSync` is N+1 and can time out the weekly cron mid-loop** — `lib/sync/run.ts:118` calls `households.getDetail` (5 queries each) inside the `for` over open rows, under `maxDuration = 60` (`app/api/cron/save-the-date/route.ts:10`); a timeout leaves households patched with their submissions still `pending`. Add `households.byIds(scope, ids)` selecting only `id, email, phone, mailing_address, preferred_locale, internal_notes, rsvp_status` in one `.in()` and hoist it above the loop. Done when: a full run over all 73 stored submissions completes in one request and `grep -n "getDetail" lib/sync/run.ts` returns nothing.
- [ ] **`households.search` interpolates raw text into a PostgREST filter** — `lib/data/households.ts:51` builds an `.or()` string from user text, so `Smith, John` splits on the comma into an invalid filter and throws 400; the guest-name fallback at `:59-65` also only runs when the SQL match returns zero rows, hiding a guest named Anna Smith inside the Jones household when "Smith Family" matches. Escape `%`, `,`, `(`, `)` before interpolating and always union the guest-name matches. Done when: a new test in `lib/**` passes `Smith, John` and `50%` through the escaper and asserts a well-formed filter string, and `npm test` is green.
- [ ] **Non-US addresses must round-trip** — `mailing_address` is `jsonb` and the import wizard plus the `addresses` export were never checked against a Mexican address (no state abbreviation, a 5-digit CP, `colonia` line). Verify and fix `lib/csv/*` mapping and `app/api/export/[report]/route.ts` so nothing assumes US shape or reorders lines. Done when: importing a fixture row with `Av. Vallarta 1234, Col. Americana, Guadalajara, Jal. 44160, México` and then downloading the `addresses` export returns byte-identical field values.
- [ ] **Add the two missing indexes** — `household_event_invites` has only its PK on `(household_id, event_id)` while every read filters `wedding_id` or `event_id`; `seat_assignments` is the same. Add `supabase/migrations/0011_hot_path_indexes.sql` with `create index household_event_invites_wedding on household_event_invites (wedding_id, event_id);` and `create index seat_assignments_wedding_event on seat_assignments (wedding_id, event_id);`. Done when: `select indexname from pg_indexes where tablename in ('household_event_invites','seat_assignments')` lists both new names.
- [ ] **The guest session JWT is dead code that implies a check that never happens** — `createGuestSession` is written once (`app/(guest)/rsvp/actions.ts:30`) and `getGuestSession` is never called; authorization rests entirely on the URL `access_token`. Delete `lib/guest-session.ts` and its call site, or wire the read into `app/(guest)/rsvp/h/[token]/page.tsx`. Done when: `grep -rn "guest-session" app/ lib/` returns either zero hits or at least one read call.

---

### Tier 2 — Consistency and polish

- [ ] **No route boundaries exist anywhere in `app/`** — four components already quote error-boundary copy that has no boundary behind it (`InvitePicker.tsx:80-86`, `HouseholdEvents.tsx:34-36`, `EventsScreen.tsx:80-84`, `DeleteEventButton.tsx:61-63`). Add `app/admin/(dashboard)/error.tsx` ("Something went wrong on this page." + a "Try again" button calling `reset()` + a "Back to overview" `<Link>`), `app/admin/(dashboard)/loading.tsx` (a `text-[13.5px] text-[#6b7167]` "Loading…" inside the same `flex flex-col gap-5` shell so the layout doesn't jump — every page is `force-dynamic` with 5-7 queries and currently freezes the old page with zero feedback), and `app/admin/(dashboard)/guests/[householdId]/not-found.tsx` for the `notFound()` already at `:48`. Done when: forcing a throw in any dashboard page renders the house-voice error card at `localhost:3006`, and navigating between `/admin/seating` and `/admin/guests` on a throttled connection shows "Loading…" instead of a frozen page.
- [ ] **One shared RSVP-status module, one shared time-ago module** — `STATUS_BADGE` is copy-pasted in `components/admin/GuestList.tsx:22-27`, `components/admin/HeaderSearch.tsx:8-13`, and `app/admin/(dashboard)/guests/[householdId]/page.tsx:21-26` (two with no `?? ""`, so an unknown status renders `className="… undefined"`), and `timeAgo` is duplicated in `components/admin/RecentFeed.tsx:18` and `guests/[householdId]/page.tsx:28` with *different* output past 24h ("3 d ago" vs "Jul 26"). Create `lib/format/rsvp-status.ts` exporting `type RsvpStatus` and `rsvpStatusBadge(status: string): { label: string; className: string }` with exactly these labels — `completed` → "Replied", `started` → "Half-answered", `pending` → "No reply yet", `declined` → "Can't come" — a safe fallback for unknown values, and `declined` styled `bg-blush text-rose-deep` (the current `text-rose` is 3.31:1 and fails). Create `lib/format/time-ago.ts` exporting `timeAgo(iso: string): string` as the single implementation. Delete all five copies. Done when: `grep -rn "STATUS_BADGE" app/ components/` returns nothing, `grep -rn "function timeAgo" app/ components/` returns nothing, `lib/format/rsvp-status.test.ts` covers all four statuses plus an unknown one, and no badge anywhere reads "started".
- [ ] **`text-muted` is the default secondary text and fails contrast** — `--muted: #8a8f86` on cream is 3.11:1, used at 11–12.5px across `MetricCards.tsx:51`, `GuestList.tsx:108,118`, `RecentFeed.tsx:62,71`, household detail `:104,170,193`, `MobileAssignSheet.tsx:29,83`, `ConfirmButton.tsx:47`; the uppercase labels `text-[#9aa38f]` (`InvitePicker.tsx:178,225`, `EventsScreen.tsx:196`) are 2.47:1. Redefine `--muted: #6b7167` in `app/globals.css:15` (4.73:1, already the page-subtitle colour) and replace every `text-[#9aa38f]` with `text-[#6b7167]`. Re-check the handful of genuinely decorative marks (drag dots) that wanted faintness and give them an explicit `text-[#b3b7ad]`. Done when: `grep -rn "#9aa38f" app/ components/` returns nothing and every text/background pair on `/admin/overview` and `/admin/guests` measures ≥ 4.5:1.
- [ ] **Deleting a household is a two-click 11.5px grey link** — `households.remove` (`lib/data/households.ts:348`) cascades to guests, responses, seat assignments, invites and activity, yet `components/admin/GuestList.tsx:111` ships it as `ConfirmButton label="Delete"` in a table row while deleting a *single event* requires typing its name. Remove the delete from the row entirely (`GuestList.tsx:109-113`) and give `components/admin/HouseholdEditor.tsx:56-61` the `DeleteEventButton` treatment: read the cost server-side at click time (guests, replies, meals chosen, seats) and, if anything is non-zero, show `GuardDialog` requiring the display name to be typed. Done when: `/admin/guests` has no delete affordance in the list, and deleting a household with guests at `localhost:3006/admin/guests/<id>` shows the live impact count and refuses until the name is typed exactly.
- [ ] **Meals, Comms and household detail have no phone layout** — `app/admin/(dashboard)/meals/page.tsx` and `comms/page.tsx` contain zero responsive classes; meal detail rows (`meals/page.tsx:84-91`) clip the dietary note, and comms history (`comms/page.tsx:48-62`) leaves the subject a few characters wide at 390px. Add the `md:hidden` card list `GuestList.tsx:129-155` established — `flex flex-col gap-2 md:hidden` of `rounded-xl border border-hairline bg-white/70 px-4 py-3.5` cards, name `text-[14px] font-semibold text-ink`, detail `text-[12.5px] text-[#4a5147]` — plus `max-md:flex-wrap max-md:gap-2` on the meals header (`:42`) and `max-md:flex-col` on the comms rows. Also add `flex-wrap` to the household detail response row (`guests/[householdId]/page.tsx:109-124`), which blows out on desktop at four events. Done when: `/admin/meals`, `/admin/comms` and `/admin/guests/<id>` show no horizontal scrollbar at 390px and no clipped dietary note or subject.
- [ ] **A 19 MB decorative video loads on every admin page, including on a phone** — `public/video/hero-v5.mp4` is 20.2 MB and `hero-v5-poster.jpg` is 557 KB, rendered unconditionally at `opacity-25` behind a blurred sidebar (`components/FilmBackdrop.tsx:10-20`, mounted at `app/admin/(dashboard)/layout.tsx:40`). Wrap the `<video>` in `hidden md:block`, keep the poster `<div>` as the phone and reduced-motion fallback, and re-encode the poster under 100 KB. Done when: DevTools at 390px shows no request for `hero-v5.mp4` and the total transfer for `/admin/overview` is under 1 MB.
- [ ] **Typing a search then clicking a filter chip discards the search** — `app/admin/(dashboard)/guests/page.tsx:61` builds chip hrefs from the *initial server render's* `params.q`, while `GuestList.tsx:48-58` updates the URL with `window.history.replaceState`, which never re-renders the server component. Move `FILTERS` into `GuestList` and render the chips as client `<Link>`s built from live `query` state (or lift the query into the URL with `router.replace(..., { scroll: false })` so `searchParams` stays truthful). Done when: typing "Ramírez" at `localhost:3006/admin/guests` and clicking "Missing meal" keeps the text in the box and returns only matching households.
- [ ] **Seating's empty state shows developer jargon to the bride** — `app/admin/(dashboard)/seating/page.tsx:27` reads "Create an event first (seed data provides Ceremony + Reception)." Replace with the events empty-state shell: `rounded-2xl border border-hairline bg-white/60 px-7 py-12 text-center`, heading `font-display text-[24px] font-medium text-olive-deep` reading "No events to seat yet", body "Add your reception on the Events page and its tables will live here.", and a `<Link href="/admin/events">` styled as the olive-deep primary button. Done when: `grep -n "seed data" "app/admin/(dashboard)/seating/page.tsx"` returns nothing and the empty state at `localhost:3006/admin/seating` matches the events page shell.
- [ ] **Seating is unusable without a pointer** — `components/admin/SeatingCanvas.tsx:100` registers only `PointerSensor`; `TableNode` (`:557-576`), `DraggableGuest` (`:462-483`) and `DraggableHousehold` (`:486-503`) are unfocusable `<div>`s with `onClick`. Events solved this exact problem and documented it (`EventsScreen.tsx:429-433`). Make `TableNode`'s inner element a `<button type="button">` with `aria-expanded={props.isOpen}` and ``aria-label={`${t.name}, ${seatedNames.length} of ${t.capacity} seated`}``, and add a "Seat at…" `<select>` of tables to each `DraggableGuest` row. Also make `components/admin/MobileAssignSheet.tsx:22` a real dialog — add `aria-modal="true"`, the Escape listener from `DeleteEventButton.tsx:190-197`, `autoFocus` on the close affordance, and a body scroll lock — and give the `disabled:opacity-40` buttons at `:59`/`:72` a `title`/`aria-label` of "Only N seats left at {table}". Done when: at `localhost:3006/admin/seating` a guest can be seated using only Tab/Enter/arrow keys, and the mobile sheet at 390px traps focus and closes on Escape.
- [ ] **Seating's two dangerous buttons have no guard** — "Visible to guests" (`SeatingCanvas.tsx:335-350`) publishes the chart to 200 guests on one unconfirmed tap and is a plain `<button>` with no `role="switch"`/`aria-checked`; add `role="switch" aria-checked={Boolean(props.event.seating_published_at)}` and route the *publish* direction only through `ConfirmButton`-style arming with `confirmLabel="Show the chart to guests?"`. "Delete table" (`:604-618`) only renders when the table is empty, so a wrongly-sized table with 8 people must be unseated one link at a time — always render it, and when occupied arm it as "Delete table and unseat 8 people?" with the action unassigning then deleting; give the empty case `ConfirmButton` too (`seating/actions.ts:19` currently fires on a single click). Done when: a screen reader announces the toggle's on/off state, publishing requires two clicks while unpublishing stays one, and a table with guests can be deleted from `localhost:3006/admin/seating` in two clicks.
- [ ] **Header search hangs on "Looking…" forever if the directory fetch fails** — `components/admin/HeaderSearch.tsx:26-30` has no `.catch()`, so `directory.current` stays `null` and line 126 renders "Looking…" permanently. Add a `.catch()` setting an error flag rendering "Couldn't load the guest list. Try again." with a retry that clears `directory.current`. The dropdown also implements full arrow-key navigation (`:51-75`) with no semantics: add `role="combobox" aria-expanded={open} aria-controls` to the input, `role="listbox"` to the list, and `role="option" aria-selected` plus `aria-activedescendant` wiring to each result. Done when: blocking the directory request in DevTools shows the retry copy at `localhost:3006/admin/overview`, and the highlighted result is announced.
- [ ] **Dead ends and links that don't carry their intent** — the print pages sit outside `(dashboard)` with no navigation at all: add a `no-print` `<Link href="/admin/seating">` beside each `<h1>` (`app/admin/print/escort-cards/page.tsx:32`, `place-cards/page.tsx:37`) styled `text-[12.5px] font-medium text-[#6b7167] hover:text-rose`, make both grids `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-2`, and give escort-cards an empty state pointing at Seating. `components/admin/NewHouseholdForm.tsx:39-43` has only "Create household" — add a "Cancel" `<Link href="/admin/guests">` in the same style `EventForm.tsx:231-238` uses. Overview's "Send reminders (N)" drops its own number (`app/admin/(dashboard)/page.tsx:42-47`) — link to `/admin/comms?audience=not_responded&type=reminder` and have `CampaignComposer` read both as defaults; its "Export" button (`:36-41`) should link to `/admin/imports#exports` with a matching `id` on the export card. Done when: every one of those five destinations is reachable and returns without the browser back button, and clicking "Send reminders" at `localhost:3006/admin/overview` lands on a composer already set to "Hasn't responded" with a matching count.
- [ ] **`MetricCards` "Needs attention" has a precedence bug and no link** — `components/admin/MetricCards.tsx:30` reads `String(m.guestsWithoutTable + m.dietaryCount === 0 ? 0 : m.guestsWithoutTable)`, which parses as `(a + b) === 0 ? 0 : a` so the `dietaryCount` term does nothing. Replace with `String(m.guestsWithoutTable)` and wrap the value in `<Link href="/admin/guests?filter=no_table">` (the filter already exists at `guests/page.tsx:22`). Done when: the card's number matches `guestsWithoutTable` exactly and clicking it lands on the filtered guest list.
- [ ] **Untested pure logic in the two places it matters** — `lib/csv/detect.ts` decides the entire import mapping across 19 branching header heuristics with no test (`find("agetype","age","type")` claims a bare "Type" column); add `lib/csv/detect.test.ts` as a table test over real header rows including a Spanish-language CSV. Extract the status no-downgrade rule welded into `lib/data/comms.ts:79-88` (a late `sent` webhook must not clobber `opened`) into `lib/data/comms-rules.ts` exporting `shouldUpgrade(from: string, to: string): boolean`, and test it. Done when: `npm test` reports both new files passing and the total test count is above the current 250.

---

### Tier 3 — Exceed the competition (at most 6, all small)

- [ ] **Explicit timezone label on every guest-facing and printed time** — extend `lib/format/wedding-date.ts` with one `formatEventTime(iso, timezone)` returning `18:00 · Guadalajara, GMT-6` and sweep every guest-facing and print call site to use it; **do not change the stored `weddings.timezone` value**. Beats all six commercial tools, which render one unlabelled local time — and guests flying into GDL book flights off these numbers. Done when: `grep -rn "toLocaleTimeString\|DateTimeFormat" app/\(guest\)/ app/admin/print/ components/guest/` returns only calls routed through the shared formatter, and every time shown at `localhost:3006/rsvp/h/<token>` carries a zone label in both `en` and `es`.
- [ ] **Nickname/alias and phone as RSVP lookup keys** — add a `guests.nickname` column (migration `0012`) and include both nickname and household phone in `matchesGuestQuery` / `normalizeQuery`. Erases the single most-reported failure in the category (Zola and The Knot exact-match on the invited name, so "Eddie" cannot find "Edward"), for one column and one line. Done when: a guest row with `first_name: "Edward", nickname: "Eddie"` is found by typing "eddie" and by typing the household phone at `localhost:3006/rsvp`, with a test in `lib/**` pinning both.
- [ ] **Meal and allergy overlay on the seating canvas, plus a per-table kitchen card** — render a small meal indicator and an allergy flag per seated guest in `SeatingCanvas.tsx`'s `TableNode` popover and on the node itself, and add a print view grouping guests by table with meal counts and allergies. Steals Aisle Planner's best idea using two datasets already in the app and a canvas already built; the Guadalajara caterer and the planner both ask for exactly this sheet. Done when: a table with a guest who has an allergy shows the flag at `localhost:3006/admin/seating`, and the kitchen card print lists per-table meal counts that match `/api/export/caterer`.
- [ ] **Tag-based comms audiences and per-household WhatsApp links** — teach `resolveAudience()` to accept `households.tags` (stored and pickable today, but the resolver only understands RSVP status), and render a per-household `wa.me` deep link with the RSVP token and message prefilled in that household's `preferred_locale`. Joy charges extra for SMS and none of them do WhatsApp, which is how Mexico actually communicates — and it unlocks "out-of-town guests only" messaging that no competitor can express. Done when: selecting a tag at `localhost:3006/admin/comms` narrows the recipient count correctly, and each household row offers a WhatsApp link whose prefilled text is Spanish for an `es` household.
- [ ] **Guest weekend page on the existing household token URL** — add a route under `app/(guest)/rsvp/h/[token]/` reusing `getRsvpContext` that shows *only that household's* invited events with times and zone labels, the venue with a map link, travel and lodging notes, and an FAQ, all through `next-intl` with 100% key parity in `messages/{en,es,vi}.json`. Zola and The Knot cannot render an RSVP page in Spanish at all (Zola's FAQ also warns it cannot support special characters, which breaks "Guadalajara" and every Vietnamese name on this list), and all of them show every guest every event; this is personalized and bilingual by construction, and it is what stops the inbound texts to Juliet's phone. Done when: the page renders at `localhost:3006/rsvp/h/<token>` in all three locales with no missing-key warnings, shows only that household's invited events, and `node scripts/check-messages.mjs`-equivalent key parity holds.
- [ ] **Arrivals and lodging board** — collect arrival/departure date, airport, flight and hotel per household through the existing `rsvp_questions` mechanism into `guests.hotel_info` (both already in the schema and unused), and show a date-sorted admin board with a shuttle/welcome-bag CSV export. No commercial tool tracks guest travel — Joy's accommodations page is a list of hotels, not a record of who booked what — and every destination-wedding guide tells couples to keep a spreadsheet. With ~200 guests flying into GDL, airport pickups and welcome bags, this is the biggest unserved job. Done when: answering the travel questions at `localhost:3006/rsvp/h/<token>` populates the board at `/admin/arrivals` sorted by arrival date, and the shuttle export downloads with one row per arriving household.

---

### Acceptance check for the whole milestone

- [ ] `npm test` — all existing tests plus every test added above pass (baseline is 250; the count must go up, and no test may be skipped or deleted to make this green).
- [ ] `npx tsc --noEmit` — clean, zero errors.
- [ ] `npm run build` — clean, zero errors and zero new warnings.
- [ ] Browser pass at `localhost:3006` over every admin route (`/admin/overview`, `/admin/guests`, `/admin/guests/<id>`, `/admin/events`, `/admin/seating`, `/admin/meals`, `/admin/comms`, `/admin/imports`, `/admin/team`, `/admin/print/escort-cards`, `/admin/print/place-cards`) plus the guest flow (`/rsvp`, `/rsvp/h/<token>`) at **1280px and 390px**, with **no console errors**, no horizontal page scroll at 390px, and no hydration mismatch warnings.

---

## The loop protocol

You are running unattended. Nobody will answer a question, unblock you, or catch a mistake before
morning. Behave accordingly: prefer the reversible action, leave the repo in a working state at the
end of every iteration, and write down anything you had to decide.

### Every iteration, in order

1. **Orient.** Read this file. Run `git status` and `git log --oneline -8`. Identify the first
   milestone that is not fully checked, and within it the first unchecked item.
2. **Verify the last iteration's claims before adding to them.** Run the gates:
   `npm test` · `npx tsc --noEmit` · `npm run build`. If any gate fails, fixing it is this
   iteration's only work. A red tree blocks new features — no exceptions, no "I'll fix it after".
3. **Plan the slice.** Take the smallest coherent unit that ends with a passing gate and something
   observable. Not "build the budget module" — "the budget table renders seeded categories with the
   benchmark column, and I can see it at localhost:3006/admin/budget".
4. **Build it.** For anything with independent parts, orchestrate a workflow: fan out the parts,
   then adversarially verify the result. For a single small fix, just do it — a workflow to change
   one line is waste.
5. **Prove it.** Run the gates again. Then open a real browser (Chrome MCP) against the running dev
   server and look at the thing you built, at 1280px and at 390px. Read the console. A screenshot
   you did not look at is not proof. "It compiles" is not proof.
6. **Record it.** Check the box, and append the evidence to the Iteration Log at the bottom of this
   file — one line: what you built, what proved it, what you decided. If you discovered work that
   isn't in this file, add it as a new unchecked item in the right milestone rather than doing it
   silently.
7. **Commit.** One commit per coherent slice, on `feat/budget-vendors`, with a conventional-commit
   message. Never amend a commit from a previous iteration.
8. **Decide whether to continue.** If every box in every milestone is checked and the Final
   Acceptance gate passes, stop the loop (`ScheduleWakeup` with `stop: true`) and write the handoff
   summary. Otherwise schedule the next wakeup and continue.

### When you get stuck

Two failed attempts at the same thing means stop attempting it. Do not try a third variation of the
same idea. Instead: write what you tried and why it failed into the **Blocked** section at the
bottom, mark the item `- [!]` instead of `- [ ]`, and move to the next unblocked item. A loop that
grinds on one problem all night delivers nothing; a loop that routes around it delivers eight other
things and a clear question for the morning.

### Guardrails — these are absolute

**The database is live production data.** The couple's real guest list is in it.

- Migrations must be **additive only**: `create table`, `create index`, `add column` (nullable or
  with a default), `create or replace function`. **Never** `drop table`, `drop column`,
  `drop function`, `truncate`, `alter column ... type`, or any rename, on any table that already
  exists. If a change seems to require one, it goes in the Blocked section instead.
- Apply migrations through the **Supabase MCP** (`mcp__supabase__apply_migration`), never the
  Supabase CLI — the shared CLI credential drifts between accounts and will hit the wrong project.
- Every new `security definer` function gets `revoke execute on function <name>(<sig>) from public,
  anon, authenticated;` in the same migration. Verify it afterwards; the anon key ships to the
  browser and two exploitable holes have already been found in this repo.
- Never `drop` then `create` a function. `create or replace` only — a drop discards the ACL and
  silently restores the anon grant.

**Do not touch the outside world.**

- **Send no email.** Resend is wired up and the couple's guests are real people. Nothing in this
  work needs to send. If you build reminder emails, build them behind a dry-run that logs.
- Do not modify or trigger the cron in `vercel.json`.
- Do not deploy. Do not merge to `main`. Do not `git push`. Do not force-push anything, ever.
- Do not touch the guest-facing flow (`app/(guest)/**`) unless a milestone explicitly says to.
  Guests may be submitting RSVPs while you work.

**Do not fake progress.**

- Never edit or delete an existing test to make a suite pass. **The verified baseline on
  2026-07-29 is 250 passing tests across 26 files, `npx tsc --noEmit` clean.** All 250 must still
  pass, untouched, at every gate. (Older plan documents in `docs/` say "107 tests" — that number is
  stale; 250 is measured.) If a test legitimately must change, that is a Blocked item with an
  explanation, not a quiet edit.
- Never check a box you have not proven. An unchecked box is fine; a lying ledger is not.
- Never commit a secret. Env vars go in Vercel, never in git and never in `NEXT_PUBLIC_*`.

**Machine hygiene.**

- This machine runs many dev servers and agent sessions. **Never** `killall node`, `pkill node`, or
  any name/pattern kill. To free port 3006: `lsof -ti:3006 | xargs kill`. To keep the dev server
  alive across iterations, start it detached:
  `nohup npm run dev > /tmp/guest-crm-dev.log 2>&1 & disown`.

### Non-negotiable code rules

- **Read `node_modules/next/dist/docs/` before writing Next.js code.** This is Next.js 16.2.10 and
  it differs from what you remember. `AGENTS.md` mandates this and it has bitten people here.
- Every `lib/data/*` function takes `scope: WeddingScope` first and filters
  `.eq("wedding_id", scope.weddingId)`. RLS is the backstop, not the guard.
- Every mutating server action calls `requireEditor()` first, and **the first line of its catch
  block is `unstable_rethrow(error)`** — without it, Next's `redirect()` throw is swallowed and the
  user sees "NEXT_REDIRECT" on screen.
- All real logic goes in pure modules under `lib/` with a `*.test.ts` sibling, because vitest only
  sees `lib/**`. A branchy function inside a React component or a server action is untestable and
  therefore wrong.
- Money is integer cents in `bigint` columns named `*_cents`. Never a float. Never a `numeric`.
- Postgres `date` columns are calendar days with no timezone. Never pass one to `new Date()`. Use
  `lib/format/wedding-date.ts`. Vercel runs UTC, so getting this wrong looks fine locally and is
  wrong in production — "payment due today" must mean today in Guadalajara.
- No new dependencies. No component library, no chart library, no date library, no form library.
  Bars are `<div>`s. Dates are `Intl.DateTimeFormat`. Forms are `useActionState` + `FormData`.
- Never invent a color. Use the theme tokens. Every hex in this document is already in the codebase.
- Every admin page exports `export const dynamic = "force-dynamic";`.
- Watch for the known toolchain bug where a JSX text node wrapping to a second line loses its
  leading space — it once shipped "seats areheld". Keep user-facing strings on one line.

### Definition of done for the whole build

Stop the loop only when all of these are true and you have observed each one this iteration:

- [ ] Every checkbox in every milestone above is checked.
- [ ] `npm test` — all 250 pre-existing tests pass, plus every new test, zero failures.
- [ ] `npx tsc --noEmit` — clean, zero errors.
- [ ] `npm run build` — clean, zero errors and zero new warnings.
- [ ] A browser pass over `/admin`, `/admin/budget`, `/admin/vendors`, and one vendor profile, at
      1280px and 390px, with an empty console.
- [ ] Seeded totals reconcile on screen: Alison's actual **$40,962** and the couple's forecast
      **$60,170** appear as the benchmark and forecast grand totals.
- [ ] A security check confirms no function added by this work is executable by `anon`.
- [ ] `docs/HANDOFF.md` has a new top section, "What shipped 2026-07-30 — Budget & Vendors",
      following the existing format.
- [ ] The Open Questions list below is current, so Juliet's answers are the only thing left.
- [ ] Working tree clean, all work committed to `feat/budget-vendors`, nothing pushed or merged.

---

# Reference sections

> Everything below is reference, not a work queue. The milestones above are the work queue.
> Where any of it disagrees with the Binding Decisions near the top of this file, the
> Binding Decisions win.

---

## Data Model & Migrations

Three migration files carry the whole module. All three are **written now, final, and never edited
afterwards** — they are applied at different milestones so nothing ever has to be migrated twice.

| File | Contents | When applied |
| --- | --- | --- |
| `supabase/migrations/0012_budget_vendors.sql` | `weddings` columns, `vendors`, `budget_categories`, `budget_items`, `budget_payments`, RLS, 2 RPCs, category seed | **Milestone 1.** Everything else depends on it. |
| ~~`0012_budget_attachments.sql`~~ | ~~`budget_attachments` + private Storage bucket~~ | **SUPERSEDED by Binding Decision 6 — not built.** Attachments are the `contract_url` / `receipt_url` columns in `0012_budget_vendors.sql`. |
| `supabase/migrations/0013_vendor_tasks.sql` | `vendor_tasks` | **LAST milestone** (see §6) — do not start here |

Apply each with `mcp__supabase__apply_migration` (name = the filename without `.sql`), **not** the
Supabase CLI (the shared CLI credential drifts between accounts). Write the file into
`supabase/migrations/` first so the repo and the live DB agree, then apply the identical text.

---

### 1. `supabase/migrations/0012_budget_vendors.sql`

Copy this verbatim.

```sql
-- 0011: Budget & Vendor management.
--
-- Money is stored as integer cents in bigint columns named *_cents. Never floats,
-- never numeric — a wedding budget is summed and diffed constantly and binary
-- floating point loses pennies in exactly the places a bride notices.
--
-- Four tables: vendors, budget_categories, budget_items, budget_payments.
-- Hierarchy is Category -> Item -> Payments (Zola / Aisle Planner). A budget item
-- may optionally point at a vendor. Payments hang off items.
--
-- Two numbers are deliberately NOT stored:
--   * actual spend  — always sum(budget_payments.amount_cents) where paid,
--                     so a payment ledger and a headline total can never drift.
--   * payment status (unpaid/partial/paid) — derived from the same sum.
-- Both are computed in lib/domain/budget-math.ts, which is unit-tested.
--
-- Tenancy: every table carries wedding_id and every FK is a COMPOSITE FK that
-- includes wedding_id, so a row can never point at a parent in another wedding
-- even if the app layer has a bug. RLS is the backstop, not the primary guard —
-- the app reads through the service-role client (lib/supabase/admin.ts).

-- ------------------------------------------------- wedding-level budget settings
alter table weddings
  add column if not exists budget_total_cents bigint;                                   -- the couple's overall ceiling ("Max Spend"); null = not set yet, UI must not invent one
alter table weddings
  add column if not exists budget_currency text not null default 'USD';                 -- display currency for the three headline numbers; no FX conversion is ever performed
alter table weddings
  add column if not exists budget_benchmark_label text not null default 'Alison''s wedding';  -- the ONLY place the benchmark's name lives; UI must never hardcode "Alison"

comment on column weddings.budget_benchmark_label is
  'Human label for the benchmark column, e.g. "Alison''s wedding". Read this per page; never hardcode a name in a component.';

-- ---------------------------------------------------------------------- vendors
create table vendors (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  category_id uuid,                                                                     -- which budget category this vendor's spend belongs to; nullable so a vendor can exist before the money is planned
  name text not null,
  role text,                                                                            -- the wedding-team ROLE ("Photographer", "DJ", "Florist"); powers The Knot's "build your team" empty state, where an unfilled ROLE is the prompt
  status text not null default 'researching'
    check (status in ('researching','contacted','quoted','booked','completed','passed')),
  contact_name text,
  email text,
  phone text,
  website text,
  address text,
  quoted_cents bigint check (quoted_cents is null or quoted_cents >= 0),
  contracted_cents bigint check (contracted_cents is null or contracted_cents >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  contract_signed_at date,                                                              -- calendar date, no timezone. Booked vendor + null here = "Contracts Outstanding" on the dashboard
  booked_at date,                                                                       -- calendar date the couple committed; separate from contract signature because they book verbally first
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, wedding_id)                                                               -- target for composite FKs below; this is the cross-tenant guard
);

create index vendors_wedding_status on vendors (wedding_id, status);
create index vendors_wedding_sort on vendors (wedding_id, sort_order, name);
create index vendors_category on vendors (category_id);
create index vendors_contract_outstanding on vendors (wedding_id, contract_signed_at)
  where contract_signed_at is null;                                                     -- partial index: the "Contracts Outstanding" card only ever reads unsigned rows

-- ------------------------------------------------------------- budget_categories
-- Categories are PER-WEDDING ROWS, never a hardcoded enum. Research is explicit
-- that fixed category lists make couples feel "pigeon-holed"; Juliet must be able
-- to rename, reorder, add and (if empty) delete categories.
create table budget_categories (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  name text not null,
  slug text not null,                                                                   -- stable machine key: makes the taxonomy seed and the CSV importer idempotent even after Juliet renames the category
  sort_order int not null default 0,
  allocated_cents bigint check (allocated_cents is null or allocated_cents >= 0),        -- TOP-DOWN plan for this category (Zola's percentage-seeded split). Used as the category forecast only while the category has zero items
  benchmark_cents bigint check (benchmark_cents is null or benchmark_cents >= 0),        -- the benchmark wedding's STATED total for this category. Overrides the sum of item benchmarks when non-null, because the source spreadsheet's category totals do not always equal their children (see §4)
  is_contingency boolean not null default false,                                        -- exactly one category should carry this; research mandates a 5-10% buffer and the UI treats it differently (it is not "unplanned spend")
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, slug),
  unique (id, wedding_id)
);

create index budget_categories_wedding_sort on budget_categories (wedding_id, sort_order, name);

alter table vendors
  add constraint vendors_category_fk
  foreign key (category_id, wedding_id)
  references budget_categories (id, wedding_id)
  on delete restrict;                                                                   -- MATCH SIMPLE: a null category_id satisfies this. restrict (not set null) because a composite SET NULL would also null wedding_id, which is NOT NULL

-- ----------------------------------------------------------------- budget_items
-- The cost lifecycle lives here as four ADJACENT columns, never behind a tab:
-- benchmark -> estimated -> quoted -> contracted. Actual spend is derived.
create table budget_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  category_id uuid not null,
  vendor_id uuid,
  name text not null,
  quantity numeric(12,3) check (quantity is null or quantity > 0),                       -- source sheet has a Qty column ("2", "180"); non-numeric quantities ("100 liters") go to notes
  unit_cents bigint check (unit_cents is null or unit_cents >= 0),                        -- source sheet's "Each" column; informational, never auto-multiplied into a total (the sheet's own totals disagree with qty*each in places)
  benchmark_cents bigint check (benchmark_cents is null or benchmark_cents >= 0),         -- what the benchmark wedding actually paid for this line. The signature feature: shown beside the couple's number with a delta
  estimated_cents bigint check (estimated_cents is null or estimated_cents >= 0),
  quoted_cents bigint check (quoted_cents is null or quoted_cents >= 0),
  contracted_cents bigint check (contracted_cents is null or contracted_cents >= 0),
  contracted_source text not null default 'manual' check (contracted_source in ('manual','vendor')),  -- who last wrote contracted_cents. Lets the UI say "synced from vendor" instead of silently replacing a number a human typed (design decision 6)
  currency text not null default 'USD' check (char_length(currency) = 3),
  pending_guest_count boolean not null default false,                                    -- Aisle Planner's catering flag: this estimate cannot firm up until the final headcount lands. UI shows a badge instead of pretending the number is settled
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, wedding_id),
  constraint budget_items_category_fk
    foreign key (category_id, wedding_id)
    references budget_categories (id, wedding_id)
    on delete restrict,                                                                  -- deleting a category that still holds items must fail loudly, not silently orphan or delete money
  constraint budget_items_vendor_fk
    foreign key (vendor_id, wedding_id)
    references vendors (id, wedding_id)
    on delete restrict                                                                   -- the delete-vendor server action unlinks items first, then deletes (see §9)
);

create index budget_items_category on budget_items (wedding_id, category_id, sort_order, name);
create index budget_items_vendor on budget_items (vendor_id);
create index budget_items_wedding on budget_items (wedding_id);

-- -------------------------------------------------------------- budget_payments
-- The payment ledger. Omitting this is The Knot's core failure — estimate-only
-- budgeting sends couples straight back to the spreadsheet.
create table budget_payments (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  budget_item_id uuid not null,
  vendor_id uuid,                                                                        -- optional payee override; falls back to the item's vendor when null, so a payment keeps its payee if the item is re-categorised
  label text not null default 'Payment',                                                 -- "Deposit", "Final balance", "Second installment" — free text, users name their own schedule
  kind text not null default 'installment'
    check (kind in ('deposit','installment','final','refund')),
  amount_cents bigint not null,
  currency text not null default 'USD' check (char_length(currency) = 3),
  due_date date,                                                                         -- CALENDAR DATE, no timezone. Never pass to new Date(); use lib/format/wedding-date.ts
  paid boolean not null default false,
  paid_on date,                                                                          -- calendar date the money actually left
  method text,                                                                           -- free text ("Zelle", "Amex", "check #1042") — a check constraint here would pigeon-hole users
  reference text,                                                                        -- confirmation / check number
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_payments_amount_sign
    check ((kind = 'refund' and amount_cents < 0) or (kind <> 'refund' and amount_cents > 0)),  -- refunds are the only negative rows, so sum(paid) is simply "money spent"
  constraint budget_payments_paid_on_required
    check (paid = false or paid_on is not null),                                         -- a paid payment with no date breaks every month bucket; the server action defaults it to today in the venue timezone
  constraint budget_payments_item_fk
    foreign key (budget_item_id, wedding_id)
    references budget_items (id, wedding_id)
    on delete cascade,
  constraint budget_payments_vendor_fk
    foreign key (vendor_id, wedding_id)
    references vendors (id, wedding_id)
    on delete restrict
);

create index budget_payments_item on budget_payments (budget_item_id, sort_order, due_date);
create index budget_payments_due on budget_payments (wedding_id, paid, due_date);        -- "Payments Due This Month" and the overdue banner
create index budget_payments_paid_on on budget_payments (wedding_id, paid_on) where paid; -- "Budget Spent" and the spend-over-time bars
create index budget_payments_vendor on budget_payments (vendor_id);

-- --------------------------------------------------------------------------- RLS
-- Same shape as every other tenant table (0001's policy loop).
do $$
declare t text;
begin
  foreach t in array array['vendors','budget_categories','budget_items','budget_payments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (is_wedding_member(wedding_id))', t, t);
    execute format('create policy %I_insert on %I for insert with check (is_wedding_editor(wedding_id))', t, t);
    execute format('create policy %I_update on %I for update using (is_wedding_editor(wedding_id))', t, t);
    execute format('create policy %I_delete on %I for delete using (is_wedding_editor(wedding_id))', t, t);
  end loop;
end $$;

-- ------------------------------------------------------- apply_payment_schedule
-- Aisle Planner's deposit auto-split ("enter total + deposit, the balance is
-- computed — never make the user subtract") writes several rows at once, and
-- supabase-js has no transactions. One RPC so a half-written schedule is
-- impossible. It is also the safe editor: PAID rows are never touched, and
-- unpaid rows the payload omits are removed, so the function is idempotent —
-- calling it twice with the same payload produces the same ledger.
create or replace function apply_payment_schedule(
  p_wedding_id uuid,
  p_item_id uuid,
  p_schedule jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_keep uuid[] := '{}';
  v_id uuid;
  v_deleted int;
  v_written int := 0;
begin
  if not exists (select 1 from budget_items i
                  where i.id = p_item_id and i.wedding_id = p_wedding_id) then
    raise exception 'budget item not found in this wedding';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_schedule, '[]'::jsonb))
  loop
    v_id := nullif(r->>'id', '')::uuid;

    if v_id is not null then
      update budget_payments p set
        label        = coalesce(nullif(r->>'label',''), p.label),
        kind         = coalesce(nullif(r->>'kind',''), p.kind),
        amount_cents = coalesce((r->>'amount_cents')::bigint, p.amount_cents),
        currency     = coalesce(nullif(r->>'currency',''), p.currency),
        due_date     = nullif(r->>'due_date','')::date,
        vendor_id    = nullif(r->>'vendor_id','')::uuid,
        notes        = nullif(r->>'notes',''),
        sort_order   = coalesce((r->>'sort_order')::int, p.sort_order),
        updated_at   = now()
      where p.id = v_id
        and p.budget_item_id = p_item_id
        and p.wedding_id = p_wedding_id
        and p.paid = false;
      if not found then
        raise exception 'payment % is not an editable unpaid payment on this item', v_id;
      end if;
    else
      insert into budget_payments (
        wedding_id, budget_item_id, vendor_id, label, kind,
        amount_cents, currency, due_date, notes, sort_order
      ) values (
        p_wedding_id,
        p_item_id,
        nullif(r->>'vendor_id','')::uuid,
        coalesce(nullif(r->>'label',''), 'Payment'),
        coalesce(nullif(r->>'kind',''), 'installment'),
        (r->>'amount_cents')::bigint,
        coalesce(nullif(r->>'currency',''), 'USD'),
        nullif(r->>'due_date','')::date,
        nullif(r->>'notes',''),
        coalesce((r->>'sort_order')::int, 0)
      ) returning id into v_id;
    end if;

    v_keep := v_keep || v_id;
    v_written := v_written + 1;
  end loop;

  delete from budget_payments p
   where p.budget_item_id = p_item_id
     and p.wedding_id = p_wedding_id
     and p.paid = false
     and not (p.id = any(v_keep));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('written', v_written, 'deleted', v_deleted);
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default, and the anon key ships to every browser. The only caller is the
-- service-role client in lib/data/, whose grant is unaffected.
revoke execute on function apply_payment_schedule(uuid, uuid, jsonb) from public, anon, authenticated;

-- --------------------------------------------------- set_vendor_contracted_price
-- Design decision 6: vendor -> budget sync is ONE-DIRECTIONAL and EXPLICIT.
-- Setting a vendor's contracted price pushes it to every budget item linked to
-- that vendor, atomically, and RETURNS the before/after of each row it touched
-- (including whether the previous value was hand-typed) so the caller can tell
-- the user exactly what changed. The app must never silently overwrite a human's
-- number. Turning this diff into sentences is lib/domain/vendor-sync.ts (pure,
-- unit-tested); this function only reports facts.
create or replace function set_vendor_contracted_price(
  p_wedding_id uuid,
  p_vendor_id uuid,
  p_contracted_cents bigint,
  p_currency text default 'USD'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before bigint;
  v_changes jsonb := '[]'::jsonb;
  it record;
begin
  select v.contracted_cents into v_before
    from vendors v
   where v.id = p_vendor_id and v.wedding_id = p_wedding_id;
  if not found then
    raise exception 'vendor not found in this wedding';
  end if;

  update vendors set
    contracted_cents = p_contracted_cents,
    currency = coalesce(nullif(p_currency,''), currency),
    updated_at = now()
  where id = p_vendor_id and wedding_id = p_wedding_id;

  for it in
    select i.id, i.name, i.contracted_cents, i.contracted_source
      from budget_items i
     where i.vendor_id = p_vendor_id and i.wedding_id = p_wedding_id
     order by i.sort_order, i.name
  loop
    if it.contracted_cents is distinct from p_contracted_cents then
      update budget_items set
        contracted_cents = p_contracted_cents,
        contracted_source = 'vendor',
        currency = coalesce(nullif(p_currency,''), currency),
        updated_at = now()
      where id = it.id;

      v_changes := v_changes || jsonb_build_object(
        'item_id',    it.id,
        'item_name',  it.name,
        'from',       it.contracted_cents,
        'to',         p_contracted_cents,
        'was_manual', (it.contracted_source = 'manual' and it.contracted_cents is not null)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'vendor_from', v_before,
    'vendor_to',   p_contracted_cents,
    'items',       v_changes
  );
end;
$$;

revoke execute on function set_vendor_contracted_price(uuid, uuid, bigint, text) from public, anon, authenticated;

-- ------------------------------------------------------ category taxonomy (seed)
-- Per-wedding rows, seeded for the live wedding so the app has data the moment
-- this lands (0002_seed.sql precedent). Numbers are the real category totals from
-- the couple's spreadsheet. Idempotent on (wedding_id, slug): safe to re-run and
-- safe to run after Juliet has renamed a category (renames do not change slug).
insert into budget_categories
  (wedding_id, slug, name, sort_order, benchmark_cents, allocated_cents, is_contingency)
values
  ('11111111-1111-1111-1111-111111111111','venue',                 'Venue',                 0,  807900, 1537000, false),
  ('11111111-1111-1111-1111-111111111111','food-and-beverage',     'Food and Beverage',     1,  993300, 1650000, false),
  ('11111111-1111-1111-1111-111111111111','music-and-photography', 'Music + Photography',   2,  698400,  830000, false),
  ('11111111-1111-1111-1111-111111111111','other-vendors',         'Other Vendors',         3,    null,   50000, false),
  ('11111111-1111-1111-1111-111111111111','attire-and-beauty',     'Attire + Beauty',       4,  409300,  520000, false),
  ('11111111-1111-1111-1111-111111111111','gifts',                 'Gifts',                 5,  426100,  200000, false),
  ('11111111-1111-1111-1111-111111111111','flowers-and-decor',     'Flowers + Decor',       6,  172200,  500000, false),
  ('11111111-1111-1111-1111-111111111111','printing',              'Printing',              7,   35500,   30000, false),
  ('11111111-1111-1111-1111-111111111111','misc',                  'Misc',                  8,  210100,  400000, false),
  ('11111111-1111-1111-1111-111111111111','hotels',                'Hotels',                9,  343300,  300000, false),
  ('11111111-1111-1111-1111-111111111111','flights',               'Flights',              10,       0,  280000, false),
  ('11111111-1111-1111-1111-111111111111','contingency',           'Contingency',          11,    null,    null, true)
on conflict (wedding_id, slug) do nothing;
```

---

### 2. Non-obvious columns, justified

Each is annotated with a trailing SQL comment above. The five that most need to survive review:

- **`budget_categories.allocated_cents` vs the sum of item estimates.** The source spreadsheet has
  category-level plan numbers for categories with no line items yet (Flowers + Decor is planned at
  `$5,000` with zero itemised children). Without a top-down column, opening the app would show that
  category at `$0` and the couple's forecast would collapse. Rule, implemented in
  `lib/domain/budget-math.ts`: **category forecast = sum of item forecasts; if the category has zero
  items, category forecast = `coalesce(allocated_cents, 0)`.** Never add the two together.
- **`budget_items.contracted_source`.** The only way the UI can honour design decision 6 and say
  "we replaced the $5,000 you typed with the vendor's $5,400" instead of quietly swapping numbers.
- **`budget_items.pending_guest_count`.** Catering is the single largest line and cannot be settled
  until the final headcount. A boolean beats a fake precise number.
- **`budget_payments.kind = 'refund'` + the sign constraint.** Makes `sum(amount_cents) where paid`
  a correct definition of "Budget Spent" with no special-casing anywhere in TS.
- **The composite `(x_id, wedding_id)` FKs.** Single-column FKs would let a bug link a budget item to
  another wedding's category. `unique (id, wedding_id)` on each parent makes that structurally
  impossible. Note the deliberate `on delete restrict` on the nullable vendor FKs: a composite
  `SET NULL` would also null `wedding_id`, which is `NOT NULL`, so restrict + explicit unlink in the
  server action is the only correct combination.

**Derived, never stored** (do not add columns for these, no matter how convenient a query looks):
`actual spend`, `payment status`, `remaining balance`, `category rollups`, `vendor payment totals`,
`days until due`. All live in `lib/domain/budget-math.ts` so vitest can see them.

---

### 3. `budget_categories` seeding

- **Per-wedding rows, always.** No enum, no shared lookup table, no hardcoded list in a component.
  Juliet must be able to rename, reorder, add, and delete (when empty) categories — research is
  explicit that fixed lists make couples feel pigeon-holed.
- **Display order** is `sort_order` ascending, then `name`. The seeded order mirrors the couple's own
  spreadsheet top-to-bottom, which is the order she already thinks in: Venue, Food and Beverage,
  Music + Photography, Other Vendors, Attire + Beauty, Gifts, Flowers + Decor, Printing, Misc,
  Hotels, Flights, Contingency.
- **`slug` is the idempotency key**, not `name`. `unique (wedding_id, slug)` lets the seed and the CSV
  importer re-run safely and keeps working after a rename.
- **Two insertion paths, one source of truth:**
  1. `lib/domain/budget-taxonomy.ts` (new, pure, unit-tested) exports
     `export const DEFAULT_BUDGET_CATEGORIES: Array<{ slug: string; name: string; sortOrder: number; isContingency: boolean }>`
     — the 12 rows above without the wedding-specific money. Responsibility: the standard taxonomy
     for any wedding.
  2. `lib/data/budget.ts` exports `ensureCategories(scope: WeddingScope)` — upserts
     `DEFAULT_BUDGET_CATEGORIES` on conflict `(wedding_id, slug) do nothing`. Called once from the
     Budget page's first render path so a future wedding is never category-less.
  Migration 0011's literal `insert` covers the existing wedding *including its real money*, which
  `DEFAULT_BUDGET_CATEGORIES` deliberately does not carry.
- **Contingency is mandatory but unvalued.** Seeded with `allocated_cents = null` and
  `is_contingency = true`. The Budget page shows an inline prompt offering 5% / 8% / 10% of
  `weddings.budget_total_cents`; it must never silently pick one.
- **Line items are NOT seeded by a migration.** The ~70 line items come from
  `scripts/seed-budget.mjs` (new) reading
  `/Users/admin/Downloads/Wedding Budgeting Spreadsheet - Wedding Budget.csv` with `papaparse`,
  matching each block to a category by slug, and upserting on `(wedding_id, category_id, name)`.
  Reasons: the CSV is the source of truth, it is a trial-run dataset the client will redo, and 70
  hand-transcribed SQL rows would rot. The script must be re-runnable and must print a
  per-category reconciliation table before writing.

**Open questions for Juliet — surface these, do not guess:**
1. The spreadsheet's stated forecast total is **$60,170**, but the eleven category allocations sum to
   **$62,970**. The difference is exactly the **Flights** category ($2,800), which the sheet's total
   row appears to exclude. Ask whether flights count against the wedding budget.
2. The stated benchmark total is **$40,962**; the category benchmarks sum to **$40,961** ($1 of
   sheet rounding). Display the summed figure, footnote the stated one.
3. Category benchmarks do not always equal the sum of their children (Food and Beverage: stated
   $9,933, children sum $10,254). §4 resolves this mechanically; the discrepancy itself is hers to
   explain.
4. **Currency:** the venue is in Guadalajara but the spreadsheet is USD. Every row stores
   `currency default 'USD'`, values display exactly as entered, and **no FX conversion happens
   anywhere**. If any row is ever saved with a non-USD currency, the Budget page shows a persistent
   "mixed currency — totals are not converted" notice rather than adding unlike units.

---

### 4. Where the benchmark lives

**Both levels, with defined precedence.**

- **Item level — `budget_items.benchmark_cents`** is the primary store. This is the signature
  feature: every line shows the benchmark wedding's actual spend beside the couple's number with a
  delta, inline and adjacent (Zola A/B-tested adjacent numbers against a toggle; users strongly
  preferred adjacent).
- **Category level — `budget_categories.benchmark_cents`** is a nullable **override of the item sum**,
  not an addition to it. It exists because the source spreadsheet's own category totals do not always
  reconcile with their children, and silently "correcting" the client's numbers would be wrong.
- **Resolution rule** (implement once, in `lib/domain/budget-math.ts`, unit-tested):
  `categoryBenchmark = category.benchmark_cents ?? sum(items.benchmark_cents)`.
  When both exist and disagree, the category tile renders the stated figure and a small
  `text-[11px] text-[#8a8f86]` footnote `"line items total $X"`. Grand total = sum of resolved
  category benchmarks.
- **`benchmark_cents is null`** means *unknown* and must render as `—`, never `$0`. `0` means
  *the benchmark wedding genuinely spent nothing* (Flights). These are different and the UI must not
  conflate them.
- **The label lives in `weddings.budget_benchmark_label`** (`text not null default 'Alison''s
  wedding'`). Every page reads it exactly like the timezone:
  `const benchmarkLabel: string = wedding?.budget_benchmark_label ?? "Benchmark";`
  **No component, column header, export header, tooltip, or empty state may contain the string
  "Alison".** A grep for `Alison` across `app/`, `components/` and `lib/` must return zero hits;
  make that an acceptance check.

---

### 5. Attachments — schema now, UI later

**Judgment: attachments are a LATER milestone.** The module is useful and shippable without them;
file upload adds a Storage bucket, signed-URL plumbing, MIME/size validation and a delete path, none
of which the three headline numbers or the benchmark column need. The schema is fully specified here
so it never has to be migrated twice.

~~`supabase/migrations/0012_budget_attachments.sql`~~ — **SUPERSEDED by Binding Decision 6.** Do not
apply this migration and do not create a Storage bucket; there is no Blob or Storage integration
configured in this project. Attachments are pasted links in `vendors.contract_url` and
`budget_payments.receipt_url`. The DDL below is retained only as a starting point for a future
migration, should Juliet later ask for real uploads:

```sql
-- 0012: contract / invoice / receipt attachments for the budget & vendor module.
-- Bucket is PRIVATE. Only the service-role client (lib/supabase/admin.ts) ever
-- touches storage; browsers receive short-lived signed URLs minted by a server
-- action behind requireAdmin(). Deliberately NO policies on storage.objects for
-- this bucket: storage.objects has RLS on with no matching policy, so anon and
-- authenticated get nothing, which is exactly right.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wedding-documents',
  'wedding-documents',
  false,
  20971520,                                                                              -- 20 MB; contracts are PDFs and receipts are phone photos
  array['application/pdf','image/jpeg','image/png','image/heic','image/webp']
)
on conflict (id) do nothing;

create table budget_attachments (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  vendor_id uuid,
  budget_item_id uuid,
  budget_payment_id uuid,
  kind text not null default 'other'
    check (kind in ('contract','invoice','receipt','quote','other')),
  storage_path text not null unique,                                                     -- path inside the bucket; unique so a re-upload can never shadow an existing object
  file_name text not null,                                                               -- the human's original filename, shown in the UI; storage_path is randomised and unreadable
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint budget_attachments_one_owner
    check (num_nonnulls(vendor_id, budget_item_id, budget_payment_id) = 1),              -- an attachment belongs to exactly one thing; "contract" hangs off a vendor, "receipt" off a payment
  constraint budget_attachments_vendor_fk
    foreign key (vendor_id, wedding_id) references vendors (id, wedding_id) on delete cascade,
  constraint budget_attachments_item_fk
    foreign key (budget_item_id, wedding_id) references budget_items (id, wedding_id) on delete cascade,
  constraint budget_attachments_payment_fk
    foreign key (budget_payment_id, wedding_id) references budget_payments (id, wedding_id) on delete cascade
);

create index budget_attachments_vendor on budget_attachments (vendor_id);
create index budget_attachments_item on budget_attachments (budget_item_id);
create index budget_attachments_payment on budget_attachments (budget_payment_id);
create index budget_attachments_wedding on budget_attachments (wedding_id, created_at desc);

alter table budget_attachments enable row level security;
create policy budget_attachments_select on budget_attachments for select using (is_wedding_member(wedding_id));
create policy budget_attachments_insert on budget_attachments for insert with check (is_wedding_editor(wedding_id));
create policy budget_attachments_update on budget_attachments for update using (is_wedding_editor(wedding_id));
create policy budget_attachments_delete on budget_attachments for delete using (is_wedding_editor(wedding_id));
```

**Storage contract:**
- **Bucket:** `wedding-documents`, **private** (`public = false`).
- **Path convention:** `{wedding_id}/{owner_kind}/{owner_id}/{nanoid(12)}-{sanitized_file_name}`
  where `owner_kind ∈ vendor | item | payment`. `nanoid` is already a dependency. Sanitise to
  `[a-zA-Z0-9._-]`, truncate to 80 chars. Wedding id first so a future tenant purge is one prefix
  delete.
- **Reads:** never a public URL. `lib/data/attachments.ts` exports
  `signedUrl(scope, attachmentId): Promise<string>` → `requireAdmin()` in the caller, verify the row's
  `wedding_id` matches `scope.weddingId`, then `db.storage.from("wedding-documents").createSignedUrl(path, 600)`.
  Ten minutes; do not cache the URL.
- **Writes:** upload through a server action (`requireEditor()`), never a browser-side upload with the
  anon key. Insert the `budget_attachments` row **after** the object lands; on insert failure, delete
  the object so no orphans accumulate.
- **Deletes:** delete the storage object first, then the row. A stale row pointing at a missing object
  renders a broken link; a stale object is invisible and unbillable-but-untracked — the row is the
  more important thing to remove last.
- **No `storage.objects` policies.** If the bucket must be created by hand instead (some projects
  restrict `insert into storage.buckets` over the API), create it in the Supabase dashboard as
  **private** with the same limits, and keep the rest of the migration.

---

### 6. `vendor_tasks` — the LAST milestone

`supabase/migrations/0013_vendor_tasks.sql`. **Do not begin here.** This table backs exactly one
dashboard card ("Tasks Due This Week") plus a small list; it is worth nothing until vendors and the
budget ledger exist. It is written out now only so the schema is settled.

```sql
-- 0013: lightweight task list backing the "Tasks Due This Week" dashboard card.
-- Deliberately minimal: no assignees beyond the two admins, no sub-tasks, no
-- recurrence, no dependencies. This is a checklist, not a project manager.

create table vendor_tasks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings(id) on delete cascade,
  vendor_id uuid,                                                                        -- nullable: plenty of tasks ("book the shuttle") have no vendor row yet
  budget_item_id uuid,
  title text not null,
  due_date date,                                                                         -- CALENDAR DATE. "Due this week" is bucketed in the venue's timezone, not the server's
  done boolean not null default false,
  done_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,                          -- two users total; a free-text name would be worse
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_tasks_done_at_required check (done = false or done_at is not null),
  constraint vendor_tasks_vendor_fk
    foreign key (vendor_id, wedding_id) references vendors (id, wedding_id) on delete cascade,
  constraint vendor_tasks_item_fk
    foreign key (budget_item_id, wedding_id) references budget_items (id, wedding_id) on delete set null
);

create index vendor_tasks_due on vendor_tasks (wedding_id, done, due_date);
create index vendor_tasks_vendor on vendor_tasks (vendor_id);

alter table vendor_tasks enable row level security;
create policy vendor_tasks_select on vendor_tasks for select using (is_wedding_member(wedding_id));
create policy vendor_tasks_insert on vendor_tasks for insert with check (is_wedding_editor(wedding_id));
create policy vendor_tasks_update on vendor_tasks for update using (is_wedding_editor(wedding_id));
create policy vendor_tasks_delete on vendor_tasks for delete using (is_wedding_editor(wedding_id));
```

Note: `budget_item_id` uses `on delete set null` because it is nullable *and* `budget_items` deletion
is a normal operation — but a composite `SET NULL` also nulls `wedding_id`. **Postgres 15+ column-list
form is required here:** if `on delete set null` on the composite FK is rejected by the server
version, change that one constraint to `on delete restrict` and have the delete-item server action
clear `budget_item_id` on its tasks first. Verify with
`mcp__supabase__execute_sql` → `select version();` before applying, and pick the working form.

Until 0013 is applied, the "Tasks Due This Week" dashboard card renders as a disabled placeholder
tile reading `Tasks` / `—` / `Coming soon`; it must not crash or be silently dropped from the grid.

---

### 7. Generated + hand-written types

**Generated (reference only).** After each migration is applied, run
`mcp__supabase__generate_typescript_types` and write the output to **`lib/supabase/database.types.ts`**
(new file; none exists today). Header comment: `// Generated by mcp__supabase__generate_typescript_types. Do not edit by hand.`

**Do NOT parameterise the clients.** `adminDb()` in `lib/supabase/admin.ts` and
`WeddingScope["db"]` in `lib/data/scope.ts` stay as untyped `SupabaseClient`. Introducing
`createClient<Database>` would retype every existing query in the app and is out of scope for this
build — the hand-written row types below remain the app's contract. `database.types.ts` exists so the
agent can diff the live schema against the migration and catch a drifted column name.

**Hand-written, appended to `lib/types.ts`** (existing style: flat serializable row types, `snake_case`
keys matching the DB, `| null` for nullable columns):

```ts
export type VendorStatus =
  | "researching" | "contacted" | "quoted" | "booked" | "completed" | "passed";
export type PaymentKind = "deposit" | "installment" | "final" | "refund";
export type ContractedSource = "manual" | "vendor";
export type AttachmentKind = "contract" | "invoice" | "receipt" | "quote" | "other";

export type VendorRow = {
  id: string; wedding_id: string; category_id: string | null;
  name: string; role: string | null; status: VendorStatus;
  contact_name: string | null; email: string | null; phone: string | null;
  website: string | null; address: string | null;
  quoted_cents: number | null; contracted_cents: number | null; currency: string;
  contract_signed_at: string | null;   // calendar date "YYYY-MM-DD" — never new Date()
  booked_at: string | null;            // calendar date
  notes: string | null; sort_order: number;
};

export type BudgetCategoryRow = {
  id: string; wedding_id: string; name: string; slug: string; sort_order: number;
  allocated_cents: number | null; benchmark_cents: number | null;
  is_contingency: boolean; notes: string | null;
};

export type BudgetItemRow = {
  id: string; wedding_id: string; category_id: string; vendor_id: string | null;
  name: string; quantity: number | null; unit_cents: number | null;
  benchmark_cents: number | null; estimated_cents: number | null;
  quoted_cents: number | null; contracted_cents: number | null;
  contracted_source: ContractedSource; currency: string;
  pending_guest_count: boolean; notes: string | null; sort_order: number;
};

export type BudgetPaymentRow = {
  id: string; wedding_id: string; budget_item_id: string; vendor_id: string | null;
  label: string; kind: PaymentKind; amount_cents: number; currency: string;
  due_date: string | null;   // calendar date
  paid: boolean;
  paid_on: string | null;    // calendar date
  method: string | null; reference: string | null; notes: string | null; sort_order: number;
};

export type BudgetAttachmentRow = {
  id: string; wedding_id: string;
  vendor_id: string | null; budget_item_id: string | null; budget_payment_id: string | null;
  kind: AttachmentKind; storage_path: string; file_name: string;
  mime_type: string | null; size_bytes: number | null; created_at: string;
};

export type VendorTaskRow = {
  id: string; wedding_id: string; vendor_id: string | null; budget_item_id: string | null;
  title: string; due_date: string | null;   // calendar date
  done: boolean; done_at: string | null; assigned_to: string | null;
  notes: string | null; sort_order: number;
};

/** What set_vendor_contracted_price returns, so the UI can say what changed. */
export type VendorPriceSyncResult = {
  vendor_from: number | null;
  vendor_to: number;
  items: Array<{ item_id: string; item_name: string; from: number | null; to: number; was_manual: boolean }>;
};

/** Dashboard budget/vendor numbers. SEPARATE from OverviewMetrics on purpose. */
export type BudgetMetrics = {
  budgetTotalCents: number | null;   // weddings.budget_total_cents — null means "not set", render a prompt not $0
  forecastCents: number;             // sum of category forecasts
  benchmarkCents: number;            // sum of resolved category benchmarks
  spentCents: number;                // sum(amount_cents) where paid
  remainingCents: number;            // forecastCents - spentCents
  scheduledUnpaidCents: number;      // sum(amount_cents) where not paid   ("Total Due")
  dueThisMonthCents: number;
  dueThisMonthCount: number;
  overdueCount: number;
  vendorsBooked: number;             // status in ('booked','completed')
  vendorsPending: number;            // status in ('researching','contacted','quoted')  — 'passed' counts in neither
  contractsOutstanding: number;      // status in ('booked','completed') and contract_signed_at is null
  tasksDueThisWeek: number;          // 0 until migration 0013 is applied
};
```

**Do not extend `OverviewMetrics`.** Adding fields would force `metrics.overview()` to supply them and
risk the 257 passing tests. Add `metrics.budget(scope): Promise<BudgetMetrics>` to
`lib/data/metrics.ts` as a separate cached call, key `` `metrics:${scope.weddingId}:budget` ``, TTL
60s, invalidated via `invalidateCache(\`metrics:${scope.weddingId}\`)` from every budget/vendor
mutation.

---

### 8. Acceptance checks for this slice

Run each with `mcp__supabase__execute_sql` unless noted.

1. **Tables exist, RLS on.** `mcp__supabase__list_tables` (schema `public`) shows `vendors`,
   `budget_categories`, `budget_items`, `budget_payments` with `rls_enabled: true`.
2. **Exactly four policies per table, correctly named.**
   ```sql
   select tablename, count(*) as policies, string_agg(policyname, ',' order by policyname) as names
     from pg_policies
    where schemaname = 'public'
      and tablename in ('vendors','budget_categories','budget_items','budget_payments')
    group by tablename order by tablename;
   ```
   Every row must show `policies = 4` and names ending `_delete,_insert,_select,_update`.
3. **SECURITY CHECK — no new function is executable by anon.** This is the gate; the module does not
   ship if it fails.
   ```sql
   select p.proname,
          has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
          has_function_privilege('service_role',  p.oid, 'EXECUTE') as service_role
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('apply_payment_schedule','set_vendor_contracted_price');
   ```
   Required: two rows, `anon = false`, `authenticated = false`, `service_role = true`.
   Follow with the live probe, modelled on `scripts/verify-rsvp-rpc-grants.mjs`: add
   **`scripts/verify-budget-rpc-grants.mjs`** (responsibility: prove anon gets Postgres `42501` on
   both RPCs while service_role still executes). `node scripts/verify-budget-rpc-grants.mjs` must
   print `PASS` on every line and exit 0.
4. **Advisors clean.** `mcp__supabase__get_advisors` with `type: "security"` reports no new finding
   naming any of the new tables, functions or the bucket.
5. **Composite tenancy FKs are real.**
   ```sql
   select conname, pg_get_constraintdef(oid)
     from pg_constraint
    where conrelid in ('budget_items'::regclass,'budget_payments'::regclass,'vendors'::regclass)
      and contype = 'f' order by conname;
   ```
   Every foreign key definition must include `wedding_id` in both column lists.
6. **Category seed landed.**
   ```sql
   select count(*) as categories,
          sum(benchmark_cents) as benchmark_total,
          sum(allocated_cents) as allocated_total,
          count(*) filter (where is_contingency) as contingency
     from budget_categories
    where wedding_id = '11111111-1111-1111-1111-111111111111';
   ```
   Expect `categories = 12`, `benchmark_total = 4096100` ($40,961), `allocated_total = 6297000`
   ($62,970), `contingency = 1`.
7. **Cross-tenant insert is rejected.** Attempt to insert a `budget_items` row whose `category_id`
   belongs to the seeded wedding but whose `wedding_id` is `'99999999-9999-9999-9999-999999999999'`;
   it must fail with foreign-key violation `23503`. (Run inside `begin; ... rollback;`.)
8. **Paid-payment guard.** `insert into budget_payments (..., paid, paid_on) values (..., true, null)`
   must fail check constraint `budget_payments_paid_on_required`. Roll back.
9. **Refund sign guard.** `kind = 'installment'` with a negative `amount_cents` must fail
   `budget_payments_amount_sign`. Roll back.
10. **Types compile.** `npx tsc --noEmit` exits 0 after `lib/types.ts` and
    `lib/supabase/database.types.ts` land.
11. **Nothing regressed.** `npm test` still reports **≥ 257 passing, 0 failing**.
12. **No hardcoded benchmark name.**
    `grep -ri "alison" /Users/admin/guest-crm/app /Users/admin/guest-crm/components /Users/admin/guest-crm/lib`
    returns **zero** matches. The name lives only in `weddings.budget_benchmark_label` and in
    migration 0011's default.
13. **What a human sees.** Nothing yet — this slice ships no UI. The proof a human can check is in
    the Supabase table editor: twelve category rows in the couple's own order, Venue first, with
    `benchmark_cents = 807900` and `allocated_cents = 1537000`.

---

### 9. Contracts other sections must honour

- **Activity log needs no schema change.** `activity_log` already has `wedding_id`, `actor_type`,
  `action`, `payload jsonb`. Vendor/item/payment ids go in `payload`. Do **not** add
  `vendor_id`/`budget_item_id` columns to it. Action strings the data layer emits:
  `vendor.created`, `vendor.updated`, `vendor.status_changed`, `vendor.deleted`,
  `vendor.price_synced`, `budget.category_created`, `budget.category_updated`,
  `budget.category_deleted`, `budget.item_created`, `budget.item_updated`, `budget.item_deleted`,
  `budget.payment_created`, `budget.payment_updated`, `budget.payment_marked_paid`,
  `budget.payment_deleted`, `budget.schedule_replaced`, `budget.csv_seeded`,
  `attachment.uploaded`, `attachment.deleted`, `task.created`, `task.completed`, `task.deleted`.
- **`on delete restrict` means the server actions must unlink first.** Exact readable copy, so it is
  consistent everywhere:
  - Delete a category with items → refuse: `"Venue still has 6 line items. Move or delete them first."`
  - Delete a vendor linked to items → the confirm dialog says
    `"Bloom & Co. is linked to 2 budget items. Deleting the vendor keeps those items and their numbers — it just unlinks them."`
    then the action nulls `budget_items.vendor_id` and `budget_payments.vendor_id`, then deletes.
- **Every date column named `*_date`, `*_at` of type `date`** (`due_date`, `paid_on`,
  `contract_signed_at`, `booked_at`) is a **calendar day with no timezone**. Never `new Date(value)`.
  Use `formatCalendarDate` / `daysUntilCalendarDate` from `lib/format/wedding-date.ts` with
  `const timeZone: string = wedding?.timezone ?? "America/Los_Angeles";`. "Due in 3 days", "due this
  month" and "due this week" are all bucketed in the venue's timezone. Vercel runs UTC, so getting
  this wrong is invisible locally and wrong in production.
- **`lib/format/money.ts` must handle the spreadsheet's vocabulary:** `parseMoneyInput` returns
  `null` for `""`, `"-"`, `"–"`, and `"n/a"`, strips `$`, commas and whitespace, accepts `"1,234.56"`
  → `123456`, and returns `null` (not `0`, not `NaN`) for anything unparseable. `formatMoney(null)`
  returns `"—"`. Both unit-tested in `lib/format/money.test.ts`.
- **No SQL views and no generated columns for rollups.** vitest only sees `lib/**`, so every derived
  number must be computed in `lib/domain/budget-math.ts` where it can be tested.
- **`updated_at` is set explicitly by the writer** (`updated_at: new Date().toISOString()`). This repo
  has no triggers anywhere; do not add one.

---

## Data Layer, Server Actions & Tests

This section owns everything between Postgres and the pages: the two I/O shells, the four pure
rule/format modules they delegate to, the metrics extension, the two server-action files, and the
test suite. It owns **no JSX**. Pages, components and nav belong to other sections; migrations and
seeding belong to the migration section. Where this section names a column, that column name is a
**contract** the migration section must match exactly.

---

### 0. Corrections and standing facts the executing agent must know

**Test baseline is 257, not 107 and not 250.** Measured on `main` at spec time:

```
$ npm test
 Test Files  26 passed (26)
      Tests  250 passed (250)
```

Any statement elsewhere in this document that the baseline is 107 or 250 is stale. **The number to beat is
250 passing tests in 26 files.** Re-measure before you start; if the baseline has moved, use the
measured number.

**`daysUntilCalendarDate` is floored at zero and therefore CANNOT detect an overdue payment.**
Read `lib/format/wedding-date.ts:51` — it ends `Math.max(0, ...)`. A payment due yesterday and a
payment due today both return `0`. Every "overdue" feature in this module would silently report
"due today" forever. Section 3.1 below adds a signed sibling. Do not work around this any other
way, and above all do not call `new Date(dueDate)`.

**Guadalajara is `America/Mexico_City`** (UTC−6, no DST since 2022). `weddings.timezone` currently
reads `America/Los_Angeles` and that mismatch is an unresolved open question owned by the user — do
**not** change the stored value. Read the timezone from the row, pass it down, never hardcode it.

**No tasks table exists.** The client's requested card "Tasks Due This Week" has no data source.
This section deliberately does **not** invent one. `overview()` returns no `tasksDueThisWeek`. See
§4.4 for what to do instead.

---

### 1. Table + column contract this layer depends on

The migration section writes the DDL (`supabase/migrations/0012_*.sql` onward). These are the exact
identifiers this layer queries. Money is `bigint` cents everywhere; there is no `numeric`, no
`float`, and no column named `*_amount` or `*_price` without a `_cents` suffix.

**`vendors`**

| column | type | notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `wedding_id` | `uuid not null references weddings(id) on delete cascade` | |
| `name` | `text not null` | |
| `role` | `text not null default 'other'` | free text, not an enum — research says fixed lists make couples feel pigeon-holed |
| `status` | `text not null default 'researching'` | check in (`researching`,`contacted`,`quoted`,`booked`,`completed`,`passed`) |
| `contact_name`, `email`, `phone`, `website`, `address` | `text null` | |
| `quoted_cents`, `contracted_cents` | `bigint null` | |
| `currency` | `text not null default 'USD'` | |
| `contract_signed_at` | `date null` | null while booked-but-unsigned → "Contracts Outstanding" |
| `contract_url` | `text null` | a pasted link, **not** an upload — see §1.1 |
| `rating` | `smallint null` | 1–5, nullable |
| `notes` | `text null` | |
| `sort_order` | `integer not null default 0` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

**`budget_categories`**

| column | type | notes |
|---|---|---|
| `id`, `wedding_id` | as above | |
| `name` | `text not null` | |
| `target_cents` | `bigint null` | optional allocation target written by percentage seeding |
| `is_contingency` | `boolean not null default false` | exactly one row should be true after seeding |
| `notes` | `text null` | |
| `sort_order` | `integer not null default 0` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

**There is no category-level money column other than `target_cents`.** Every category benchmark,
estimate, quote, contract and spend figure is **derived** by summing its items (§3.2). A stored
category total is a number that drifts the first time someone edits an item, and drift is exactly
what the couple abandoned the spreadsheet over.

**`budget_items`**

| column | type | notes |
|---|---|---|
| `id`, `wedding_id` | as above | |
| `category_id` | `uuid not null references budget_categories(id) on delete cascade` | |
| `vendor_id` | `uuid null references vendors(id) on delete set null` | deleting a vendor must never delete a budget line |
| `name` | `text not null` | |
| `benchmark_cents` | `bigint null` | **Alison's actual.** The signature column. |
| `estimated_cents` | `bigint null` | |
| `quoted_cents` | `bigint null` | |
| `contracted_cents` | `bigint null` | |
| `quantity` | `integer null` | provenance from the CSV's `Qty` |
| `unit_price_cents` | `bigint null` | provenance from the CSV's `Each` |
| `currency` | `text not null default 'USD'` | |
| `pending_guest_count` | `boolean not null default false` | Aisle Planner's catering flag |
| `notes` | `text null` | |
| `sort_order` | `integer not null default 0` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

**There is no `actual_cents` column.** Actual spend is `sum(amount_cents) where paid` over the
item's payments. `quantity` and `unit_price_cents` are **display-only provenance** — no rollup in
this section ever multiplies them. If they disagree with `estimated_cents`, `estimated_cents` wins
and the UI shows the quantity as a caption.

**`budget_payments`**

| column | type | notes |
|---|---|---|
| `id`, `wedding_id` | as above | |
| `item_id` | `uuid not null references budget_items(id) on delete cascade` | |
| `label` | `text not null default 'Payment'` | e.g. "Deposit", "Final balance" |
| `amount_cents` | `bigint not null` | |
| `due_date` | `date null` | **a calendar day — §3.1 rules apply** |
| `paid` | `boolean not null default false` | |
| `paid_on` | `date null` | must be null when `paid = false` |
| `method` | `text null` | |
| `reference` | `text null` | check number / confirmation code |
| `receipt_url` | `text null` | a pasted link, not an upload |
| `notes` | `text null` | |
| `sort_order` | `integer not null default 0` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

**One `alter` on an existing table:** `weddings.budget_total_cents bigint null` — Zola's "Max
Spend". This is the only change to an existing table and it is additive and nullable, so every
existing `weddings` select keeps compiling.

#### 1.1 Attachments are URLs, not uploads

Research says contracts/receipts matter. Vercel Blob is available but adding an upload pipeline is
a separate slice. v1 stores `vendors.contract_url` and `budget_payments.receipt_url` as pasted
links (Drive/Dropbox). **Do not create an `attachments` table** — the four-table decision is
binding. Record "real file uploads" as a follow-up, not a gap.

---

### 2. `lib/format/money.ts` — money formatting and parsing

**Responsibility:** the only place in the codebase that turns cents into text or text into cents.
Pure, zero imports, no `Intl.NumberFormat` currency mode (it emits `US$` in some locales — build the
string with `Intl.NumberFormat("en-US", { minimumFractionDigits, maximumFractionDigits })` on the
number part and prefix `$` by hand).

**Pattern to copy:** `lib/format/wedding-date.ts` — a short module, one doc-comment per export
explaining the bug it prevents.

```ts
/** Thrown by parseMoneyInput when the text is not an amount. Carries her-words copy. */
export class MoneyParseError extends Error {}

export type MoneyParse =
  | { ok: true; cents: number | null }
  | { ok: false; message: string };

export function formatMoney(cents: number | null | undefined): string;
export function formatMoneyExact(cents: number | null | undefined): string;
export function formatMoneySigned(cents: number | null | undefined): string;
export function centsToInputValue(cents: number | null | undefined): string;
export function tryParseMoney(raw: string | null | undefined): MoneyParse;
export function parseMoneyInput(raw: string | null | undefined): number | null;
export function formatPercent(fraction: number | null, opts?: { signed?: boolean }): string;
export function formatDelta(
  benchmarkCents: number | null,
  actualCents: number | null,
): { text: string; pct: string | null; tone: "over" | "under" | "even" | "unknown" };
```

**Exact behaviour, edge by edge.** Each row is a test case in §6.1.

`formatMoney`
| input | output | why |
|---|---|---|
| `null` / `undefined` | `"—"` (U+2014) | "not entered" must not read as "$0" |
| `0` | `"$0"` | an explicit zero is a real answer |
| `1537000` | `"$15,370"` | round dollars hide the cents |
| `1536999` | `"$15,369.99"` | non-round shows exactly 2 dp |
| `-120000` | `"-$1,200"` | over budget; ASCII hyphen, sign outside the `$` |
| `-1` | `"-$0.01"` | |
| `125000000` | `"$1,250,000"` | never abbreviate to `1.25M` |
| `100000000000` | `"$1,000,000,000"` | grouping holds at any size |
| `NaN` / `Infinity` | `"—"` | never render `$NaN` on the couple's dashboard |

`formatMoneyExact` — same, but always 2 dp (`1537000 → "$15,370.00"`). Used only in CSV export and
in the "amount you are about to pay" confirmation, where hiding `.00` reads as truncation.

`formatMoneySigned` — as `formatMoney` but a positive value gains a leading `+` (`+$2,400`).
`0 → "$0"` with no sign. Used for benchmark deltas.

`centsToInputValue` — for the `value`/`defaultValue` of a text input. `null → ""`, `1537000 →
"15370"`, `1536999 → "15369.99"`. No `$`, no commas, so a round-trip through `parseMoneyInput` is
lossless.

`tryParseMoney` / `parseMoneyInput`
| input | result | why |
|---|---|---|
| `null`, `undefined`, `""`, `"   "` | `{ ok: true, cents: null }` | blank means "not entered", never `0` |
| `"0"` | `{ ok: true, cents: 0 }` | distinct from blank |
| `"$15,370"` | `1537000` | strip `$`, `,`, ASCII space, NBSP (U+00A0), narrow NBSP (U+202F) |
| `"15370.5"` | `1537050` | one decimal place is padded |
| `"15370.50"` | `1537050` | |
| `".5"` | `50` | |
| `"-$500"` | `-50000` | leading `-` allowed, before or after `$` |
| `"$-500"` | `-50000` | |
| `"1 234"` | `123400` | |
| `"15370.005"` | `{ ok: false, message: "Amounts can only go to the cent." }` | never silently round money |
| `"abc"`, `"$"`, `"1.2.3"`, `"12e5"`, `"--5"`, `"1,2,3.4.5"` | `{ ok: false, message: "That doesn't look like an amount." }` | |
| `"1000000001"` (> $1B) | `{ ok: false, message: "That's larger than any wedding budget — check for a typo." }` | typo guard |

**Parsing must be string-based, not float-based.** `Math.round(parseFloat(s) * 100)` is **banned**
in this module: `parseFloat("1.005") * 100` is `100.49999999999999`. Split on `.`, validate each
half against `/^\d*$/`, right-pad the fraction to exactly 2 chars, then
`Number(intPart) * 100 + Number(fracPart)` with the sign applied last. Add that reasoning as a
comment — a future agent will "simplify" it back otherwise.

`parseMoneyInput` is `tryParseMoney` with `{ ok: false }` rethrown as `MoneyParseError(message)`.
Server actions call `tryParseMoney` (so they can attach the message to the right field);
`lib/data/*` internals call `parseMoneyInput`.

`formatPercent` — `0.184 → "18%"`, `{ signed: true } → "+18%"`, `null → "—"`, `-0.05 → "-5%"`.
Rounds to a whole percent. Never `"18.4%"` on a card.

`formatDelta(benchmark, actual)` — the signature feature's text:
- `benchmark == null || actual == null` → `{ text: "—", pct: null, tone: "unknown" }`
- equal → `{ text: "same", pct: "0%", tone: "even" }`
- `actual > benchmark` → `{ text: "+$7,291 over Alison", pct: "+90%", tone: "over" }`
- `actual < benchmark` → `{ text: "-$1,277 under Alison", pct: "-100%", tone: "under" }`
- `benchmark === 0 && actual > 0` → `{ text: "+$500 (Alison spent nothing)", pct: null, tone: "over" }`
  — **no division by zero, no `Infinity%`**.

---

### 3. Pure rule modules

Every function below is pure: no `Date.now()`, no `Math.random()`, no imports outside
`lib/format/*`. Clocks arrive as a `now: Date` parameter. This is not style — vitest only sees
`lib/**`, so anything not here is untested forever.

**Pattern to copy:** `lib/data/event-rules.ts` — exported `*Fact` input types that are structural
subsets of the DB row, a doc-comment per export naming the bug it prevents, set-based dedupe.

#### 3.1 Additions to `lib/format/wedding-date.ts`

Do **not** modify `formatCalendarDate` or `daysUntilCalendarDate` — `lib/format/wedding-date.test.ts`
pins them. Append three exports:

```ts
/**
 * Signed whole days from today-at-the-venue to `date`. Negative = in the past.
 * `daysUntilCalendarDate` floors at zero, which makes yesterday and today
 * indistinguishable — fine for a countdown, fatal for "is this payment overdue".
 */
export function calendarDayDelta(date: string, now: Date, timeZone: string): number;

/** Today at the venue as a `date`-shaped string: "2026-07-29". */
export function todayAtVenue(now: Date, timeZone: string): string;

/** True when two "YYYY-MM-DD" strings share a year and month. Pure string compare. */
export function sameCalendarMonth(a: string, b: string): boolean;
```

`calendarDayDelta` reuses the existing private `calendarDayAt` helper (widen it or export it
internally); `daysUntilCalendarDate` should then be rewritten as
`Math.max(0, calendarDayDelta(date, now, timeZone))` so there is one implementation. An
unparseable `date` returns `0` from `calendarDayDelta`, matching the existing convention.
`todayAtVenue` must zero-pad month and day (`en-CA` `formatToParts` already gives 2-digit values).

#### 3.2 `lib/data/budget-rules.ts`

**Responsibility:** every number the budget module shows, computed from plain facts.

```ts
// ---- Input facts (structural subsets of the DB rows) ----
export type PaymentFact = {
  id: string;
  item_id: string;
  label: string;
  amount_cents: number;
  due_date: string | null;
  paid: boolean;
  paid_on: string | null;
};

export type ItemFact = {
  id: string;
  category_id: string;
  vendor_id: string | null;
  name: string;
  benchmark_cents: number | null;
  estimated_cents: number | null;
  quoted_cents: number | null;
  contracted_cents: number | null;
  currency: string;
  pending_guest_count: boolean;
  sort_order: number;
};

export type CategoryFact = {
  id: string;
  name: string;
  target_cents: number | null;
  is_contingency: boolean;
  sort_order: number;
};

// ---- Derived shapes ----
export type PaymentStatus = "paid" | "overdue" | "due_soon" | "upcoming" | "unscheduled";
export type ItemPaymentStatus = "unpaid" | "partial" | "paid" | "overdue";
export type CostStage = "benchmark" | "estimated" | "quoted" | "contracted";
export type BudgetHealth = "under" | "on_track" | "tight" | "over" | "unset";

export type BenchmarkDelta = {
  benchmarkCents: number | null;
  actualCents: number | null;
  deltaCents: number | null;
  /** Fraction, not percent: 0.9 means 90% over. Null when benchmark is 0 or null. */
  pct: number | null;
  direction: "over" | "under" | "even" | "unknown";
};

export type PaymentView = PaymentFact & {
  status: PaymentStatus;
  /** Signed days from today-at-venue. Negative = overdue. Null when due_date is null. */
  daysOut: number | null;
  label_due: string; // "Due today" | "Due in 3 days" | "4 days overdue" | "Paid Jul 12" | "No due date"
};

export type ItemRollup = {
  item: ItemFact;
  payments: PaymentView[];
  /** Sum of ALL payment rows, paid or not. */
  scheduledCents: number;
  /** Sum of paid payments. This IS "actual spend" — nothing stores it. */
  paidCents: number;
  /** Sum of unpaid payments. */
  outstandingScheduledCents: number;
  /** contracted ?? quoted ?? estimated ?? 0 — the single forecast number. */
  forecastCents: number;
  /** Which column forecastCents came from, so the UI can caption it. */
  forecastStage: CostStage | null;
  /** forecastCents - paidCents, floored at 0. What is still owed. */
  remainingCents: number;
  /** remainingCents - outstandingScheduledCents, floored at 0. Owed with no payment row yet. */
  unscheduledCents: number;
  paymentStatus: ItemPaymentStatus;
  benchmark: BenchmarkDelta;
  hasOverdue: boolean;
};

export type CategoryRollup = {
  category: CategoryFact;
  items: ItemRollup[];
  benchmarkCents: number;   // Σ item benchmark, nulls as 0
  estimatedCents: number;   // Σ item estimated, nulls as 0
  quotedCents: number;
  contractedCents: number;
  forecastCents: number;
  paidCents: number;
  remainingCents: number;
  unscheduledCents: number;
  benchmark: BenchmarkDelta; // category benchmark vs category forecast
  overdueCount: number;
  /** Share of the whole wedding's forecast, as a fraction. */
  shareOfForecast: number;
};

export type BudgetTotals = {
  maxSpendCents: number | null;
  benchmarkCents: number;
  estimatedCents: number;
  quotedCents: number;
  contractedCents: number;
  /** Zola's "Total Cost". */
  forecastCents: number;
  /** Zola's "Total Spent". */
  paidCents: number;
  /** Zola's "Total Due" = forecast - paid. */
  dueCents: number;
  outstandingScheduledCents: number;
  unscheduledCents: number;
  /** maxSpend - forecast. Negative = over budget. Null when maxSpend unset. */
  remainingAfterForecastCents: number | null;
  /** maxSpend - paid. Null when maxSpend unset. */
  remainingAfterPaidCents: number | null;
  benchmark: BenchmarkDelta;
  health: BudgetHealth;
  overdueCount: number;
  overdueCents: number;
  itemCount: number;
  /** True when >1 distinct currency appears — the UI must warn, not convert. */
  mixedCurrency: boolean;
  currencies: string[];
};

// ---- Functions ----

/** Assembles categories -> items -> payments from four flat arrays. Sorts by
 *  sort_order then id (the id tiebreak keeps order stable across page loads when
 *  two concurrent creates land on the same sort_order — same reason events.list does it). */
export function assembleTree(
  categories: CategoryFact[],
  items: ItemFact[],
  payments: PaymentFact[],
  now: Date,
  timeZone: string,
): CategoryRollup[];

export function paymentView(payment: PaymentFact, now: Date, timeZone: string): PaymentView;
export function paymentStatusOf(payment: PaymentFact, now: Date, timeZone: string): PaymentStatus;
export function dueLabel(payment: PaymentFact, now: Date, timeZone: string): string;
export function rollUpItem(item: ItemFact, payments: PaymentFact[], now: Date, timeZone: string): ItemRollup;
export function rollUpCategory(category: CategoryFact, items: ItemRollup[], grandForecastCents: number): CategoryRollup;
export function rollUpBudget(categories: CategoryRollup[], maxSpendCents: number | null): BudgetTotals;
export function effectiveCostCents(item: ItemFact): { cents: number; stage: CostStage | null };
export function benchmarkDelta(benchmarkCents: number | null, actualCents: number | null): BenchmarkDelta;
export function splitDeposit(totalCents: number, depositCents: number): DepositSplit;
export function budgetHealth(totals: Pick<BudgetTotals, "forecastCents" | "paidCents">, maxSpendCents: number | null): BudgetHealth;
export function allocateByPercent(totalCents: number, plan: AllocationSlice[]): AllocationResult[];
export function upcomingPayments(payments: PaymentFact[], now: Date, timeZone: string, windowDays: number): PaymentView[];
export function paymentsDueThisMonth(payments: PaymentFact[], now: Date, timeZone: string): { count: number; cents: number };
export function overduePayments(payments: PaymentFact[], now: Date, timeZone: string): PaymentView[];
export function validateItem(draft: ItemDraft): ItemValidation;
export function validatePayment(draft: PaymentDraft, itemForecastCents: number | null): PaymentValidation;
export function validateCategory(draft: { name: string }): CategoryValidation;
export const DEFAULT_ALLOCATION: AllocationSlice[];
```

**Semantics that must be exact:**

- `effectiveCostCents` — first non-null of `contracted_cents`, `quoted_cents`, `estimated_cents`;
  `{ cents: 0, stage: null }` when all three are null. **`benchmark_cents` is never a fallback** —
  Alison's number must never masquerade as the couple's forecast.
- `paymentStatusOf` — `paid` → `"paid"`. Else `due_date === null` → `"unscheduled"`. Else by
  `calendarDayDelta(due_date, now, timeZone)`: `< 0` → `"overdue"`, `0..14` → `"due_soon"`,
  `> 14` → `"upcoming"`. **`calendarDayDelta`, never `daysUntilCalendarDate`, never `new Date()`.**
- `dueLabel` — `paid` → `"Paid " + formatCalendarDate(paid_on)` short form, or `"Paid"` when
  `paid_on` is null. `due_date === null` → `"No due date"`. `delta === 0` → `"Due today"`.
  `delta === 1` → `"Due tomorrow"`. `delta > 1` → `"Due in {n} days"`. `delta === -1` →
  `"1 day overdue"`. `delta < -1` → `"{n} days overdue"`.
- `rollUpItem.paymentStatus` — `paidCents === 0 && scheduledCents === 0` → `"unpaid"`. Any overdue
  unpaid payment → `"overdue"` (overdue outranks partial). `paidCents >= forecastCents &&
  forecastCents > 0` → `"paid"`. `paidCents > 0` → `"partial"`. Else `"unpaid"`.
- `rollUpCategory.shareOfForecast` — `grandForecastCents === 0` → `0`, never `NaN`.
- `budgetHealth` — `maxSpendCents == null` → `"unset"`. `forecast > max` → `"over"`.
  `forecast > max * 0.9` → `"tight"`. `forecast > max * 0.5` → `"on_track"`. Else `"under"`.
- `splitDeposit(totalCents, depositCents)` — Aisle Planner's rule: the user enters a total and a
  deposit and the app does the subtraction, always.
  ```ts
  export type DepositSplit =
    | { ok: true; deposit: number; balance: number }
    | { ok: false; message: string };
  ```
  `deposit > total` → `{ ok: false, message: "The deposit is more than the total. Check the numbers." }`.
  `deposit < 0 || total < 0` → `{ ok: false, message: "Amounts can't be negative." }`.
  `deposit === total` → `{ ok: true, deposit: total, balance: 0 }` and the caller creates **one**
  payment, not one plus a zero-balance row. `deposit === 0` → one payment for the full total.
  Integer arithmetic only, so `deposit + balance === total` exactly.
- `allocateByPercent(totalCents, plan)` — percentage-seeded allocation.
  ```ts
  export type AllocationSlice = { name: string; pct: number; isContingency?: boolean };
  export type AllocationResult = { name: string; pct: number; targetCents: number; isContingency: boolean };
  ```
  Uses **largest-remainder apportionment** so `Σ targetCents === totalCents` exactly — naive
  `Math.round(total * pct)` leaves a few stray cents and the seeded categories then don't add up to
  the budget she typed. Throws (or returns an error result) when the plan's percentages don't sum to
  `1` within a 0.0001 tolerance, and when no slice has `isContingency: true` — the mandatory
  contingency is a research finding, enforced here rather than trusted to the UI.
  `DEFAULT_ALLOCATION` (derived from the real CSV's category proportions, rounded to friendly
  numbers, contingency added):
  `Venue 0.25`, `Food and Beverage 0.27`, `Music + Photography 0.14`, `Attire + Beauty 0.09`,
  `Flowers + Decor 0.08`, `Gifts 0.03`, `Printing 0.01`, `Hotels 0.05`,
  `Contingency 0.08 (isContingency: true)`. Must sum to `1.00`.
- `upcomingPayments` — unpaid only, `due_date != null`, `calendarDayDelta` in `[0, windowDays]`,
  sorted ascending by `due_date` then `amount_cents` desc. **Overdue payments are excluded** — they
  belong to `overduePayments`, which the UI shows in a separate, louder block.
- `paymentsDueThisMonth` — unpaid, `due_date != null`, `sameCalendarMonth(due_date,
  todayAtVenue(now, timeZone))`. Includes days already past within the current month (a payment due
  the 3rd, unpaid on the 29th, is still due this month). Returns `{ count, cents }`.
- `validatePayment` — `amount_cents <= 0` → `"A payment needs an amount."`; `paid === true &&
  paid_on === null` → the caller must default `paid_on` to `todayAtVenue`, so this is a
  never-reached guard rather than a user-facing error; `paid === false && paid_on !== null` →
  clear `paid_on`. When `itemForecastCents != null` and the new total scheduled would exceed it,
  return `{ ok: true, warning: "These payments add up to more than the cost you recorded." }` — a
  **warning, not a block**. Overpaying happens; blocking it sends her back to the spreadsheet.
- Nulls are treated as `0` in every `Σ` but are **preserved as `null`** in `BenchmarkDelta`, so
  "Alison has no number for this" renders as `—` and never as "$0, 100% under".

#### 3.3 `lib/data/vendor-rules.ts`

```ts
export type VendorStatus = "researching" | "contacted" | "quoted" | "booked" | "completed" | "passed";

export const VENDOR_STATUSES: readonly VendorStatus[]; // in lifecycle order, drives chip order
export const DEFAULT_VENDOR_ROLES: readonly string[];
// ["Venue","Catering","Photography","Videography","DJ / Music","Florist","Cake",
//  "Hair & Makeup","Officiant","Transportation","Rentals","Planner","Stationery","Other"]

export type VendorFact = {
  id: string;
  name: string;
  role: string;
  status: VendorStatus;
  quoted_cents: number | null;
  contracted_cents: number | null;
  contract_signed_at: string | null;
  currency: string;
  sort_order: number;
};

export type VendorCounts = {
  total: number; researching: number; contacted: number; quoted: number;
  booked: number; completed: number; passed: number;
  /** booked + completed — the "Vendors Booked" card. */
  secured: number;
  /** researching + contacted + quoted — the "Vendors Pending" card. Excludes passed. */
  pending: number;
  /** booked (not completed) with contract_signed_at === null — "Contracts Outstanding". */
  contractsOutstanding: number;
};

export type TeamRole = {
  role: string;
  filled: boolean;              // at least one vendor booked or completed
  candidateCount: number;       // vendors in this role not passed
  bookedVendorName: string | null;
  status: VendorStatus | null;  // the furthest-along status in this role
};

export type SyncChange = {
  itemId: string;
  itemName: string;
  fromCents: number | null;
  toCents: number;
  kind: "filled" | "overwrote" | "unchanged";
};

export function vendorCounts(vendors: VendorFact[]): VendorCounts;
export function contractsOutstanding(vendors: VendorFact[]): VendorFact[];
export function isSecured(status: VendorStatus): boolean;      // booked | completed
export function isPending(status: VendorStatus): boolean;      // researching | contacted | quoted
export function statusRank(status: VendorStatus): number;      // lifecycle index, for "furthest along"
export function teamRoles(vendors: VendorFact[], suggested?: readonly string[]): TeamRole[];
export function filterVendors(vendors: VendorFact[], filter: VendorFilter): VendorFact[];
export function sortVendors(vendors: VendorFact[], sort: VendorSort): VendorFact[];
export function syncPlan(contractedCents: number | null, items: Array<{ id: string; name: string; contracted_cents: number | null }>): SyncChange[];
export function validateVendor(draft: VendorDraft): VendorValidation;
```

**Semantics that must be exact:**

- `teamRoles` — **The Knot's "build your wedding team" empty state, which lifted engagement 88%.**
  Returns the union of `suggested` (default `DEFAULT_VENDOR_ROLES`) and every distinct `role`
  actually in use, so a role Juliet invents appears and a suggested role she has not filled still
  appears as an unfilled slot. Roles are matched **case-insensitively and trimmed**, but the
  returned `role` uses the vendor's own casing when one exists, else the suggested casing. Ordered:
  suggested order first, then invented roles alphabetically. `filled` is true when any vendor in the
  role `isSecured`. Vendors with status `passed` never fill a role but do not count in
  `candidateCount` either.
- `vendorCounts.pending` **excludes `passed`** — a vendor she ruled out is not an open thread, and
  a "Vendors Pending" card that only grows is a card she stops reading.
- `syncPlan` — decision 6, one-directional and explicit. For each linked item:
  `contractedCents == null` → **no changes at all** (clearing a vendor's price must never blank a
  budget line). `item.contracted_cents === contractedCents` → `"unchanged"` (no write).
  `item.contracted_cents === null` → `"filled"`. Otherwise → `"overwrote"`. The caller writes
  every non-`"unchanged"` change **and reports all of them**, with `"overwrote"` phrased loudly.
  This function does no I/O and decides nothing about whether to write — it only classifies.
- `filterVendors` is pure and shared: the server page uses it for the URL-driven filter and the
  client list re-uses the identical function for live typing, so server and client can never
  disagree about what "quoted" means. Copy the arrangement in `app/admin/(dashboard)/guests/page.tsx`
  + `components/admin/GuestList.tsx`.
  ```ts
  export type VendorFilter = { status?: VendorStatus | "all"; role?: string | "all"; q?: string; unsignedOnly?: boolean };
  export type VendorSort = "name" | "status" | "cost_desc" | "role";
  ```
  `q` matches case-insensitively against `name`, `role`, `contact_name`, `email` — pass those in via
  a widened fact type or a `searchText` field the shell precomputes. Blank `q` returns everything.
- `validateVendor` — only `name` is required (`"Give this vendor a name."`); a half-researched
  vendor is normal. `email` non-blank and lacking `@` → `"That email address looks incomplete."`.
  `contracted_cents != null && quoted_cents != null && contracted > quoted * 3` → a **warning**,
  not an error. `status === "booked" && contracted_cents == null` → warning
  `"Booked with no contracted price — the budget total won't include this yet."`. Mirror
  `validateEvent`'s shape exactly: `{ ok: true, value } | { ok: false, errors: VendorFieldError[] }`.

---

### 4. I/O shells

Both modules mirror `lib/data/events.ts` line for line in structure: `import type { WeddingScope }`,
`import * as activity from "./activity"`, a `const *_COLS` string, a private
`require<Thing>(scope, id)` that confirms the row belongs to this wedding **before any write
touches it**, `if (error) throw new Error(error.message)` after every query, and a
`throw new XValidationError(...)` for rejected drafts. Every exported function takes
`scope: WeddingScope` first and every query chains `.eq("wedding_id", scope.weddingId)` — including
the ones already narrowed by a foreign key, because RLS is the backstop and not the guard.

#### 4.1 `lib/data/vendors.ts`

**Responsibility:** all Supabase reads and writes for `vendors`, plus the vendor→budget sync write.

```ts
export type VendorRow = { /* every column in §1's vendors table, snake_case */ };
export type VendorInput = {
  name: string; role?: string | null; status?: VendorStatus;
  contactName?: string | null; email?: string | null; phone?: string | null;
  website?: string | null; address?: string | null;
  quotedCents?: number | null; contractedCents?: number | null;
  currency?: string; contractSignedAt?: string | null; contractUrl?: string | null;
  rating?: number | null; notes?: string | null;
};
export class VendorValidationError extends Error { constructor(public errors: VendorFieldError[]) }

export type VendorWithRollup = VendorRow & {
  linkedItemCount: number;
  /** Σ paid payments across linked items. */
  paidCents: number;
  /** Σ forecast across linked items. */
  forecastCents: number;
  /** Earliest unpaid due_date across linked items, or null. */
  nextDueDate: string | null;
  hasOverduePayment: boolean;
};

export type VendorDetail = {
  vendor: VendorRow;
  items: ItemRollup[];               // from budget-rules, for this vendor only
  unlinkedItemOptions: Array<{ id: string; name: string; categoryName: string }>;
  totals: { forecastCents: number; paidCents: number; remainingCents: number };
};

export type VendorRemovalImpact = { linkedItems: number; itemNames: string[]; paymentsOnThoseItems: number };

export async function list(scope: WeddingScope, filter?: VendorFilter, sort?: VendorSort): Promise<VendorWithRollup[]>;
export async function facts(scope: WeddingScope): Promise<VendorFact[]>;
export async function get(scope: WeddingScope, id: string): Promise<VendorRow>;
export async function detail(scope: WeddingScope, id: string, now: Date, timeZone: string): Promise<VendorDetail>;
export async function rolesInUse(scope: WeddingScope): Promise<string[]>;
export async function create(scope: WeddingScope, input: VendorInput, actorId?: string): Promise<VendorRow>;
export async function update(scope: WeddingScope, id: string, input: VendorInput, actorId?: string): Promise<{ vendor: VendorRow; synced: SyncChange[] }>;
export async function setStatus(scope: WeddingScope, id: string, status: VendorStatus, actorId?: string): Promise<VendorRow>;
export async function removalImpact(scope: WeddingScope, id: string): Promise<VendorRemovalImpact>;
export async function remove(scope: WeddingScope, id: string, actorId?: string): Promise<VendorRemovalImpact>;
export async function linkItem(scope: WeddingScope, vendorId: string, itemId: string, actorId?: string): Promise<SyncChange[]>;
export async function unlinkItem(scope: WeddingScope, itemId: string, actorId?: string): Promise<void>;
export async function syncContractedToItems(scope: WeddingScope, vendorId: string, actorId?: string): Promise<SyncChange[]>;
```

- `list` — **three parallel selects** (`vendors`, `budget_items` projected to
  `id,name,vendor_id,estimated_cents,quoted_cents,contracted_cents`, `budget_payments` projected to
  `id,item_id,amount_cents,due_date,paid,paid_on`), then the rollup happens in memory via
  `budget-rules`. Filtering and sorting are applied by `filterVendors`/`sortVendors` **in memory**,
  not in the query — the whole vendor list for one wedding is tens of rows, and one code path for
  filtering means the server page and the client list agree.
- `detail` — reads the vendor, its linked items with their payments, and the list of unlinked items
  (for the "attach a budget line" picker), in parallel.
- `update` — validates, writes the row, then **if `contractedCents` was present in the input**,
  calls `syncContractedToItems` and returns the resulting `SyncChange[]` so the action can tell her
  what else moved. If `contractedCents` was absent from the input entirely, no sync runs.
- `setStatus` — a thin update, but logs `vendor.booked` (not `vendor.status_changed`) when the new
  status is `booked`, because the couple's activity feed should read like news. Also stamps
  `contract_signed_at` to nothing — signing is a separate, deliberate edit.
- `remove` — reads `removalImpact` first, deletes the vendor, logs the impact into the activity
  payload (there is no undo, so the log is the record). The `on delete set null` on
  `budget_items.vendor_id` means budget lines survive; say so in the doc-comment.
- `syncContractedToItems` — reads the vendor and its linked items, calls the pure `syncPlan`, writes
  only the non-`"unchanged"` rows (one `update` per item, each `.eq("wedding_id", ...)`), logs
  `vendor.contract_synced` with the full `SyncChange[]` in the payload, returns the changes.
  **It always returns the changes; it never swallows an `"overwrote"`.**
- Every write calls `invalidateCache(\`metrics:${scope.weddingId}\`)` — see §5.

#### 4.2 `lib/data/budget.ts`

**Responsibility:** all Supabase reads and writes for the three budget tables plus
`weddings.budget_total_cents`.

```ts
export type BudgetCategoryRow = { /* §1 */ };
export type BudgetItemRow = { /* §1 */ };
export type BudgetPaymentRow = { /* §1 */ };
export class BudgetValidationError extends Error { constructor(public errors: BudgetFieldError[]) }

export type BudgetTree = {
  categories: CategoryRollup[];
  totals: BudgetTotals;
  vendorsById: Record<string, { id: string; name: string; status: VendorStatus }>;
  overdue: PaymentView[];
  upcoming: PaymentView[];
  timeZone: string;
};

export type BudgetSummary = {
  maxSpendCents: number | null;
  forecastCents: number; paidCents: number; dueCents: number;
  benchmarkCents: number; benchmarkDeltaCents: number | null;
  remainingAfterForecastCents: number | null;
  health: BudgetHealth;
  overdueCount: number; overdueCents: number;
  dueThisMonthCount: number; dueThisMonthCents: number;
  mixedCurrency: boolean;
};

/** The whole budget in ONE round of parallel queries. */
export async function tree(scope: WeddingScope, now: Date, timeZone: string): Promise<BudgetTree>;
/** Cheap aggregate for the Overview cards — same four selects, projected narrower. */
export async function summary(scope: WeddingScope, now: Date, timeZone: string): Promise<BudgetSummary>;
export async function maxSpend(scope: WeddingScope): Promise<number | null>;
export async function setMaxSpend(scope: WeddingScope, cents: number | null, actorId?: string): Promise<void>;

export async function createCategory(scope: WeddingScope, input: { name: string; targetCents?: number | null; isContingency?: boolean; notes?: string | null }, actorId?: string): Promise<BudgetCategoryRow>;
export async function updateCategory(scope: WeddingScope, id: string, input: {...}, actorId?: string): Promise<BudgetCategoryRow>;
export async function removeCategory(scope: WeddingScope, id: string, actorId?: string): Promise<{ items: number; payments: number }>;
export async function categoryRemovalImpact(scope: WeddingScope, id: string): Promise<{ items: number; payments: number; paidCents: number }>;
export async function reorderCategories(scope: WeddingScope, orderedIds: string[], actorId?: string): Promise<void>;

export async function createItem(scope: WeddingScope, input: BudgetItemInput, actorId?: string): Promise<BudgetItemRow>;
/** Aisle Planner's deposit auto-split: one call creates the item AND its two payments. */
export async function createItemWithDeposit(scope: WeddingScope, input: BudgetItemInput & { totalCents: number; depositCents: number; depositDue?: string | null; balanceDue?: string | null }, actorId?: string): Promise<{ item: BudgetItemRow; payments: BudgetPaymentRow[] }>;
export async function updateItem(scope: WeddingScope, id: string, input: BudgetItemInput, actorId?: string): Promise<BudgetItemRow>;
export async function removeItem(scope: WeddingScope, id: string, actorId?: string): Promise<{ payments: number; paidCents: number }>;
export async function moveItem(scope: WeddingScope, id: string, categoryId: string, actorId?: string): Promise<BudgetItemRow>;
export async function reorderItems(scope: WeddingScope, categoryId: string, orderedIds: string[], actorId?: string): Promise<void>;

export async function createPayment(scope: WeddingScope, input: PaymentInput, actorId?: string): Promise<BudgetPaymentRow>;
export async function updatePayment(scope: WeddingScope, id: string, input: PaymentInput, actorId?: string): Promise<BudgetPaymentRow>;
export async function removePayment(scope: WeddingScope, id: string, actorId?: string): Promise<void>;
export async function setPaymentPaid(scope: WeddingScope, id: string, paid: boolean, paidOn: string | null, actorId?: string): Promise<BudgetPaymentRow>;

export async function seedAllocation(scope: WeddingScope, totalCents: number, plan: AllocationSlice[], actorId?: string): Promise<BudgetCategoryRow[]>;
export async function exportRows(scope: WeddingScope, now: Date, timeZone: string): Promise<BudgetExportRow[]>;
```

- `tree` — **exactly four parallel selects in one `Promise.all`**, then all assembly in memory:
  ```ts
  const [cats, items, pays, vends] = await Promise.all([
    scope.db.from("budget_categories").select(CATEGORY_COLS).eq("wedding_id", scope.weddingId).order("sort_order").order("id"),
    scope.db.from("budget_items").select(ITEM_COLS).eq("wedding_id", scope.weddingId).order("sort_order").order("id"),
    scope.db.from("budget_payments").select(PAYMENT_COLS).eq("wedding_id", scope.weddingId).order("due_date", { nullsFirst: false }).order("id"),
    scope.db.from("vendors").select("id, name, status").eq("wedding_id", scope.weddingId),
  ]);
  ```
  **No PostgREST embedded `select("*, budget_items(*, budget_payments(*))")`.** Nested embeds here
  would be one round trip but they defeat the `.eq("wedding_id", ...)` discipline on the children
  (the filter only applies to the parent), and this codebase's tenancy guarantee is "every query
  names the wedding". Four flat scoped selects, assembled by `assembleTree`.
- `summary` — the same four tables but narrower projections; **must not call `tree`** so the
  Overview page never pays for the full item list. Delegates to `rollUpBudget`,
  `paymentsDueThisMonth`, `overduePayments`.
- `createItemWithDeposit` — calls `splitDeposit` first; on `{ ok: false }` throws
  `BudgetValidationError` with the message. On success inserts the item, then inserts the deposit
  payment (`label: "Deposit"`) and, only when `balance > 0`, the balance payment
  (`label: "Final balance"`). Sets `contracted_cents = totalCents` on the item. Logs
  `budget.item_created` then `payment.created` per payment.
- `setPaymentPaid` — when `paid === true` and `paidOn` is null, the **caller** supplies
  `todayAtVenue(new Date(), timeZone)`; this function never calls `new Date()` itself and never
  writes a server-clock date. When `paid === false` it forces `paid_on = null` so a re-marked
  payment cannot carry a stale date. Logs `payment.marked_paid` / `payment.marked_unpaid` with
  `{ paymentId, itemId, amountCents, paidOn }`.
- `removeCategory` — reads `categoryRemovalImpact` first; the cascade destroys items **and their
  payments, including paid ones**, so the impact carries `paidCents` and the confirmation dialog
  must state it. Logs the impact in the payload.
- `seedAllocation` — calls `allocateByPercent`, then inserts one `budget_categories` row per slice
  **only for names that do not already exist** (case-insensitive compare against existing names);
  existing categories get their `target_cents` updated instead. Never deletes a category. Writes
  `weddings.budget_total_cents = totalCents`. Logs `budget.seeded` with the full plan.
- `exportRows` — one flat row per payment (and one per payment-less item) with columns
  `category, item, vendor, benchmark, estimated, quoted, contracted, paid, remaining, payment_label,
  amount, due_date, paid_on, status, currency, notes`. Money rendered with `formatMoneyExact`;
  `due_date`/`paid_on` passed through as raw `YYYY-MM-DD` (a CSV consumer wants the ISO day, and
  `formatCalendarDate` would produce a locale string Excel re-parses wrongly). This feeds the
  existing `app/api/export/[report]/route.ts` — add report keys `budget` and `vendors` there and
  surface them in `components/admin/ExportCenter.tsx` under the existing **"For your vendors"**
  group. That wiring is small and belongs to whichever section owns the exports page; this section
  guarantees the data function exists.
- Every write calls `invalidateCache(\`metrics:${scope.weddingId}\`)`.

#### 4.3 Mixed currency

`BudgetTotals.mixedCurrency` is true when the distinct non-empty `currency` values across items
number more than one. **No FX conversion anywhere.** When true, `summary` and `tree` still return
the naive sums, and the UI must render a single line above the totals:
`"Some lines are in {list}. These totals add the numbers as entered — they aren't converted."`
Record it as an open question for Juliet, do not guess a rate.

#### 4.4 The "Tasks Due This Week" card

There is no tasks table and this section does not create one. `overview()` returns no
`tasksDueThisWeek`. The dashboard section should render the other nine cards and leave this one
out; adding a tenth card backed by a fabricated number is worse than nine honest ones. Log it as a
follow-up question for Juliet ("do you want a checklist in the app, or is that living in your
planner?").

---

### 5. Extending `lib/data/metrics.ts`

**The existing type must not lose a field and `lib/data/metrics.test.ts` must not be edited.** That
test file imports only `mealCounts`, so nothing in it is at risk — verify that before you start and
then leave it alone.

**5.1 Type change.** In `lib/types.ts`, add a new exported type and attach it to `OverviewMetrics`
as **one nested, non-optional key**:

```ts
export type MoneyMetrics = {
  maxSpendCents: number | null;
  budgetForecastCents: number;
  budgetPaidCents: number;
  budgetDueCents: number;
  budgetRemainingCents: number | null;   // maxSpend - forecast; null when maxSpend unset
  benchmarkTotalCents: number;
  benchmarkDeltaCents: number | null;
  budgetHealth: "under" | "on_track" | "tight" | "over" | "unset";
  paymentsOverdueCount: number;
  paymentsOverdueCents: number;
  paymentsDueThisMonthCount: number;
  paymentsDueThisMonthCents: number;
  vendorsTotal: number;
  vendorsBooked: number;    // = VendorCounts.secured
  vendorsPending: number;
  contractsOutstanding: number;
  mixedCurrency: boolean;
};

export type OverviewMetrics = {
  /* ...the existing 18 keys, byte-for-byte unchanged... */
  money: MoneyMetrics;
};
```

Nesting rather than flattening is deliberate: the existing 18 keys keep their exact names and types,
so every destructure, every `MetricCards` prop read, and every `satisfies OverviewMetrics` literal
still compiles, and the diff to `overview()` is one spread.

**5.2 New exported function.** Add to `lib/data/metrics.ts`:

```ts
export async function money(scope: WeddingScope, now: Date, timeZone: string): Promise<MoneyMetrics>;
```

It wraps its work in its **own** cache entry, keyed by the venue's calendar day:

```ts
const today = todayAtVenue(now, timeZone);
return cache(`metrics:${scope.weddingId}:money:${today}`, 60, async () => { ... });
```

**Why the day is in the key:** "overdue", "due this month" and "due in N days" all change at
midnight *at the venue*. A key without the day can serve a value computed at 23:59:30 for another
30 seconds into the next day, which is how you get a card that says "due today" about yesterday.
The 60s TTL bounds normal staleness; the day segment makes a rollover impossible. `invalidateCache`
matches by prefix, so `invalidateCache(\`metrics:${weddingId}\`)` still clears every day-keyed
entry, and stale past-day entries expire on their own TTL.

Body: `const [budget, vendorFacts] = await Promise.all([budgetData.summary(scope, now, timeZone),
vendors.facts(scope)])`, then `vendorCounts(vendorFacts)`, then assemble. All arithmetic is
delegated to `budget-rules`/`vendor-rules` — **no new logic in `metrics.ts`**, which is why no new
tests are added to `metrics.test.ts`.

**5.3 `overview()` change.** Read the timezone alongside the existing seven selects (add
`scope.db.from("weddings").select("timezone").eq("id", scope.weddingId).single()` to the
`Promise.all`), then:

```ts
money: await moneyMetrics(scope, now, wedding?.timezone ?? "America/Los_Angeles"),
```

`overview()` gains an optional `now: Date = new Date()` second parameter so a caller (and any future
test) can pin the clock. The default keeps every existing call site source-compatible.

**5.4 Invalidation.** Today only `lib/data/rsvp.ts:123` invalidates, with the broad prefix
`metrics:${scope.weddingId}`. Keep that. Add the **same broad prefix call** at the end of every
mutating function in `lib/data/vendors.ts` and `lib/data/budget.ts`:

```ts
import { invalidateCache } from "@/lib/limiter";
// ...last line of every create/update/remove/setStatus/setPaymentPaid/seedAllocation/setMaxSpend:
invalidateCache(`metrics:${scope.weddingId}`);
```

Over-invalidating (the guest metrics recompute too) costs seven cheap scoped selects; under-
invalidating means Juliet marks a payment paid and the Budget Spent card still shows the old number
for a minute, which reads as a bug and destroys trust in the whole module. Choose the cheap option.

**Known limitation to write in a comment, not to solve:** `lib/limiter.ts`'s cache is a
process-local `Map`. On Vercel, an invalidation in one function instance does not reach another. In
a two-user app with a 60s TTL the worst case is one stale card for under a minute on a second
instance. Do not build a distributed invalidation for this.

---

### 6. Server actions

Both files open with the same contract. **Copy this skeleton verbatim** — it is
`app/admin/(dashboard)/events/actions.ts` reduced to its rules.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { MoneyParseError } from "@/lib/format/money";

export type ActionResult = { ok: boolean; message?: string };

/** Turns anything thrown into one sentence, in her words where we have them. */
function readableError(error: unknown): string {
  if (error instanceof VendorValidationError) return error.errors.map((e) => e.message).join(" ");
  if (error instanceof BudgetValidationError) return error.errors.map((e) => e.message).join(" ");
  if (error instanceof MoneyParseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Nothing was changed.";
}

export async function someAction(/* ... */): Promise<ActionResult> {
  try {
    const admin = await requireEditor();          // 1. ALWAYS FIRST. Service-role client
    const scope = forWedding(admin.weddingId);    //    bypasses RLS, so this is the ONLY role gate.
    // ... work, passing admin.userId as actorId so the activity log names a human ...
    revalidatePath("/admin/budget");              // 2. every path whose numbers moved
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);                      // 3. MUST be the first line of the catch.
    return { ok: false, message: readableError(error) };
  }
}
```

`unstable_rethrow` is not optional and not decorative. `requireEditor` → `requireAdmin` calls
`redirect()` when the session has lapsed, and Next implements `redirect()` by **throwing** a
control-flow signal. Swallowed by this catch-all, it never navigates and the screen renders the
literal string `NEXT_REDIRECT` in the error box. Rethrown, Juliet lands on the sign-in page.

Any action that reads a date-sensitive value resolves the timezone once at the top:

```ts
const { data: wedding } = await scope.db.from("weddings").select("timezone").eq("id", scope.weddingId).single();
const timeZone: string = wedding?.timezone ?? "America/Los_Angeles";
```

#### 6.1 `app/admin/(dashboard)/vendors/actions.ts`

| action | signature | FormData fields | validation | revalidatePath | activity |
|---|---|---|---|---|---|
| `saveVendor` | `(vendorId: string \| null, _prev: VendorFormState, formData: FormData) => Promise<VendorFormState>` | `name`, `role`, `status`, `contactName`, `email`, `phone`, `website`, `address`, `quoted`, `contracted`, `currency`, `contractSignedAt`, `contractUrl`, `rating`, `notes` | `validateVendor`; `quoted`/`contracted` through `tryParseMoney`, errors attached to the field that failed; `status` must be in `VENDOR_STATUSES` else fall back to `"researching"` | `/admin/vendors`, `/admin/vendors/${id}`, `/admin/budget`, `/admin` | `vendor.created` / `vendor.updated` (+ `vendor.contract_synced` from the data layer) |
| `setVendorStatus` | `(vendorId: string, status: VendorStatus) => Promise<ActionResult>` | — | status in `VENDOR_STATUSES` | `/admin/vendors`, `/admin/vendors/${id}`, `/admin` | `vendor.booked` when `status === "booked"`, else `vendor.status_changed` |
| `vendorDeletionCost` | `(vendorId: string) => Promise<{ ok: boolean; message?: string; impact?: VendorRemovalImpact }>` | — | — | none (read) | none |
| `deleteVendor` | `(vendorId: string, typedName: string) => Promise<ActionResult>` | — | re-read the impact **server-side**; when `linkedItems > 0`, require `typedName.trim() === vendor.name.trim()` (copy `deleteEvent`) | `/admin/vendors`, `/admin/budget`, `/admin` | `vendor.removed` |
| `linkVendorToItem` | `(vendorId: string, itemId: string) => Promise<{ ok: boolean; message?: string; synced?: SyncChange[] }>` | — | both rows must be in this wedding | `/admin/vendors/${vendorId}`, `/admin/budget` | `vendor.linked_item` |
| `unlinkVendorFromItem` | `(itemId: string) => Promise<ActionResult>` | — | item in this wedding | `/admin/vendors`, `/admin/budget` | `vendor.unlinked_item` |
| `syncVendorPrice` | `(vendorId: string) => Promise<{ ok: boolean; message?: string; synced?: SyncChange[] }>` | — | — | `/admin/vendors/${id}`, `/admin/budget`, `/admin` | `vendor.contract_synced` |

```ts
export type VendorFormState = {
  ok: boolean;
  fieldErrors?: { name?: string; email?: string; quoted?: string; contracted?: string; form?: string };
  savedVendorId?: string;
  /** Non-blocking notes: "Booked with no contracted price…", currency mismatch. */
  warnings?: string[];
  /** Decision 6: what this save changed on the budget side. Rendered, never hidden. */
  synced?: SyncChange[];
};
```

**Decision 6's user-visible half lives here.** When `synced` contains any `"overwrote"` change, the
returned state must carry a sentence the form renders, e.g.
`"Also updated the contracted price on Venue Rental — it was $12,000, now $15,370."` A `"filled"`
change gets the gentler `"Filled in the contracted price on Venue Rental."` Never return `ok: true`
with an unreported overwrite.

#### 6.2 `app/admin/(dashboard)/budget/actions.ts`

| action | signature | FormData fields | validation | revalidatePath | activity |
|---|---|---|---|---|---|
| `saveCategory` | `(categoryId: string \| null, _prev: BudgetFormState, formData: FormData) => Promise<BudgetFormState>` | `name`, `target`, `isContingency`, `notes` | `validateCategory`; `target` via `tryParseMoney` | `/admin/budget`, `/admin` | `budget.category_created` / `budget.category_updated` |
| `categoryDeletionCost` | `(categoryId: string) => Promise<{ ok; message?; impact? }>` | — | — | none | none |
| `deleteCategory` | `(categoryId: string, typedName: string) => Promise<ActionResult>` | — | typed-name guard when the category has items or any `paidCents > 0`; impact re-read server-side | `/admin/budget`, `/admin` | `budget.category_removed` |
| `reorderCategories` | `(orderedIds: string[]) => Promise<ActionResult>` | — | ids outside the wedding match nothing (silent no-op, as in `events.reorder`) | `/admin/budget` | `budget.category_reordered` |
| `saveItem` | `(itemId: string \| null, _prev: BudgetFormState, formData: FormData) => Promise<BudgetFormState>` | `categoryId`, `name`, `vendorId`, `benchmark`, `estimated`, `quoted`, `contracted`, `quantity`, `unitPrice`, `currency`, `pendingGuestCount`, `notes` | `validateItem`; four money fields through `tryParseMoney` with per-field errors; `vendorId === ""` → null | `/admin/budget`, `/admin/vendors/${vendorId}` when set, `/admin` | `budget.item_created` / `budget.item_updated` |
| `saveItemWithDeposit` | `(_prev: BudgetFormState, formData: FormData) => Promise<BudgetFormState>` | `categoryId`, `name`, `vendorId`, `total`, `deposit`, `depositDue`, `balanceDue` | `splitDeposit`; its `{ ok: false }` message goes to the `deposit` field | `/admin/budget`, `/admin` | `budget.item_created`, `payment.created` ×n |
| `deleteItem` | `(itemId: string) => Promise<ActionResult>` | — | none beyond ownership; cascade count returned in the message | `/admin/budget`, `/admin` | `budget.item_removed` |
| `moveItem` | `(itemId: string, categoryId: string) => Promise<ActionResult>` | — | both in this wedding | `/admin/budget` | `budget.item_moved` |
| `reorderItems` | `(categoryId: string, orderedIds: string[]) => Promise<ActionResult>` | — | as above | `/admin/budget` | `budget.item_reordered` |
| `savePayment` | `(paymentId: string \| null, _prev: BudgetFormState, formData: FormData) => Promise<BudgetFormState>` | `itemId`, `label`, `amount`, `dueDate`, `paid`, `paidOn`, `method`, `reference`, `receiptUrl`, `notes` | `tryParseMoney(amount)` must yield a non-null positive; `dueDate`/`paidOn` must match `/^\d{4}-\d{2}-\d{2}$/` or be blank; when `paid` and `paidOn` blank → `todayAtVenue(new Date(), timeZone)`; when not `paid` → force `paidOn` null. Over-schedule returns a `warnings` entry, never an error | `/admin/budget`, `/admin/vendors/...` when the item has a vendor, `/admin` | `payment.created` / `payment.updated` |
| `deletePayment` | `(paymentId: string) => Promise<ActionResult>` | — | ownership | `/admin/budget`, `/admin` | `payment.removed` |
| `markPaymentPaid` | `(paymentId: string, paid: boolean) => Promise<ActionResult>` | — | `paidOn` derived server-side from `todayAtVenue(new Date(), timeZone)` — **never from the browser clock and never from `new Date().toISOString().slice(0,10)`**, which is UTC and marks a Guadalajara evening payment as tomorrow | `/admin/budget`, `/admin`, `/admin/vendors` | `payment.marked_paid` / `payment.marked_unpaid` |
| `setMaxSpend` | `(_prev: BudgetFormState, formData: FormData) => Promise<BudgetFormState>` | `maxSpend` | `tryParseMoney`; blank clears it to null | `/admin/budget`, `/admin` | `budget.max_spend_set` |
| `seedFromTotal` | `(_prev: BudgetFormState, formData: FormData) => Promise<BudgetFormState>` | `total`, plus `pct_<slug>` per slice | `allocateByPercent`, which enforces the sum-to-1 and mandatory-contingency rules | `/admin/budget`, `/admin` | `budget.seeded` |

```ts
export type BudgetFormState = {
  ok: boolean;
  fieldErrors?: Record<string, string>;  // keyed by the FormData field name
  savedId?: string;
  warnings?: string[];
};
```

`revalidatePath("/admin")` appears on every action that moves a number, because the Overview cards
live there. Its omission is the most likely bug in this slice.

---

### 7. Tests

New files, all under `lib/` (vitest's `include` is `lib/**/*.test.ts` — a test anywhere else simply
never runs). Copy the commenting style of `lib/format/wedding-date.test.ts`: each `describe` opens
with a comment naming the real bug the tests defend against.

**7.1 `lib/format/money.test.ts`**
- `formatMoney`: every row of the §2 table, one `test` each — null, undefined, `0`, round dollars,
  non-round cents, negative, `-1`, `$1.25M`, `$1B`, `NaN`, `Infinity`.
- `formatMoneyExact` always shows 2 dp; `formatMoneySigned` adds `+` above zero and nothing at zero.
- `centsToInputValue` round-trips: `parseMoneyInput(centsToInputValue(c)) === c` for
  `[0, 1, 99, 100, 1537000, 1536999, -50000]`.
- `parseMoneyInput` / `tryParseMoney`: every row of the §2 table, including `""`→null vs `"0"`→0
  (the single most consequential distinction in the module), NBSP and narrow-NBSP separators,
  `"-$500"` and `"$-500"`, `".5"`, `"15370.005"` rejected, garbage rejected, over-$1B rejected.
- **Float-free proof:** `parseMoneyInput("1.005")` rejects rather than returning `100`, and
  `parseMoneyInput("0.29")` is exactly `29` (a `parseFloat` implementation can yield `28`), and
  `parseMoneyInput("1.10")` is exactly `110`.
- `formatDelta`: benchmark null, actual null, equal, over, under, and `benchmark === 0 &&
  actual > 0` producing no `Infinity` and `pct: null`.
- `formatPercent`: `null`, `0`, rounding `0.184 → "18%"`, signed, negative.

**7.2 `lib/format/wedding-date.test.ts` (extend, do not rewrite)**
- Leave the four existing tests untouched and passing.
- `calendarDayDelta` returns a **negative** number for a past date — the case
  `daysUntilCalendarDate` cannot express.
- `calendarDayDelta("2026-07-29", new Date("2026-07-30T05:00:00Z"), "America/Mexico_City") === 0`
  (05:00 UTC is 23:00 on the 29th in Guadalajara).
- `calendarDayDelta("2026-07-29", new Date("2026-07-30T05:00:00Z"), "UTC") === -1` — the same
  instant is already the 30th in UTC. **This pair is the whole point of the module.**
- `todayAtVenue(new Date("2026-07-30T05:00:00Z"), "America/Mexico_City") === "2026-07-29"`.
- `todayAtVenue` zero-pads: a January 5th instant yields `"2026-01-05"`, not `"2026-1-5"`.
- `sameCalendarMonth("2026-07-01", "2026-07-31")` true; `("2026-07-31", "2026-08-01")` false;
  `("2025-07-01", "2026-07-01")` false.

**7.3 `lib/data/budget-rules.test.ts`**
- `effectiveCostCents`: contracted wins over quoted wins over estimated; all null → `{ cents: 0,
  stage: null }`; **`benchmark_cents` set with the other three null still yields `0`** — Alison's
  number must never become the couple's forecast.
- `rollUpItem`: `paidCents` counts only `paid` rows; `scheduledCents` counts all; an item with a
  $15,370 contract and a $5,000 paid deposit gives `remainingCents === 1037000`; an item with a
  $15,370 contract and no payment rows gives `unscheduledCents === 1537000`; an item with payments
  exceeding the contract gives `remainingCents === 0` (floored, never negative).
- `itemPaymentStatus`: no payments → `unpaid`; some paid → `partial`; all paid and covering the
  forecast → `paid`; **an overdue unpaid payment alongside a paid one → `overdue`, not `partial`**.
- `paymentStatusOf` / `dueLabel` **with the venue-timezone edge case, stated explicitly**:
  a payment `due_date: "2026-07-29"`, `paid: false`, evaluated at
  `now = new Date("2026-07-30T05:00:00Z")` with `timeZone = "America/Mexico_City"` →
  status `"due_soon"` and label `"Due today"`. The naive `new Date("2026-07-29") < new Date()`
  implementation returns `"overdue"` / `"1 day overdue"`, and Vercel running UTC means the bug
  **only** appears in production. Add the mirrored assertion with `timeZone: "UTC"` producing
  `"overdue"` so the test proves the timezone is actually being honoured and not accidentally
  ignored.
- `dueLabel` for every branch: `"Due today"`, `"Due tomorrow"`, `"Due in 12 days"`,
  `"1 day overdue"`, `"6 days overdue"`, `"No due date"`, `"Paid Jul 12"`.
- `upcomingPayments` excludes paid, excludes overdue, excludes null due dates, respects the window
  boundary inclusively at both ends (`delta === 0` and `delta === windowDays` are both in,
  `windowDays + 1` is out), and sorts ascending.
- `paymentsDueThisMonth`: a payment due the 3rd, unpaid, evaluated on the 29th of the same month is
  **counted**; one due the 1st of next month is not; the month boundary is computed at the venue,
  so a `2026-07-31` due date at `2026-08-01T02:00:00Z` in `America/Mexico_City` (still July 31st
  there) is still "this month".
- `benchmarkDelta`: null benchmark → `direction: "unknown"`, `pct: null`; benchmark `0` with a
  positive actual → `pct: null` and no `Infinity`; over and under produce the right sign;
  equal → `"even"`.
- `splitDeposit`: `(1537000, 500000)` → `{ deposit: 500000, balance: 1037000 }` and
  `deposit + balance === total`; `deposit === total` → `balance: 0`; `deposit > total` rejected
  with the exact message; negatives rejected; `(1537000, 0)` → `balance === 1537000`.
- `allocateByPercent`: **`Σ targetCents === totalCents` exactly** for an awkward total like
  `4_133_333` cents across the 9-slice `DEFAULT_ALLOCATION` (this is the largest-remainder test and
  it fails under naive rounding); a plan not summing to 1 is rejected; a plan with no contingency
  slice is rejected; `DEFAULT_ALLOCATION` itself sums to exactly `1` and contains exactly one
  contingency.
- `budgetHealth`: `null` max → `"unset"`; forecast just over max → `"over"`; at 95% → `"tight"`;
  at 60% → `"on_track"`; at 20% → `"under"`; **`maxSpendCents === 0` does not divide by zero**.
- `rollUpBudget`: with the real seed numbers — Alison `$40,962`, forecast `$60,170` — the returned
  `benchmark.deltaCents` is `+1_920_800` and `benchmark.pct` rounds to `+47%`. Pin these, they are
  the module's headline claim.
- `rollUpBudget.mixedCurrency` false for all-`"USD"`, true when one item is `"MXN"`, and
  `currencies` is sorted and de-duplicated.
- `assembleTree`: an item whose `category_id` matches nothing is dropped rather than crashing; a
  payment whose `item_id` matches nothing is dropped; ordering is `sort_order` then `id`, and two
  rows sharing a `sort_order` come back in a stable order across repeated calls.
- `rollUpCategory.shareOfForecast` is `0` (not `NaN`) when the grand forecast is `0`.

**7.4 `lib/data/vendor-rules.test.ts`**
- `vendorCounts`: `secured = booked + completed`; `pending` **excludes `passed`**; an empty array
  gives all zeros, never `NaN`.
- `contractsOutstanding`: a `booked` vendor with `contract_signed_at: null` counts; the same vendor
  with a date does not; a `completed` vendor with no date does **not** count (the wedding-day work
  is done, chasing paper is moot); a `quoted` vendor with no date does not count.
- `teamRoles`: the default suggested roles all appear as unfilled when there are no vendors (**this
  is The Knot's 88% empty state — assert the full list length**); a booked Venue vendor marks the
  Venue role filled and names the vendor; a role Juliet invents (`"Lion Dance"`) appears after the
  suggested ones; role matching is case- and whitespace-insensitive (`"venue "` fills `"Venue"`)
  while the displayed casing follows the vendor's; a `passed` vendor neither fills a role nor
  counts as a candidate; two booked vendors in one role still yield one `TeamRole`.
- `statusRank` orders the lifecycle correctly and `teamRoles.status` reports the furthest-along
  status in a role.
- `filterVendors`: blank `q` returns everything; `q` matches name, role and email
  case-insensitively; `status: "all"` is a no-op; `unsignedOnly` narrows to booked-without-a-date;
  combined filters are AND, not OR.
- `syncPlan` — decision 6, the highest-stakes function in the section:
  - `contractedCents === null` → **empty array** (clearing a vendor price never blanks a budget line).
  - item with `contracted_cents === null` → `kind: "filled"`.
  - item already equal → `kind: "unchanged"` (so the caller writes nothing and reports nothing).
  - item with a **different** human-typed number → `kind: "overwrote"`, carrying both `fromCents`
    and `toCents` so the UI can say what it replaced. Assert `fromCents` is preserved — losing it
    is how the overwrite becomes silent.
  - multiple linked items each get their own change, in input order.
- `validateVendor`: blank name rejected with the exact copy; whitespace-only name rejected;
  `"juliet@"` flagged; a valid vendor returns `{ ok: true }` with a trimmed name;
  `booked` with no contracted price returns `ok: true` **plus** a warning, not an error.

**7.5 Files deliberately NOT given tests**
`lib/data/vendors.ts`, `lib/data/budget.ts`, both `actions.ts` files, and `metrics.money()`. They
contain no branching logic — every decision is delegated to a tested pure function. If you find
yourself wanting to test one of them, that is the signal that logic has leaked out of the rules
module; move it back rather than reaching for a Supabase mock. There is no mocking infrastructure
in this repo and this section does not add any.

**Target: the measured baseline (250) still green, plus roughly 95–120 new tests across the four
files. Zero existing test files modified except `lib/format/wedding-date.test.ts`, which is
appended to only.**

---

### 8. Acceptance checks for this slice

Run from `/Users/admin/guest-crm`. All three must pass before this slice is considered done.

**1. Tests**
```
npm test
```
Proves success: the summary line reads `Test Files  30 passed (30)` and `Tests  <N> passed` where
`N >= 250 + (your new test count)`, with **zero failures and zero skipped**. The four new files must
appear in the run: `lib/format/money.test.ts`, `lib/data/budget-rules.test.ts`,
`lib/data/vendor-rules.test.ts`, and the extended `lib/format/wedding-date.test.ts`. If the count
went *down*, you changed an existing test — revert that.

**2. Types**
```
npx tsc --noEmit
```
Proves success: **no output at all**, exit code 0. There is no lint script and no typecheck script;
this is the only type gate. In particular this proves the `OverviewMetrics` extension did not break
`components/admin/MetricCards.tsx` or any other consumer, and that every `lib/data/*` export is
consistent with its callers.

**3. Build**
```
npm run build
```
Proves success: completes without error and lists `/admin/vendors` and `/admin/budget` in the route
table (once the pages section has landed; before that, it proves the actions files compile under
`"use server"` — a Server Action that exports a non-async value fails here and nowhere else).

**4. Targeted timezone proof** (run this specific test in isolation, because it is the one that
regresses silently in production):
```
npx vitest run lib/data/budget-rules.test.ts -t "Guadalajara"
```
Proves success: the due-today-in-Guadalajara-while-UTC-is-tomorrow case passes, and its UTC mirror
still reports "overdue" — together they prove the timezone parameter is genuinely being used.

**5. What a human sees.** This slice ships no UI, so the human check is indirect but real: with the
data layer in place and the seed migration applied, open `node --input-type=module` against nothing
— instead, verify through the pages section that the Budget page header reads
**`$60,170` Total Cost** and **`$40,962` Alison's wedding** with a **`+$19,208` / `+47%`** delta,
and that marking any payment paid changes the Overview "Budget Spent" card **on the next page load,
not sixty seconds later**. If the card lags, an `invalidateCache` call is missing from a mutating
function in §5.4.

---

### 9. Open questions this slice hands to the user (do not guess)

1. **Currency.** The venue is in Guadalajara; the budget CSV is in USD. Everything is stored and
   displayed as entered with no conversion. If any line is actually in MXN, `mixedCurrency` will
   fire and the totals will be meaningless. Ask Juliet before assuming.
2. **`weddings.timezone` says `America/Los_Angeles`; the venue and the emails say Guadalajara.**
   Every payment due-date calculation inherits this. Do not change the stored value — it is already
   an open item with the user.
3. **Tasks.** No table, no card, no invented data (§4.4).
4. **File uploads.** Contracts and receipts are pasted URLs in v1 (§1.1).
5. **Benchmark provenance.** `benchmark_cents` is Alison's *actual*, not her estimate. Where the CSV
   leaves it blank (e.g. Photobooth Rental, Lion Dance), it stays `null` and renders `—` — never `$0`.

---

## Budget Screens

This section owns everything a human sees at `/admin/budget`. It does not own the migration, the
`lib/data/budget*` I/O modules, the CSV seed, or the vendor screens — but it names the exact
imports it needs from them. **If the data section named an export differently, the data section
wins; adapt the import and keep the screen behaviour specified here.**

### 3.0 Contract with the rest of the build

The screen imports exactly these. Nothing else. If any is missing, build the thin shim rather than
inlining arithmetic into a component — the math must stay in `lib/**` where vitest can see it.

From `lib/format/money.ts` (pure, unit-tested):
- `formatMoney(cents: number): string` → `"$15,370"`; whole dollars when the amount is a round
  dollar, otherwise `"$1,247.50"`. Never a bare number, never `NaN`, never `"$NaN"`.
- `parseMoneyInput(raw: string): number | null` → cents; tolerates `$`, commas, spaces, a leading
  `-`; blank/whitespace → `null`; unparseable → throws `MoneyParseError` (caught by the action).
- `formatMoneyDelta(cents: number): string` → `"+$4,300"` / `"−$1,180"` (U+2212 MINUS SIGN, not a
  hyphen) / `"even"` when zero.

From `lib/data/budget-rules.ts` (pure, unit-tested) — the single source of every number on screen:
- `itemForecastCents(item, paidCents): number`
- `rollupItem(item, payments, today, timeZone): ItemRollup`
- `rollupCategory(category, itemRollups): CategoryRollup`
- `rollupBudget(settings, categoryRollups, today, timeZone): BudgetRollup`
- `cashFlowByMonth(payments, today, timeZone): Array<{ monthKey: string; label: string; dueCents: number; paidCents: number; overdue: boolean }>`
- `seedAllocation(totalCents, benchmarkCategories): Array<{ name: string; pct: number; targetCents: number }>`
- `paymentState(payment, today, timeZone): "paid" | "overdue" | "due_soon" | "scheduled"`
  (`due_soon` = unpaid and due within 14 days)

From `lib/format/wedding-date.ts`: `formatCalendarDate`, `daysUntilCalendarDate`. **Every payment
due date is a Postgres `date` column. It must never be passed to `new Date()`.**

From `lib/data/scope.ts`: `defaultScope`. From `lib/admin-auth.ts`: `requireEditor`,
`requireEditorPage`.

### 3.1 Route + files

Every path is exact. One line each is the whole responsibility; nothing else belongs in that file.

**Route**

| Path | Responsibility |
|---|---|
| `app/admin/(dashboard)/budget/page.tsx` | Server page: `export const dynamic = "force-dynamic";`, `defaultScope()`, read `weddings.timezone`, fetch settings + categories + items + payments + vendor names in one `Promise.all`, map to serializable row types, hand everything to `<BudgetScreen>`. No arithmetic beyond calling `rollup*`. |
| `app/admin/(dashboard)/budget/actions.ts` | All budget server actions (see 3.4). `"use server"`, every export calls `requireEditor()` first, every catch opens with `unstable_rethrow(error)`. Copy the file shape from `app/admin/(dashboard)/events/actions.ts`. |

`page.tsx` reads role via `requireEditorPage()` **only if** you decide viewers are blocked — do
not. Budget is readable by `viewer`; every *write* is gated in the action. The page passes
`canEdit={admin.role !== "viewer"}` down so read-only users see plain text instead of inputs.

**Components — all under `components/admin/budget/`**

| Path | Responsibility |
|---|---|
| `BudgetScreen.tsx` | `"use client"` shell. Owns the optimistic item/payment map, the save-status message, which categories are collapsed, and which item drawer is open. Every other component is presentational or a leaf form. |
| `BudgetHeadline.tsx` | The four primary metric cards (3.2). Pure props. |
| `BudgetLedgerStrip.tsx` | The one-line secondary strip of demoted numbers (3.2). |
| `BudgetHealthLine.tsx` | The single sentence + slim bar that replaces a "Budget Health" card. |
| `BudgetTable.tsx` | Desktop `<table>` (`max-md:hidden`): sticky head, category `<tbody>` groups, grand-total `<tfoot>`. |
| `BudgetCategoryRow.tsx` | One collapsible category header row carrying that category's subtotals in the same columns as the items. |
| `BudgetItemRow.tsx` | One item `<tr>`: name+vendor cell, five money cells, delta cell, expand chevron. |
| `MoneyCell.tsx` | The inline-editable money `<td>` — the whole of 3.4 lives here. |
| `DeltaCell.tsx` | Benchmark delta rendering + colour rule. Used in item rows, category rows and the footer. |
| `BudgetItemCards.tsx` | Phone list (`md:hidden`) — the required duplicate of the table (3.3). |
| `ItemDrawer.tsx` | Right-side drawer for one item: all fields, vendor link, notes, guest-count flag, payment schedule, delete. |
| `PaymentSchedule.tsx` | The payment list inside the drawer plus "Add a payment" and the deposit split entry point. |
| `PaymentRow.tsx` | One installment: label, amount, due date, paid toggle, paid-on date, overdue styling. |
| `DepositSplit.tsx` | "Enter total + deposit, we compute the balance" affordance; creates two payments. |
| `VendorLinkPicker.tsx` | Searchable select of existing vendors + "Not booked yet" + a link out to `/admin/vendors`. Shows the sync warning copy from 3.5. |
| `CategoryBars.tsx` | Hand-built stacked div bars, one row per category, with the target tick (3.8). |
| `BenchmarkCompare.tsx` | Paired "Alison / You" bars per category, shared scale (3.8). |
| `CashFlowStrip.tsx` | Month-by-month vertical bars of money due (3.8). |
| `BudgetSetup.tsx` | The two-step "set your total → seeded per-category targets" flow (3.7). Also reachable later as "Adjust targets". |
| `BudgetEmptyState.tsx` | First-run screen with the three doors (3.9). |
| `NewItemRow.tsx` | The always-present last row of each category: a name input that creates an item on Enter. |
| `CategoryForm.tsx` | Add / rename / retarget / delete one category. Refuses to delete the contingency category. |
| `SaveStatus.tsx` | The single `aria-live="polite"` line under the H1 that reports the last save or error. |

**Nav** — edit `NAV: NavItem[]` in `components/admin/SideNav.tsx`. Insert **after Meals, before
Communications** (planning lives together; Communications stays with execution). This section adds
only the Budget entry; the vendor section adds its own immediately after.

```tsx
{
  href: "/admin/budget",
  label: "Budget",
  icon: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v1.5" />
      <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
      <path d="M16.5 13.5h2.5" />
    </>
  ),
},
```

### 3.2 The dashboard strip — resolving ten cards into four

**Decision.** Four primary cards in the house metric grid, one secondary strip of five demoted
numbers, one health *sentence*, and per-column grand totals in the table's `<tfoot>`. Nothing is
deleted; everything the client asked for is on the page.

**Justification (two sentences).** Ten cards is not a summary — at ten tiles nothing is emphasised,
so the eye reads none of them, which is the exact failure Zola fixed by collapsing to three
headline numbers. Six of the ten (Contracted, Actual, Remaining Balance, Contingency, plus the two
that are really per-column sums) are *ledger* facts that are more legible sitting under the column
they summarise than floating in a tile, so they move to the secondary strip and the table footer
where they cost no attention until wanted.

**Primary cards** — `BudgetHeadline.tsx`, using the exact grid and card markup from
`components/admin/MetricCards.tsx` (`grid grid-cols-4 gap-4 max-md:grid-cols-2 max-md:gap-2.5`,
card `flex flex-col gap-2 rounded-[14px] border border-hairline p-5 max-md:p-4`, label
`text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]`, value
`text-[34px] font-semibold leading-none`, accent `text-[13px] font-medium text-olive`, sub
`text-[12.5px] text-muted`).

| Card | LABEL | Value | Accent | Sub |
|---|---|---|---|---|
| 1 | `TOTAL BUDGET` | `formatMoney(totalBudget)` | `"{formatMoney(unallocated)} unallocated"`, or `"fully allocated"` when 0, or `"{formatMoney(-unallocated)} over-allocated"` when negative | `"Alison's wedding came to {formatMoney(benchmarkTotal)}"` |
| 2 | `FORECAST` | `formatMoney(forecast)` | `"{formatMoney(abs(budgetRemaining))} under budget"` / `"over budget"` — `text-rose` when over | `"{contractedCount} of {itemCount} lines are contracted"` |
| 3 | `PAID SO FAR` | `formatMoney(paid)` | `"{paidPct}% of forecast"` | `"{formatMoney(stillToPay)} still to pay"` |
| 4 | `DUE IN 30 DAYS` | `formatMoney(due30)` | `"{n} payments"` | overdue > 0 → `"{k} overdue"` else `"nothing overdue"` |

Card 4 uses `rose: true` (value in `text-rose`) **only** when `overdueCents > 0`, mirroring the
`NEEDS ATTENTION` card. Card 1 renders the "set a budget" CTA in place of the value when
`totalBudgetCents` is null: value slot shows `—` in `text-muted` and the sub becomes a
`text-olive underline` button reading `Set your total budget`.

**Arithmetic — normative. Two cards may never disagree because every number below is derived from
these five definitions and nothing else.** All values are integer cents. `today` is the calendar
day in the venue's `timeZone`.

```
paid(item)          = Σ payments[p.item_id = item].amount_cents where p.paid_at is not null
scheduled(item)     = Σ payments[p.item_id = item].amount_cents            (paid or not)
forecast(item)      = max( contracted_cents ?? quoted_cents ?? estimated_cents ?? 0 , paid(item) )
stillToPay(item)    = max( 0 , forecast(item) − paid(item) )
benchmark(item)     = benchmark_cents ?? 0
```

`forecast` takes `max(..., paid)` so an item where she has already paid more than the number typed
in the estimate can never make the forecast read lower than the money actually gone.

Rollups — categories sum their items; the budget sums its categories. Items with `category_id`
null roll into a synthetic `"Everything else"` category rendered last.

```
forecast          = Σ forecast(item)              // card 2, "Total Cost"
paid              = Σ paid(item)                  // card 3, "Actual Spend"
stillToPay        = Σ stillToPay(item)            // "Remaining Balance" — what she still owes
contracted        = Σ contracted_cents ?? 0
estimatedOnly     = Σ forecast(item) where contracted_cents is null
totalBudget       = weddings.budget_total_cents ?? null   # NB: Binding Decision 1 — there is no budget_settings table
budgetRemaining   = totalBudget − forecast        // "Budget Remaining" — headroom, may be negative
unallocated       = totalBudget − Σ category.target_cents
paidPct           = forecast === 0 ? 0 : round(paid / forecast * 100)
due30             = Σ p.amount_cents where p.paid_at is null and dueDay ≤ today+30
overdueCents      = Σ p.amount_cents where p.paid_at is null and dueDay < today
benchmarkTotal    = Σ benchmark(item)
delta             = forecast − benchmark          // per item, per category, and grand
contingencyLeft   = contingencyCategory.target_cents − forecast(contingency items)
```

**Naming rule that prevents the disagreement the client's list invites.** The client asked for both
"Remaining Balance" and "Budget Remaining"; they are different quantities and identical-sounding
labels will get read as a bug. On screen they are **never** called those things:
- `stillToPay` is always labelled **"Still to pay"**.
- `budgetRemaining` is always labelled **"Left in budget"** (or "over budget" when negative).
Use these two strings verbatim everywhere, including the phone cards and the CSV export headers.

**Secondary strip** — `BudgetLedgerStrip.tsx`, directly under the cards. One horizontal row, wraps
on narrow screens; each entry is a label above a number, no card chrome:

```
<div className="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-xl border border-hairline bg-paper/70 px-5 py-3.5">
  … per entry:
  <div className="flex flex-col gap-0.5">
    <span className="text-[10.5px] font-semibold tracking-[0.08em] text-[#6b7167] uppercase">CONTRACTED</span>
    <span className="text-[15px] font-semibold text-ink tabular-nums">$34,200</span>
  </div>
</div>
```

Entries, in order: `CONTRACTED` (contracted), `STILL ESTIMATED` (estimatedOnly),
`STILL TO PAY` (stillToPay), `LEFT IN BUDGET` (budgetRemaining — `text-rose` when negative and the
label flips to `OVER BUDGET`), `CONTINGENCY LEFT` (contingencyLeft), `ALISON'S TOTAL`
(benchmarkTotal, value in `text-muted`).

**Budget Health** is a sentence, not a card — `BudgetHealthLine.tsx`, placed under the strip. A
slim bar (`h-1.5 rounded-full bg-[#f0efe3]` track) showing `forecast / totalBudget` filled
`bg-olive-deep`, over-budget overflow rendered as a second `bg-rose` segment, plus one line of prose
from the copy deck (3.10). A tile that says the word "Healthy" is SaaS jargon and tells her nothing
actionable.

### 3.3 The budget table

`BudgetTable.tsx`. Desktop only: the outer wrapper carries `max-md:hidden`.

**Sticky-header gotcha — do not skip.** `app/admin/(dashboard)/layout.tsx` wraps the whole admin in
`<div className="relative flex min-h-dvh watercolor-bg overflow-hidden">`. That `overflow-hidden`
makes the root the nearest scroll container for `position: sticky`, and it never scrolls, so a
`sticky top-0` `<thead>` inside a page-scrolled table **silently does nothing**. Therefore the table
gets its own scroll container:

```tsx
<div className="rounded-xl border border-hairline max-md:hidden">
  <div className="max-h-[min(70dvh,720px)] overflow-y-auto overflow-x-auto">
    <table className="w-full text-left tabular-nums">
      <thead>
        <tr className="sticky top-0 z-20 border-b border-hairline bg-paper text-[11px] font-semibold tracking-[0.08em] text-[#6b7167]">
```

Do **not** put `overflow-hidden` on the wrapper (the guests table does; copying it here breaks the
sticky head). Round the top corners with `first:rounded-tl-[11px] last:rounded-tr-[11px]` on the
header cells.

**Column order — left to right, always visible:**

| # | Header | Width / align | Content |
|---|---|---|---|
| 1 | `LINE` | `w-[26%] px-4 py-3` left | Item name (`text-[13.5px] font-medium text-ink`) and, on a second line, the linked vendor as `text-[11.5px] text-olive hover:text-rose` linking to `/admin/vendors/{id}`, or `text-[11.5px] text-muted` reading `No vendor yet`. Qty/each, when present, appends to that second line as `· 200 × $4.00`. |
| 2 | `ALISON` | `w-[11%] px-3 py-3 text-right` | `benchmark`, `text-[13px] text-muted`. Empty → `—`. |
| 3 | `ESTIMATE` | `w-[11%] text-right` | editable `MoneyCell` |
| 4 | `QUOTE` | `w-[11%] text-right` | editable `MoneyCell` |
| 5 | `CONTRACT` | `w-[11%] text-right` | editable `MoneyCell`, value rendered `font-semibold text-ink` because it is the committed number |
| 6 | `PAID` | `w-[11%] text-right` | derived, `text-olive-deep`; `text-muted` when zero |
| 7 | `STILL TO PAY` | `w-[11%] text-right` | derived; `text-rose` when the item has an overdue payment |
| 8 | `VS ALISON` | `w-[8%] px-3 text-right` | `DeltaCell` |
| 9 | — | `w-9 px-2` | expand chevron button, `aria-expanded`, `aria-label="Open {item name}"` |

ALISON sits immediately left of ESTIMATE so the eye reads "what it actually cost her → what we
think". **It is never behind a toggle, a tab, or a hover.** Vendor is folded into column 1 rather
than given its own column: it buys ~140px of number width and reads better as a subtitle.

**Revealed on expand (the drawer, 3.5), not columns:** currency, notes, qty/each editing, the
pending-guest-count flag, attachments, the payment schedule, vendor picker, delete.

**Delta rendering** — `DeltaCell.tsx`. `delta = forecast − benchmark`.

```
benchmark === 0                 → <span className="text-[12.5px] text-muted">—</span>
delta > 0  (more than Alison)   → <span className="text-[12.5px] font-medium text-rose">+$4,300</span>
delta < 0  (less than Alison)   → <span className="text-[12.5px] font-medium text-olive-deep">−$1,180</span>
delta === 0                     → <span className="text-[12.5px] text-muted">even</span>
```

Minus sign is U+2212 (`−`), produced by `formatMoneyDelta`, never a hyphen. **Over is not "bad".**
A one-line legend sits under the table, `text-[11.5px] text-muted`, with the exact string from the
copy deck saying so — the colour is a direction, not a verdict.

**Category grouping.** One `<tbody>` per category. Its first `<tr>` is the category header *and*
its subtotal row, in the same columns, so the summary reads down the same axis as the details:

```tsx
<tr className="border-y border-hairline bg-sage-band/50">
  <td className="px-4 py-2.5">
    <button className="flex items-center gap-2 text-left">
      <svg className={`h-3 w-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${collapsed ? "" : "rotate-90"}`} …chevron-right… />
      <span className="text-[13px] font-semibold text-olive-deep">Food and Beverage</span>
      <span className="text-[11.5px] font-normal text-[#6b7167]">7 lines · target $16,500</span>
    </button>
  </td>
  …the same 7 numeric cells, each the category rollup, in text-[12.5px] font-semibold text-ink…
</tr>
```

Collapsed state lives in `BudgetScreen` as a `Set<string>` of category ids; collapsing hides only
the item rows, never the subtotal row. Category order = `budget_categories.sort_order`, with
`"Everything else"` last.

**Grand totals** live in `<tfoot>` with `className="sticky bottom-0 z-20 border-t-2 border-hairline bg-paper"`
— same seven numeric columns, `text-[13px] font-semibold text-ink`, LINE cell reading `Everything`.
This is where "Actual Spend", "Contracted Spend" and "Remaining Balance" land as column sums, which
is the demotion promised in 3.2.

**Phone layout** — `BudgetItemCards.tsx`, `md:hidden`, a genuine duplicate list (copy the structure
from the `md:hidden` block in `components/admin/GuestList.tsx`). Grouped by category with a small
`text-[11px] font-semibold tracking-[0.08em] text-[#6b7167] uppercase` heading + category total.
Each card is a button that opens the drawer full-screen:

```tsx
<button className="flex w-full items-start gap-3 rounded-xl border border-hairline bg-white/70 px-4 py-3.5 text-left active:bg-paper">
```

The phone card shows exactly four things, no more: **item name** (`text-[14px] font-semibold text-ink`),
**vendor or "No vendor yet"** (`text-[12.5px] text-[#4a5147]`), the **forecast** big on the right
(`text-[15px] font-semibold text-ink tabular-nums`), and under it one status line
(`text-[11.5px]`): `"$2,000 paid · $13,370 to go"`, or `"Paid in full"` in `text-olive-deep`, or
`"$1,500 overdue"` in `text-rose`. The Alison number appears as a third line
`text-[11.5px] text-muted` reading `Alison: $6,750 · +$8,620` with the delta coloured by the same
rule. **No inline editing on phone** — tapping opens the drawer. Say so in the empty-space copy.

**Empty state** inside the table: a single `<tr><td colSpan={9} className="px-4 py-10 text-center text-[13px] text-muted">`
row, per `GuestList.tsx`. Text from 3.10.

### 3.4 Inline editing

She is a spreadsheet refugee. A number must be changeable where it is read. Cost cells edit
**inline**; everything else edits in the drawer.

**Rendering.** `MoneyCell.tsx` always renders a real `<input>`, styled to look like text until
focused — this is what makes Tab work between cells with zero focus management:

```tsx
<input
  inputMode="decimal"
  value={draft}
  disabled={!canEdit || pending}
  aria-label={`${fieldLabel} for ${itemName}`}
  className={`w-full rounded-md border bg-transparent px-2 py-1.5 text-right text-[13px] tabular-nums outline-none transition-colors duration-150 motion-reduce:transition-none
    ${errored ? "border-[#e5c8bf] bg-blush text-rose-deep" : justSaved ? "border-olive bg-transparent" : "border-transparent hover:border-[#dddbd0]"}
    focus:border-olive focus:bg-white ${pending ? "opacity-60" : ""}`}
  placeholder="—"
/>
```

Read-only users (`canEdit === false`) get a plain `<span>` instead, never a disabled input.

**Commit.** On `blur` **or** `Enter`. No save on every keystroke.
1. `parseMoneyInput(draft)`. Unparseable → do not call the server: set `errored`, put the parse
   message in `SaveStatus`, keep focus in the cell, leave her text alone so she can fix it.
2. Value unchanged from last committed → no-op, no request, no status line.
3. Otherwise: optimistically write the new cents into `BudgetScreen`'s item map so the row's STILL
   TO PAY, VS ALISON, the category subtotal, the `<tfoot>`, the four headline cards, the bars and
   the cash-flow strip **all recompute in the same frame**. A number that visibly lags its own
   total is how she loses trust in the page.
4. `startTransition(() => saveBudgetItemCost(itemId, field, raw))` — `useTransition`, not
   `useActionState`; there is no form here.

**Server action.**

```ts
export async function saveBudgetItemCost(
  itemId: string,
  field: "estimated_cents" | "quoted_cents" | "contracted_cents" | "benchmark_cents",
  raw: string,
): Promise<ActionResult>
```

`"use server"`, `requireEditor()` first, `unstable_rethrow(error)` as the first line of the catch,
`revalidatePath("/admin/budget")` and `revalidatePath("/admin")` on success (the Overview cards read
the same numbers), `activity.log(scope, { action: "budget.item.updated", … })`, and
`invalidateCache(\`metrics:${scope.weddingId}\`)`. Returns
`{ ok: true, item: ItemRow }` or `{ ok: false, message }`.

Editing `contracted_cents` on an item with a linked vendor also returns
`{ syncedVendor: { name: string; from: number | null; to: number } }` when it pushed the number
onto the vendor; `SaveStatus` then says so out loud (3.10). Silent cross-writes are forbidden.

**How she knows it saved.** Three signals, all cheap:
- The cell border flashes `border-olive` for 900ms then fades back to transparent (`justSaved`
  state, cleared by a `setTimeout` that is cleaned up on unmount).
- `SaveStatus.tsx` under the H1 — a single `role="status" aria-live="polite"` line,
  `text-[12.5px] text-[#6b7167]`, reading `Saved · Venue Rental contract $15,370`. It replaces
  itself on each save; it does not stack.
- The affected totals move. That is the real confirmation.

**How errors surface.** The optimistic value is rolled back to the last server value, the cell goes
`border-[#e5c8bf] bg-blush text-rose-deep`, and `SaveStatus` switches to
`role="alert"` + `text-rose-deep` with the sentence from the action. The error clears when she
focuses that cell again. Never a toast, never an `alert()`, never a full-page error boundary.

**Keyboard, exactly:**
- `Tab` / `Shift+Tab` — natural DOM order, so left→right across a row's editable cells, then into
  the next row's first editable cell. Commit fires on the resulting blur. **No `tabIndex`
  management, no arrow-key grid navigation** (explicitly out of scope; do not build it).
- `Enter` — commit and blur; if the cell is in the `NewItemRow`, commit and move focus to the new
  blank row's name input instead.
- `Escape` — revert `draft` to the last committed value, clear `errored`, blur. Does not hit the
  server.
- The expand chevron and the collapse chevrons are real `<button>`s and are in the tab order.

### 3.5 The item drawer

`ItemDrawer.tsx`. Right-hand drawer on desktop, full-screen sheet on phone. Panel:
`fixed inset-y-0 right-0 z-50 w-[460px] max-w-full overflow-y-auto border-l border-hairline bg-cream p-6 shadow-[0_0_40px_rgba(28,35,27,0.14)] max-md:inset-0 max-md:w-full max-md:border-l-0`,
with a `fixed inset-0 z-40 bg-ink/20` scrim. Closes on scrim click, on `Escape`, and on the close
button; focus moves to the panel on open and returns to the chevron on close.
Use `framer-motion` only if a plain `transition-transform` looks wrong — a CSS translate is enough.

Header: item name as an editable `<input>` in `font-display text-[24px] font-medium text-olive-deep`
on a transparent border, category as a `<select>` beneath it, both saving on blur.

**Fields, in this order:**

1. **The cost row** — four money inputs side by side under one `text-[11px]` uppercase label
   `WHAT IT COSTS`: `Alison paid` (`benchmark_cents`, editable, muted styling), `Estimate`,
   `Quote`, `Contract`. Directly beneath, a read-only line: `Forecast $15,370 · paid $2,000 · still
   to pay $13,370 · +$8,620 vs Alison`.
2. **Vendor** — `VendorLinkPicker.tsx`. A `<select>` of this wedding's vendors sorted by name, first
   option `Not booked yet`, plus a link `Add a new vendor` to `/admin/vendors?new=1`. When a vendor
   with a `contracted_cents` is selected and the item already has a *different* contract number,
   render the reconciliation prompt from 3.10 with two buttons — `Use the vendor's number` /
   `Keep mine` — and write nothing until she picks. This is the one-directional-and-explicit rule
   from the pre-decided decisions.
3. **Quantity** — `Qty` (integer) and `Each` (money) inputs. If both are set and `contracted_cents`
   is null, a ghost hint next to Estimate reads `200 × $4.00 = $800 — use this?` as a button that
   fills the estimate. Never auto-fills.
4. **Currency** — a `<select>` of `USD` / `MXN` defaulting to `USD`. Next to it, permanently:
   `We don't convert between currencies — see the note below.` If any item on the wedding is not
   `USD`, a `rounded-xl border border-blush-border bg-blush p-4 text-[12.5px] text-rose-deep` panel
   appears at the top of the *page* with the open-question copy from 3.10.
5. **Pending final guest count** — a checkbox `total_floats_with_guest_count boolean`. When on, the
   item's forecast is annotated everywhere with an amber badge `bg-[#f3edd8] text-[#7a6420]` reading
   `PER HEAD` in the table's LINE cell, and the drawer shows
   `Estimated at {n} guests. This will move when the final count lands.` where `n` is the current
   attending count passed in from the page.
6. **Notes** — `<textarea rows={3}>` with the house input classes, placeholder
   `Anything you want to remember about this line`, saves on blur.
7. **Payment schedule** — `PaymentSchedule.tsx` (3.6).
8. **Attachments** — a section headed `Contracts & receipts`. **Ship the section only if
   `budget_item_attachments` exists in the migration section.** If it does: a list of
   `{ label, url }` rows with an add-by-URL form (label + link), each row an `<a target="_blank" rel="noreferrer">`
   in `text-[12.5px] text-olive underline hover:text-rose`, with a `ConfirmButton` to remove. **Do
   not build file upload** — there is no Blob integration in this app and inventing one is out of
   scope. If the table does not exist, render nothing and note it as deferred; do not fake it.
9. **Delete** — `ConfirmButton` with `variant="danger"`, from `components/admin/ConfirmButton.tsx`,
   label / confirmLabel in 3.10. Deleting an item deletes its payments (FK cascade); the confirm
   label must say the payment count.

### 3.6 Payments UI

`PaymentSchedule.tsx` + `PaymentRow.tsx`. Table shape: `budget_payments` with at least
`label text`, `amount_cents bigint`, `due_date date`, `paid_at date`, `method text`.

**Adding an installment.** An always-present blank row at the bottom of the list: `Label`
(placeholder `Deposit`, `Second payment`, `Final balance` cycled by index), `Amount`, `Due`
(`<input type="date">`), and a `+ Add` button that is the house secondary button. Submits via
`addBudgetPayment(itemId, formData)`. On success the row clears and focus returns to the new blank
label input.

**Deposit auto-split** — `DepositSplit.tsx`, shown *above* the list when the item has **zero**
payments, in a `rounded-xl border border-hairline bg-paper p-4` panel:
- `Total` money input (pre-filled from `contracted_cents ?? quoted_cents ?? estimated_cents`).
- `Deposit` money input.
- A live read-back line, `text-[13px] text-[#4a5147]`, not an input: the balance is **computed and
  read-only** — she never subtracts.
- Two date inputs: `Deposit due` (defaults to today, venue tz) and `Balance due` (defaults to 30
  days before `weddings.wedding_date`, computed with `daysUntilCalendarDate` semantics, never
  `new Date(dateString)`).
- One button that creates both payments in a single action `splitIntoDeposit(itemId, formData)`.
- If deposit ≥ total: the button is disabled and the read-back reads `That's the whole thing —
  add it as a single payment instead.`

**Marking paid.** Each row has a checkbox styled as a small pill button. Ticking it calls
`setPaymentPaid(paymentId, true, paidOnISO)` with `paidOnISO` defaulting to today in the venue
timezone, and immediately reveals a `<input type="date">` pre-filled with that day so she can
correct it — no modal, no second step. Unticking clears `paid_at` and needs no confirmation (it is
trivially reversible). Marking paid optimistically bumps PAID, STILL TO PAY, card 3, card 4 and the
cash-flow strip.

**Row styling by state** (`paymentState` from `budget-rules.ts`):

| State | Row classes | Right-hand label |
|---|---|---|
| `paid` | `border-b border-[#f1f0ea] opacity-80` | `bg-sage-band text-olive-deep` badge `PAID {formatCalendarDate(paid_at)}` |
| `overdue` | `border-b border-blush-border bg-blush` | `text-rose-deep font-semibold` `{n} days overdue` |
| `due_soon` | `border-b border-[#f1f0ea]` | `bg-[#f3edd8] text-[#7a6420]` badge `DUE IN {n} DAYS` |
| `scheduled` | `border-b border-[#f1f0ea]` | `text-muted` `Due {formatCalendarDate(due_date)}` |

`{n}` comes from `daysUntilCalendarDate(due_date, new Date(), timeZone)`. **Never
`new Date(payment.due_date)`** — that reads a calendar day as a UTC instant and shifts it a day in
the venue's zone. This is the exact bug class already shipped twice in this repo.

**"Pending final guest count"** items (3.5 item 5) show one extra line under their payment list:
`This total moves with the headcount, so the balance is a best guess for now.`

**Overdue rollup.** If `overdueCents > 0` anywhere, the page renders a
`rounded-xl border border-blush-border bg-blush p-5` panel directly under the headline cards —
copy the exact shape of the "Missing meal choices" panel in
`app/admin/(dashboard)/meals/page.tsx` — listing each overdue payment as a
`rounded-full bg-white px-3 py-1.5 text-[12.5px] font-medium text-rose-deep hover:text-rose` chip
`{item name} · {amount} · {n} days`, each opening that item's drawer.

### 3.7 Setting the total budget + seeded allocation

`BudgetSetup.tsx`. Two steps, one screen, no wizard chrome.

**Step 1 — the total.** A `font-display text-[30px] leading-[1.15] font-medium text-olive-deep`
heading, one large money input (`text-[28px]`, right-aligned, `$` prefix rendered as a sibling
span), and a `Continue` primary button. Under it, `text-[12.5px] text-muted`:
`Alison and her husband spent $40,962 all in. You can change this whenever you like.`

**Step 2 — per-category targets, all editable.** Immediately on Continue (no navigation), the
suggested split appears. Defaults come from `seedAllocation(totalCents, benchmarkCategories)`:
each seed category's percentage is **Alison's actual spend in that category as a share of Alison's
total**, rounded to whole percent — grounded in her friend's real wedding, not a generic industry
table. Contingency is then added at a fixed **8%** and every other percentage is scaled down
proportionally so the set sums to 100.

Each row: category name (editable text input), a percent input (`w-16`, integer, `%` suffix), the
computed dollar target (read-only, `text-[13.5px] font-semibold text-ink tabular-nums`), Alison's
actual for that category (`text-[12px] text-muted`), and a remove button — **disabled on
contingency**, with the reason as its `title`.

Below the rows, a live remainder line and the even-out affordance:
- `sum === 100` → `text-olive-deep`: `That's all 100% — $60,000 accounted for.`
- `sum < 100` → `text-[#6b7167]`: `{100−sum}% left to allocate ({formatMoney(rest)}).` plus a
  secondary button `Put the rest in contingency`.
- `sum > 100` → `text-rose-deep`: `You're {sum−100}% over ({formatMoney(over)} more than your
  total).` plus a secondary button `Trim it from contingency` (disabled if contingency can't absorb it).

`Save these targets` (primary button) is **disabled unless `sum === 100`**, with the reason shown
as the remainder line — never a hidden disabled button with no explanation.

**Contingency is mandatory.** `budget_categories.is_contingency boolean not null default false`,
exactly one row true. `BudgetSetup` seeds it at 8% and refuses to remove it; `CategoryForm` refuses
to delete it; the percent input clamps to a minimum of 5. If she types below 5 the input snaps back
to 5 and the line reads: `Every wedding finds a surprise. We keep at least 5% aside.`

Re-entry: once a budget exists, `BudgetSetup` is reachable from a secondary button in the page
header labelled `Adjust targets`, pre-filled with current values, and it **never touches items** —
only `weddings.budget_total_cents` (Binding Decision 1 — there is no `budget_settings` table) and `budget_categories.target_cents`.

### 3.8 Category spend visualization

Hand-built `<div>` bars only. No chart library, no SVG charts, no canvas. The track is always
`bg-[#f0efe3]`, matching the meal bars in `app/admin/(dashboard)/meals/page.tsx`.

**A. Spend against target** — `CategoryBars.tsx`, in a `rounded-xl border border-hairline p-5` card
headed `Where the money goes`. One row per category:

```tsx
<div className="flex items-center gap-3">
  <span className="w-40 shrink-0 truncate text-[13px] font-medium text-ink">Food and Beverage</span>
  <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#f0efe3]">
    <span className="absolute inset-y-0 left-0 rounded-full bg-olive-deep" style={{ width: `${pctPaid}%` }} />
    <span className="absolute inset-y-0 rounded-full bg-olive" style={{ left: `${pctPaid}%`, width: `${pctCommitted}%` }} />
    <span className="absolute inset-y-0 rounded-full bg-[#c9cdbf]" style={{ left: `${pctPaid + pctCommitted}%`, width: `${pctEstimated}%` }} />
    <span className="absolute inset-y-[-3px] w-[2px] bg-rose" style={{ left: `${pctTarget}%` }} aria-hidden />
  </span>
  <span className="w-24 shrink-0 text-right text-[12.5px] text-[#4a5147] tabular-nums">$16,500</span>
</div>
```

Segment maths, all as a percentage of `scaleMax = max(all categories' max(forecast, target))` so
every row shares one scale: `pctPaid = paid/scaleMax*100`,
`pctCommitted = max(0, contracted − paid)/scaleMax*100`,
`pctEstimated = max(0, forecast − max(contracted, paid))/scaleMax*100`,
`pctTarget = min(100, target/scaleMax*100)`. Clamp every value to `[0, 100]` and clamp the sum of
the three segments to 100 so a runaway category can't overflow the track. A category whose forecast
exceeds its target gets its right-hand amount in `text-rose`. A three-swatch legend sits above the
rows in `text-[11.5px] text-muted`: `Paid` / `Contracted, not yet paid` / `Still an estimate`, plus
`Target` for the rose tick.

**B. Budget vs. Alison** — `BenchmarkCompare.tsx`, its own
`rounded-xl border border-hairline p-5` card headed `You and Alison, side by side`. Two stacked
bars per category on one shared scale (`scaleMax = max over categories of max(forecast, benchmark)`):

```tsx
<div className="flex items-center gap-3 py-1.5">
  <span className="w-40 shrink-0 truncate text-[13px] font-medium text-ink">Venue</span>
  <span className="flex flex-1 flex-col gap-1">
    <span className="h-1.5 rounded-full bg-[#f0efe3]"><span className="block h-1.5 rounded-full bg-[#c9cdbf]" style={{ width: `${pctAlison}%` }} /></span>
    <span className="h-1.5 rounded-full bg-[#f0efe3]"><span className="block h-1.5 rounded-full bg-olive" style={{ width: `${pctYou}%` }} /></span>
  </span>
  <span className="w-28 shrink-0 text-right text-[12.5px] tabular-nums">…delta…</span>
</div>
```

Top bar is always Alison (`bg-[#c9cdbf]`), bottom always the couple (`bg-olive`), labelled once in a
legend, not per row. The right-hand cell reuses `DeltaCell`'s colour rule. A closing line under the
card gives the grand comparison sentence from 3.10.

**C. Monthly cash flow** — `CashFlowStrip.tsx`, a `rounded-xl border border-hairline p-5` card
headed `What's due, month by month`. Data from `cashFlowByMonth`, spanning this month through the
wedding month inclusive (min 6 columns):

```tsx
<div className="flex h-28 items-end gap-2">
  {months.map((m) => (
    <div key={m.monthKey} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span className="text-[11px] text-[#6b7167] tabular-nums">{m.dueCents ? formatMoney(m.dueCents) : ""}</span>
      <span className="flex w-full flex-1 items-end">
        <span
          className={`w-full rounded-t-[3px] ${m.overdue ? "bg-rose" : "bg-olive"}`}
          style={{ height: `${Math.max(m.dueCents ? 4 : 0, (m.dueCents / scaleMax) * 100)}%` }}
        />
      </span>
      <span className="text-[10.5px] font-medium tracking-[0.06em] text-[#6b7167] uppercase">{m.label}</span>
    </div>
  ))}
</div>
```

`m.label` is built with `new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })` over
`` `${monthKey}-01T00:00:00Z` `` — never a raw `new Date(dateString)`. The wedding's own month gets
`ring-1 ring-inset ring-rose/40` on its column wrapper and its label in `text-rose`. Under the strip:
one line naming the heaviest month, from the copy deck.

**Placement on the page**, top to bottom: H1 + subtitle + `SaveStatus` → headline cards →
`BudgetLedgerStrip` → `BudgetHealthLine` → overdue panel (conditional) → currency panel
(conditional) → `BudgetTable` / `BudgetItemCards` → `CategoryBars` → `BenchmarkCompare` →
`CashFlowStrip`. Container: `<div className="flex flex-col gap-5">`, matching every other admin page.

### 3.9 Empty states and first run

**No budget settings and no items** — `BudgetEmptyState.tsx` replaces everything below the H1. Copy
the editorial hero shape of `components/admin/import/ReviewStep.tsx`:
`<section className="rounded-2xl border border-hairline bg-white/60 p-6 sm:p-8">`, an eyebrow
`text-[11px] font-semibold tracking-[0.14em] text-[#9aa38f] uppercase`, a
`font-display mt-2 max-w-[22ch] text-[32px] leading-[1.15] font-medium text-olive-deep sm:text-[38px]`
heading, a `mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-[#4a5147]` paragraph, then three
doors as buttons in `mt-7 flex flex-wrap items-center gap-3`:
1. `Start from Alison's wedding` — primary button; seeds the categories and every benchmark from the
   CSV import, leaving all of the couple's own numbers blank.
2. `Set a total and I'll suggest` — secondary; opens `BudgetSetup` step 1.
3. `Just add a line` — secondary; creates one blank item in `Everything else` and focuses its name.

**Settings exist, no items yet:** keep the cards (they read `$0` honestly, not `—`) and show the
in-table empty row with the "add your first line" copy.

**Right after the CSV seed lands:** a dismissible
`rounded-xl border border-hairline bg-sage-band/60 p-4 text-[13px] text-olive-deep` note above the
table, dismissed per-user with the same mechanism as `components/admin/WhatsNew.tsx` (or, if that is
awkward, a `localStorage` key `budget-seed-note-v1`). Copy in 3.10. It must state the item count and
the two real totals.

**A category with no items:** its subtotal row still renders (all zeros) with the LINE cell showing
`Nothing here yet` in `text-muted`, and the `NewItemRow` beneath it.

**Read-only (`viewer`):** every input becomes a `<span>`, every add/delete affordance is omitted, and
a single line under the H1 reads `You're viewing this budget. Ask Juliet if you need to change a number.`

### 3.10 Copy deck — exact strings

⚠ **JSX wrapping hazard.** This toolchain has been observed dropping the leading space of a JSX text
node that wraps to a second line — it once shipped `seats areheld`. **Every string below marked ⚠ is
long enough to wrap in source. Put it in a single JS string expression (`{"…"}` or a `const`), never
as bare JSX text interleaved with `{…}` across lines.** See the comment at
`components/admin/import/ReviewStep.tsx:89-94` for the precedent.

**Page chrome**
- H1: `Budget`
- Subtitle ⚠: `` `${itemCount} lines · ${formatMoney(forecast)} forecast against ${formatMoney(totalBudget)}` ``; when no total is set: `` `${itemCount} lines · ${formatMoney(forecast)} forecast` ``
- Header buttons: `Adjust targets` (secondary), `Add a line` (primary), `Export budget` (secondary, links to `/api/export/budget`)

**Card labels:** `TOTAL BUDGET`, `FORECAST`, `PAID SO FAR`, `DUE IN 30 DAYS`
**Strip labels:** `CONTRACTED`, `STILL ESTIMATED`, `STILL TO PAY`, `LEFT IN BUDGET` / `OVER BUDGET`, `CONTINGENCY LEFT`, `ALISON'S TOTAL`
**Table headers:** `LINE`, `ALISON`, `ESTIMATE`, `QUOTE`, `CONTRACT`, `PAID`, `STILL TO PAY`, `VS ALISON`

**Health line** (`BudgetHealthLine`), pick one ⚠:
- under budget: `` `You're ${formatMoney(-budgetRemaining)} under your total, with ${formatMoney(stillToPay)} still to pay.` ``
- at/over: `` `Your forecast is ${formatMoney(budgetRemaining)} over your total. Nothing's wrong — it just means the number to change is either the budget or a line below.` ``
- no total set: `Set a total budget and this page will tell you where you stand.`

**Delta legend** ⚠: `Rose means more than Alison spent, olive means less. It's a reference point from a real wedding, not a target.`

**Table empty rows**
- no items at all ⚠: `Nothing in the budget yet. Add your first line below, or start from Alison's wedding.`
- category empty: `Nothing here yet`
- phone list footer: `Tap a line to edit it.`

**First-run hero** (`BudgetEmptyState`)
- eyebrow: `THE BUDGET`
- heading: `Let's find out what this wedding costs`
- body ⚠: `You have a spreadsheet with Alison's real numbers in it — what she actually paid, line by line. We can start there, so every estimate you make has something honest to sit next to.`
- buttons: `Start from Alison's wedding`, `Set a total and I'll suggest`, `Just add a line`

**After the CSV seed** ⚠: `` `Your budget is here — ${itemCount} lines across ${categoryCount} categories, with Alison's actual cost beside each one. Her wedding came to ${formatMoney(benchmarkTotal)}; yours is forecast at ${formatMoney(forecast)} right now. Change any number by clicking it.` `` Dismiss link: `Got it`

**Setup flow**
- step 1 heading: `What can you spend, all in?`
- step 1 helper ⚠: `Alison and her husband spent $40,962 all in. You can change this whenever you like.`
- step 2 heading: `Here's a starting split`
- step 2 body ⚠: `These percentages are what Alison actually spent in each category, scaled to your total. Change any of them — nothing is locked except a little kept aside for surprises.`
- remainder lines: as specified in 3.7
- contingency floor: `Every wedding finds a surprise. We keep at least 5% aside.`
- contingency remove title: `Contingency stays. It's the line that saves the rest of them.`
- save: `Save these targets`

**Deposit split**
- heading: `Split it into a deposit and a balance`
- read-back ⚠: `` `Deposit ${formatMoney(deposit)} now, balance ${formatMoney(total - deposit)} later.` ``
- guard: `That's the whole thing — add it as a single payment instead.`
- button: `Create both payments`

**Payments**
- add row button: `+ Add`
- paid badge: `` `PAID ${formatCalendarDate(paid_at)}` ``
- overdue ⚠: `` `${n} ${n === 1 ? "day" : "days"} overdue` ``
- due soon: `` `DUE IN ${n} ${n === 1 ? "DAY" : "DAYS"}` ``
- scheduled: `` `Due ${formatCalendarDate(due_date)}` ``
- floating total ⚠: `This total moves with the headcount, so the balance is a best guess for now.`
- overdue panel heading: `Payments that have slipped past`

**Vendor link + sync** (`VendorLinkPicker`) ⚠
- prompt heading: `` `${vendorName} has a contracted price of ${formatMoney(vendorCents)}` ``
- prompt body: `` `This line says ${formatMoney(itemCents)}. Which one is right?` ``
- buttons: `Use the vendor's number`, `Keep mine`
- after a contract edit syncs outward ⚠: `` `Saved · ${itemName} contract ${formatMoney(to)} — also updated ${vendorName}${from === null ? "" : \`, which said \${formatMoney(from)}\`}.` ``
- no vendor: `No vendor yet` / picker first option `Not booked yet` / link `Add a new vendor`

**Currency panel** ⚠: `One or more lines are in Mexican pesos. We show every number exactly as you typed it and never convert between currencies — so the totals on this page mix dollars and pesos. Tell us which you'd rather work in and we'll sort it out.`

**Saving**
- success ⚠: `` `Saved · ${itemName} ${fieldLabel} ${formatMoney(cents)}` ``
- parse error ⚠: `` `We couldn't read "${raw}" as an amount. Try something like 1,500 or $1,500.` ``
- server error fallback: `Something went wrong. Nothing was changed.`

**Destructive**
- item delete ⚠: label `Delete this line`, confirmLabel `` `Delete ${itemName} and its ${n} ${n === 1 ? "payment" : "payments"}?` ``
- payment delete: label `Remove`, confirmLabel `Remove this payment?`
- category delete ⚠: label `Delete category`, confirmLabel `` `Move ${n} lines to Everything else?` `` (never delete items with the category)

**Bars**
- `Where the money goes` / legend `Paid`, `Contracted, not yet paid`, `Still an estimate`, `Target`
- `You and Alison, side by side` / legend `Alison` / `You`
- comparison closing line ⚠: `` `All in, you're forecasting ${formatMoney(Math.abs(delta))} ${delta > 0 ? "more" : "less"} than Alison spent.` ``
- `What's due, month by month`
- heaviest month ⚠: `` `${monthLabel} is the heaviest — ${formatMoney(cents)} falls due.` `` ; when nothing is scheduled: `Nothing is scheduled yet. Add payments to a line and they'll show up here.`

**Viewer**: `You're viewing this budget. Ask Juliet if you need to change a number.`

Never use: "dashboard", "line item", "record", "entity", "sync", "N/A", "submit", "utilization",
"burn rate", "on track". Contractions are correct here. Curly apostrophes (`’`) in prose, straight
ones only inside code identifiers.

### 3.11 Acceptance checks

**Commands that must pass, in this order:**
1. `npx tsc --noEmit` — clean. No `any`, no `@ts-expect-error`.
2. `npm test` — all previously-passing tests still pass, plus new `lib/format/money.test.ts` and
   `lib/data/budget-rules.test.ts`. At minimum these cases exist: `formatMoney(1537000) === "$15,370"`;
   `formatMoney(0) === "$0"`; `parseMoneyInput("$1,500") === 150000`; `parseMoneyInput("  ") === null`;
   `itemForecastCents` prefers contracted over quoted over estimated; `itemForecastCents` never
   returns less than paid; a payment due "today" in `America/Los_Angeles` is not counted overdue when
   the server clock is already tomorrow in UTC.
3. `npm run build` — succeeds.

**Browser verification is mandatory and is not optional or inferable.** Run `npm run dev` (port
3006) and drive a real browser with Chrome MCP against `http://localhost:3006/admin/budget`. Do not
mark this slice done from a passing build. In the browser, confirm each of these by looking at it:

1. The four headline cards render real numbers and the secondary strip wraps cleanly at 1280px.
2. `TOTAL BUDGET − FORECAST` shown on card 2 equals `LEFT IN BUDGET` in the strip, and `PAID SO FAR`
   equals the `PAID` column total in `<tfoot>`. Read the pixels; do not assume.
3. Scroll the table: the `<thead>` stays pinned and the `<tfoot>` stays pinned. (If it doesn't, the
   `overflow-hidden` trap in 3.3 was not handled.)
4. Click an `ESTIMATE` cell, type `1500`, press `Tab`: the cell shows `$1,500`, the row's
   `STILL TO PAY`, `VS ALISON`, its category subtotal, the footer and the headline cards all move in
   the same repaint, the cell border flashes olive, and `SaveStatus` reads `Saved · …`. Reload the
   page and the number is still `$1,500`.
5. Type `banana` in a money cell and Tab: `SaveStatus` shows the parse message in rose, the cell goes
   blush, no network write happens, and the totals do not move.
6. Press `Escape` mid-edit: the cell reverts and nothing is saved.
7. Open an item drawer, use the deposit split with total `$10,000` / deposit `$2,000`: the read-back
   says `balance $8,000` without her typing it, and two payments appear with the right due dates.
8. Mark a payment paid: the badge turns sage, a paid-on date input appears pre-filled with today
   **in the venue timezone**, and `PAID SO FAR` increases by exactly that amount.
9. Set one payment's due date to yesterday: the row turns blush, the overdue panel appears under the
   cards, and card 4's value turns rose. **Verify the day count is right when the machine's clock is
   past midnight UTC but not past midnight in `America/Los_Angeles`** — set the wedding's timezone or
   the system clock and check, don't reason about it.
10. Run the setup flow: entering `$60,000` produces per-category suggestions whose percentages sum to
    100 with a contingency row present, `Save these targets` is disabled at 97% and enabled at 100%,
    and the contingency row cannot be removed or dropped below 5%.
11. Resize to 390px wide: the desktop table is gone, the phone cards show name / vendor / forecast /
    status / Alison line, tapping a card opens a full-screen drawer, and **the page does not scroll
    horizontally**.
12. All three bar visualizations render with `#f0efe3` tracks, share a scale within each card, and
    contain no `<svg>` chart and no third-party chart script.
13. Empty state: with an empty budget the hero renders and all three doors work.
14. Read the whole page for dropped leading spaces — specifically every ⚠ string. `seats areheld`
    must not happen again.
15. Sign in as the `editor` account and confirm writes work; confirm a `viewer` sees text, not
    inputs, and no add/delete buttons.

**Open questions to surface in the build log, not to guess at:**
- The seed CSV's `Total Cost` row says `$60,170`, but summing Juliet's category estimates gives
  `$62,970` — the sheet's total appears to exclude `Flights ($2,800)`. This page computes from the
  items, so it will read `$62,970` and Juliet will notice. Do not hard-code `$60,170` anywhere; show
  the computed number and flag the discrepancy for her.
- Several Alison-only categories (`Gifts`, `Flowers + Decor`, `Printing`) have detailed sub-items with
  no Juliet estimate at all. They must import with `benchmark_cents` set and the couple's columns
  blank — blank is a real answer here, not zero.
- Currency: the venue is in Guadalajara, the sheet is in USD. Ship USD-only display with the panel
  copy above and ask Juliet before adding MXN handling.

---

## Vendor Screens & the Overview Dashboard

This section owns everything Juliet **looks at and clicks** for vendors, plus the changes to the
existing Overview page. It does not own the migration, the budget screens, or `lib/format/money.ts`.

Before writing any page or layout file, read `node_modules/next/dist/docs/` (AGENTS.md mandates it —
this Next.js differs from training data). Every page file in this section ends with
`export const dynamic = "force-dynamic";`.

---

### 0. Contracts with the other sections (read first — do not guess these)

**Schema columns this section binds to.** The migration section owns `supabase/migrations/0012_*`.
These exact names are what the UI reads and writes. If the schema section chooses different names,
the schema section wins and every binding below is renamed to match — but the *shape* is fixed.

`vendors`: `id uuid`, `wedding_id uuid`, `name text not null`, `category text not null`,
`status text not null` (`researching|contacted|quoted|booked|completed|passed`),
`priority text not null` (`must_have|nice_to_have|optional`),
`assigned_to text null` (`juliet|juan|both`),
`contact_name text`, `company text`, `phone text`, `email text`, `website text`, `instagram text`,
`address text`, `notes text`,
`estimated_cents bigint`, `quoted_cents bigint`, `contracted_cents bigint`,
`currency text not null default 'USD'`,
`contract_signed_at date`, `contract_url text`,
`created_at timestamptz`, `updated_at timestamptz`.

`budget_items.vendor_id uuid null references vendors(id) on delete set null` — the link lives on the
budget side (shared-context decision 3). A vendor therefore has **zero, one, or many** linked items.

`budget_payments`: `id`, `wedding_id`, `budget_item_id`, `label text`, `amount_cents bigint`,
`due_date date`, `paid boolean not null default false`, `paid_on date`, `method text`,
`is_deposit boolean not null default false`.

**Data functions this section calls.** If no other section has created `lib/data/vendors.ts` by the
time this milestone runs, this section creates it, thin-shell style (I/O only, all logic in
`lib/data/vendor-rules.ts`).

```ts
// lib/data/vendors.ts
list(scope, opts?: { status?: VendorStatus | "all" }): Promise<VendorRow[]>
get(scope, vendorId): Promise<VendorDetail>            // vendor + linked items + their payments
byCategory(scope, category): Promise<VendorDetail[]>   // for the compare view
create(scope, input): Promise<string>                  // returns new id
update(scope, vendorId, patch): Promise<void>
remove(scope, vendorId): Promise<void>
linkBudgetItem(scope, vendorId, budgetItemId): Promise<void>
unlinkBudgetItem(scope, budgetItemId): Promise<void>
```

**From the budget section:** `formatMoney(cents)` and `parseMoneyInput(string)` in
`lib/format/money.ts`; a deep-link route for one budget item. This section links to
`/admin/budget/items/${budgetItemId}`. If the budget section chooses a different path, it must
export `budgetItemHref(id: string): string` from `lib/format/budget-links.ts` and this section uses
that instead of a literal.

**To the tasks section:** `vendor_tasks` lands in the last milestone. Everything here treats
`tasksDueThisWeek` as `number | null` and renders a defined placeholder when it is `null`
(see §7). Nothing in this section may be blocked on that table existing.

---

### 1. Routes, files, and navigation

#### 1.1 New files (exact paths, one-line responsibility)

| Path | Responsibility |
| --- | --- |
| `app/admin/(dashboard)/vendors/page.tsx` | Server: vendor list — reads role, status chips, roles strip, summary cards, hands rows to `VendorList`. |
| `app/admin/(dashboard)/vendors/[vendorId]/page.tsx` | Server: one vendor's profile — General / Contact / Financial groups plus linked-budget, payments, contract and activity panels. |
| `app/admin/(dashboard)/vendors/compare/page.tsx` | Server: side-by-side quote comparison for `?category=`; with no `category`, a picker of every role holding 2+ vendors. |
| `app/admin/(dashboard)/vendors/actions.ts` | `"use server"` — every vendor mutation; each opens with `requireEditor()` and each catch opens with `unstable_rethrow(error)`. |
| `components/admin/vendors/status.ts` | Exports `VENDOR_STATUSES`, `VENDOR_STATUS_LABEL`, `VENDOR_STATUS_BADGE`, `VENDOR_STATUS_RANK` — the single badge/class map, imported by list, profile, compare and Overview. |
| `components/admin/vendors/VendorList.tsx` | Client: live search, client-side sort, desktop `<table>` + duplicate `md:hidden` card list + empty state. |
| `components/admin/vendors/VendorRoleStrip.tsx` | Client: the "build your wedding team" roles grid — filled / in-progress / empty slots, with "show all roles" expansion. |
| `components/admin/vendors/VendorSummaryCards.tsx` | Client: the four-card metric strip at the top of the vendors page (§6). |
| `components/admin/vendors/NewVendorForm.tsx` | Client: `useActionState` form to add a vendor (name + role + status), used by the page header and by every empty role slot. |
| `components/admin/vendors/VendorGeneralForm.tsx` | Client: General group editor (name, role, status, priority, owner, notes). |
| `components/admin/vendors/VendorContactForm.tsx` | Client: Contact group editor (contact, company, phone, email, website, Instagram, address). |
| `components/admin/vendors/VendorFinancialForm.tsx` | Client: Financial group editor (estimated / quoted / contract price) **plus** the budget-sync reconcile panel (§4.3). |
| `components/admin/vendors/VendorDepositSetup.tsx` | Client: one-time "set up the deposit" sub-form that creates the deposit + balance payment pair, balance always computed. |
| `components/admin/vendors/VendorPaymentsPanel.tsx` | Read-only ledger of the linked items' payments with due-date countdowns and a link into the budget item. |
| `components/admin/vendors/VendorBudgetLink.tsx` | Client: link / unlink this vendor to a budget item; shows the item's benchmark and current numbers. |
| `components/admin/vendors/VendorContractCard.tsx` | Client: contract signed date + contract link, and the "still no contract" nudge for booked vendors. |
| `components/admin/vendors/VendorCompare.tsx` | Client: the column-per-vendor comparison grid with "Book this one" / "Pass" / "Reconsider" row. |
| `components/admin/CountdownRibbon.tsx` | Server component: the Overview countdown band (days out, wedding day, RSVP deadline). |
| `components/admin/MoneyCards.tsx` | Client: the Overview money row — Budget Spent / Budget Remaining / Due This Month / Vendors Booked. |
| `components/admin/WeddingTeamPanel.tsx` | Server component: Overview "Your wedding team" panel — booked, still deciding, contracts outstanding, roles bar, tasks line. |
| `components/admin/UpcomingPayments.tsx` | Server component: the "Coming up" payment list, reused on both Overview and the vendors page. |
| `lib/domain/vendor-roles.ts` | **Pure.** `DEFAULT_VENDOR_ROLES`, `roleSlots(defaults, vendors)`, `roleFillCounts(slots)`. |
| `lib/domain/vendor-roles.test.ts` | Vitest for the above. |
| `lib/data/vendor-rules.ts` | **Pure.** All derived vendor + payment numbers: status counts, contracts outstanding, awaiting deposit, vendor spend, payments due in a month window, compare rows. |
| `lib/data/vendor-rules.test.ts` | Vitest for the above. |

#### 1.2 Edited files

| Path | Edit |
| --- | --- |
| `components/admin/SideNav.tsx` | Add the Vendors entry to `NAV` (below). |
| `app/admin/(dashboard)/page.tsx` | Overview restructure (§7). |
| `lib/data/metrics.ts` | Add `moneyAndVendors(scope)` (§7.2). |
| `lib/types.ts` | Add `VendorStatus`, `VendorPriority`, `VendorRow`, `VendorDetail`, `VendorListRow`, `RoleSlot`, `MoneyVendorMetrics` — `MoneyVendorMetrics` goes directly under the existing `OverviewMetrics` at the bottom of the file. |
| `lib/format/wedding-date.ts` | Add `formatCalendarDateLong`, `signedDaysUntilCalendarDate`, `calendarMonthBounds` (§7.3), each unit-tested in the existing `lib/format/wedding-date.test.ts`. |

`components/admin/MetricCards.tsx` is **not** edited. Leave its odd
`m.guestsWithoutTable + m.dietaryCount === 0 ? 0 : m.guestsWithoutTable` expression exactly as it is;
do not "fix" it in this milestone — the diff must stay reviewable.

#### 1.3 The `NAV` entry

Insert into `NAV` in `components/admin/SideNav.tsx` **after the Meals object and before
Communications**. The budget section inserts its entry immediately above this one, so the final order
is: Overview, Guests, Events, Seating, Meals, **Budget**, **Vendors**, Communications,
Imports & Exports, Team. If Budget has not landed yet, Vendors sits directly after Meals and Budget
slots in above it later.

```tsx
  {
    href: "/admin/vendors",
    label: "Vendors",
    icon: (
      <>
        <path d="M3 9.5 4.6 4.8A2 2 0 0 1 6.5 3.4h11a2 2 0 0 1 1.9 1.4L21 9.5" />
        <path d="M4.6 9.5v9a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-9" />
        <path d="M3 9.5h18" />
        <path d="M9.6 20.5V15h4.8v5.5" />
      </>
    ),
  },
```

A storefront awning + door, drawn on the same 24x24 grid at the same 1.8 stroke as the rest — no fill,
round caps, no element outside `0 0 24 24`. No change to `SideNav`'s active logic is needed:
`pathname.startsWith("/admin/vendors")` already keeps the item lit on profile and compare pages.

#### 1.4 Auth on these pages

`app/admin/(dashboard)/layout.tsx` already calls `requireAdmin()` and gates the shell, so read pages
add no gate of their own. Each of the three vendor pages does `const admin = await requireAdmin();`
and passes `canEdit={admin.role !== "viewer"}` down to the client components — viewers see the same
screens with every form, ConfirmButton and "Book this one" control absent (not disabled, absent).
Every action in `vendors/actions.ts` calls `requireEditor()` as its first statement regardless.

---

### 2. Vendor list page — `app/admin/(dashboard)/vendors/page.tsx`

Copy the structure of `app/admin/(dashboard)/guests/page.tsx` (server fetch → map to a serializable
row type → filter chips as `<Link>`s → hand rows to a client list component) and
`components/admin/GuestList.tsx` (`useMemo` filtering, 250ms debounced `window.history.replaceState`,
desktop table + duplicate `md:hidden` cards + explicit empty state).

#### 2.1 Page composition, top to bottom

1. Header row — `flex items-center gap-4`: `<h1 className="text-[22px] font-semibold text-ink">Vendors</h1>`
   with subtitle `mt-0.5 text-[13.5px] text-[#6b7167]`, then a spacer, then a secondary-button
   `<Link>` to `/admin/vendors/compare` labelled **Compare quotes**, then `NewVendorForm`'s trigger
   as the primary button labelled **Add a vendor**.
2. `<VendorSummaryCards />` — §6.
3. `<VendorRoleStrip />` — §3.
4. Status filter chips (below).
5. `<VendorList />` — search, sort, table, phone cards.
6. `<UpcomingPayments limit={5} heading="Coming up" />` — the demoted payment-deadline numbers.

#### 2.2 Status filter chips

Server-side, exactly the guests-page markup — the chip changes what is fetched, so it is a `<Link>`,
not client state:

```tsx
const FILTERS: Array<{ key: VendorStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "researching", label: "Researching" },
  { key: "contacted", label: "Contacted" },
  { key: "quoted", label: "Quoted" },
  { key: "booked", label: "Booked" },
  { key: "completed", label: "Completed" },
  { key: "passed", label: "Passed" },
];
```

Chip classes verbatim from the guests page:
`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors`, active
`bg-olive-deep text-cream`, inactive `border border-[#dddbd0] text-[#4a5147] hover:border-rose hover:text-rose`,
wrapper `flex flex-wrap gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-1`.
Each chip carries its count as a trailing muted span — this is where the demoted per-status numbers
from §6 live: `Researching <span className="ml-1 opacity-60">4</span>`. `href` preserves `?q=` the
same way the guests page does.

#### 2.3 Status badge map — `components/admin/vendors/status.ts`

House colors only, no new hexes. `contacted` earns a border rather than a new tint so it is
distinguishable from `researching` at a glance.

```ts
export const VENDOR_STATUSES = ["researching","contacted","quoted","booked","completed","passed"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  researching: "Researching",
  contacted: "Contacted",
  quoted: "Quoted",
  booked: "Booked",
  completed: "Completed",
  passed: "Passed",
};

export const VENDOR_STATUS_BADGE: Record<VendorStatus, string> = {
  researching: "bg-[#f1f0ea] text-[#6b7167]",
  contacted: "border border-[#dddbd0] bg-white text-[#4a5147]",
  quoted: "bg-[#f3edd8] text-[#7a6420]",
  booked: "bg-sage-band text-olive-deep",
  completed: "bg-olive-deep text-cream",
  passed: "bg-blush text-rose",
};

/** Sort weight: the ones needing a decision float up, settled ones sink. */
export const VENDOR_STATUS_RANK: Record<VendorStatus, number> = {
  quoted: 0, contacted: 1, researching: 2, booked: 3, completed: 4, passed: 5,
};
```

Badge span classes are the household-detail ones verbatim:
`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.05em] uppercase ${VENDOR_STATUS_BADGE[s]}`
(phone cards use `text-[10.5px]`, matching `GuestList`).

#### 2.4 Desktop table — seven columns

Wrapper `overflow-hidden rounded-xl border border-hairline max-md:hidden`; header row
`border-b border-hairline bg-paper text-[11px] font-semibold tracking-[0.08em] text-[#6b7167]`;
body rows `border-b border-[#f1f0ea] last:border-0 hover:bg-paper/60`; cells `px-4 py-3.5`.

| # | Header | Content |
| --- | --- | --- |
| 1 | `VENDOR` | `<Link href={/admin/vendors/${v.id}}>` name, `font-semibold text-[13.5px] text-ink hover:text-rose`; second line `text-[12px] text-muted` = `[company, ownerLabel].filter(Boolean).join(" · ")` where `ownerLabel` is `Juliet` / `Juan` / `Juliet & Juan`. |
| 2 | `ROLE` | `v.category`, `text-[13px] text-[#4a5147]`. |
| 3 | `STATUS` | Badge from §2.3. |
| 4 | `PRICE` | `formatMoney(v.contracted_cents ?? v.quoted_cents ?? v.estimated_cents)` right-aligned tabular. When the value did not come from `contracted_cents`, prefix a `text-[10.5px] uppercase tracking-[0.05em] text-muted` marker — `quote` or `est.` — so a guess never reads as a commitment. Null → `—` in `text-muted`. |
| 5 | `ALISON` | The linked budget item's `benchmark_cents` as `formatMoney`, with the delta beneath in `text-[11.5px]`: over → `text-rose` `+$4,200`, under → `text-olive` `−$1,100`, equal → `text-muted` `same`. Unlinked or no benchmark → `—`. This is the signature column; it does not get dropped when the table is tight. |
| 6 | `NEXT PAYMENT` | Soonest unpaid payment across the linked items: `Deposit · Aug 15` using `formatCalendarDate` truncated to `{ month:"short", day:"numeric" }`, plus a countdown in `text-[11.5px] text-muted` from `signedDaysUntilCalendarDate` (`in 12 days` / `tomorrow` / `today` / `9 days overdue`). Overdue renders the whole cell `text-rose font-medium`. None → `—`. |
| 7 | *(blank)* | `text-right`; `{canEdit && <ConfirmButton label="Remove" confirmLabel="Remove vendor?" action={removeVendor.bind(null, v.id)} />}` — the exact `ConfirmButton` from `components/admin/ConfirmButton.tsx`, default `subtle` variant, as `GuestList` uses it. |

Rows for `passed` vendors get `opacity-60` on the `<tr>` (§5).

#### 2.5 Sort

Sort is presentational, so unlike the filter it is client state inside `VendorList` — no server
round-trip. Three buttons above the table, styled as the filter chips but rendered as `<button>` with
`aria-pressed`:

- **By role** (default) — `DEFAULT_VENDOR_ROLES` order first, then any custom role alphabetically;
  within a role by `VENDOR_STATUS_RANK`, then `name` via `localeCompare`.
- **By price** — effective price (contracted ?? quoted ?? estimated) descending, nulls last.
- **By name** — `localeCompare`, case-insensitive.

In every mode `passed` vendors sort to the bottom of their group. The comparator is a pure exported
function `sortVendors(rows, mode)` in `lib/data/vendor-rules.ts` so it is unit-tested.

#### 2.6 Live search

`useMemo` over a `matchesVendorQuery(query, row)` pure function in `lib/data/vendor-rules.ts`
(mirroring `lib/search/guest-query.ts`): case-insensitive substring across `name`, `company`,
`category`, `contact_name`, `email`, `phone`, `notes`. Input classes verbatim from `GuestList`:
`w-full max-w-[340px] rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive max-md:max-w-none`.
Debounced 250ms URL sync via `window.history.replaceState` to `/admin/vendors?...`, preserving the
active `filter` chip exactly as `GuestList` preserves it. Count line above the input, `plural()` style:
`18 vendors · 9 of 19 roles filled`.

#### 2.7 Phone card list — required

`flex flex-col gap-2 md:hidden`, one `<Link>` per vendor,
`flex items-center gap-3 rounded-xl border border-hairline bg-white/70 px-4 py-3.5 active:bg-paper`:
truncated name (`text-[14px] font-semibold text-ink`), second line
`text-[12.5px] text-[#4a5147]` = `${category} · ${priceLabel}`, right-hand status badge at
`text-[10.5px]`. If a payment is overdue, a `h-2 w-2 rounded-full bg-rose` dot precedes the name.

#### 2.8 Empty states

- **No vendors at all** → the table and phone list are not rendered; `VendorRoleStrip` becomes the
  whole page body (§3).
- **Filter or search excludes everything** → the guests-page pattern, `colSpan={7}`,
  `px-4 py-10 text-center text-[13px] text-muted`, copy in §8.

---

### 3. "Build your wedding team" — roles as slots

The Knot's 88% engagement lift came from showing the *shape of the team* before showing a list. Here
that is one component, `VendorRoleStrip`, which is the empty state and stays on the page forever
after — it never becomes a separate feature or a separate route.

#### 3.1 Where roles come from

Roles are **not** a table. Pigeon-holing is on the AVOID list, and a new table would make "add a role"
a schema problem. Instead:

- `lib/domain/vendor-roles.ts` exports `DEFAULT_VENDOR_ROLES: ReadonlyArray<{ name: string; essential: boolean; budgetCategory: string }>`.
- The live role set is `roleSlots(DEFAULT_VENDOR_ROLES, vendors)` = the defaults, unioned with every
  distinct `vendors.category` already in use, in default order then alphabetical for the strays.
- Typing a brand-new role name into `NewVendorForm`'s role field creates that role implicitly. The
  field is a text `<input>` with a `<datalist>` of the current role set — free text, suggestions on
  tap, no `<select>` that boxes her in.

#### 3.2 The default role set (19), mapped to the seed CSV's categories

Essential (always visible, 10): **Venue** (Venue) · **Catering** (Food and Beverage) ·
**Bar & Beverage** (Food and Beverage) · **Cake & Desserts** (Food and Beverage) ·
**Photographer** (Music + Photography) · **Videographer** (Music + Photography) ·
**DJ** (Music + Photography) · **Florist & Decor** (Flowers + Decor) ·
**Hair & Makeup** (Attire + Beauty) · **Planner / Coordinator** (Misc).

Optional (behind the expander, 9): **Live music** (Music + Photography) ·
**Lion dance** (Other Vendors) · **Late-night food trucks** (Food and Beverage) ·
**Rentals & Linens** (Venue) · **Attire & Alterations** (Attire + Beauty) · **Officiant** (Misc) ·
**Transportation & Shuttle** (Misc) · **Stationery & Printing** (Printing) ·
**Hotel block** (Hotels).

`budgetCategory` is a hint only: it pre-selects the category when a vendor is linked to a new budget
item. It is never enforced.

#### 3.3 Slot states

`roleSlots` returns `RoleSlot = { name: string; essential: boolean; budgetCategory: string; vendors: VendorListRow[]; state: "filled" | "deciding" | "empty" }`:

- `filled` — ≥1 vendor with status `booked` or `completed`.
- `deciding` — ≥1 vendor, none booked (i.e. researching / contacted / quoted / passed only).
- `empty` — no vendors at all, or every vendor in the role is `passed`.

A role becomes filled the instant a vendor in it is set to `booked` — on the profile page, from the
list, or from the compare view's "Book this one". There is no separate "fill this role" action.

#### 3.4 Rendering

Container `rounded-xl border border-hairline p-5`. Heading row: `h2` `text-[14.5px] font-semibold text-ink`
= **Your wedding team**, then a muted count `font-normal text-muted` = `· 9 of 19 roles filled`, then a
right-aligned progress bar `h-1.5 w-[120px] rounded-full bg-[#f0efe3]` with an inner
`block h-1.5 rounded-full bg-olive transition-[width] duration-700` — the identical bar idiom used in
`app/admin/(dashboard)/meals/page.tsx` and the Overview meal counts.

Slots: `grid grid-cols-5 gap-2.5 max-lg:grid-cols-3 max-md:grid-cols-2`. Each slot is a tile,
`rounded-[10px] border px-3.5 py-3 text-left`:

| State | Tile classes | Content |
| --- | --- | --- |
| `filled` | `border-hairline bg-sage-band/50` | Role name `text-[13px] font-semibold text-olive-deep`; below, the booked vendor's name `text-[12px] text-[#4a5147] truncate`; wraps `<Link>` to that vendor. |
| `deciding` | `border-[#dddbd0] bg-white` | Role name `text-[13px] font-medium text-ink`; below, `text-[12px] text-[#7a6420]` = `2 quotes in` / `1 being researched`; wraps `<Link href={/admin/vendors?filter=all&q=<role>}>`, or `/admin/vendors/compare?category=<role>` when the role holds 2+ non-passed vendors. |
| `empty` | `border-dashed border-[#dddbd0] bg-transparent hover:border-rose hover:text-rose` | Role name `text-[13px] font-medium text-[#6b7167]`; below, `text-[12px] text-muted` = `Not started`. Rendered as a `<button>` that opens `NewVendorForm` pre-filled with this role. Viewers get a non-interactive `<div>`. |

Below the grid, when any optional role is hidden: a text button
`text-[12.5px] font-medium text-olive hover:text-rose` reading `+ 9 more roles` / `Show fewer roles`.
Optional roles that already hold a vendor are always shown regardless of the expander.

#### 3.5 As the empty state

When the wedding has zero vendors, `app/admin/(dashboard)/vendors/page.tsx` renders header +
`VendorRoleStrip` only — no summary cards, no chips, no table, no `UpcomingPayments`. The strip's
subtitle becomes the welcome copy (§8) and all ten essential slots render `empty`, so the first thing
Juliet sees is ten dashed tiles asking to be filled, not a blank table.

---

### 4. Vendor profile page — `app/admin/(dashboard)/vendors/[vendorId]/page.tsx`

Copy `app/admin/(dashboard)/guests/[householdId]/page.tsx` for layout and rhythm: `params` is a
`Promise`, `notFound()` on a failed fetch, breadcrumb, title row with badge and right-aligned
actions, then `flex items-start gap-4 max-md:flex-col` with a `flex-[1.6]` left column and a `flex-1`
right column.

#### 4.1 Header

- Breadcrumb `text-[12.5px] font-medium text-muted`: `<Link href="/admin/vendors" className="hover:text-rose">Vendors</Link> / {vendor.name}`.
- `flex items-center gap-3.5 max-md:flex-wrap max-md:gap-2`: `h1` `text-[22px] font-semibold text-ink`,
  the status badge, a priority chip when `priority === "must_have"`
  (`rounded-full bg-blush px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-rose` = `Must have`),
  an amber `Out of sync with budget` chip when §4.3 case B is unresolved
  (`bg-[#f3edd8] text-[#7a6420]`), spacer, then `Compare quotes` secondary `<Link>` to
  `/admin/vendors/compare?category=<category>` — rendered only when the role holds 2+ vendors.
- Subtitle `mt-1 text-[13.5px] text-[#6b7167]`: `[company, category, ownerLabel, phone, email].filter(Boolean).join(" · ")`,
  the same joined-facts line the household page uses.

#### 4.2 Left column — the three groups the client named

Each group is its own `rounded-xl border border-hairline p-5` card with an `h2`
`text-[14.5px] font-semibold text-ink`, its own `<form>`, its own `useActionState`, and its own Save
button. Three small saves beat one giant one for a non-technical user, and it keeps the sync warning
(§4.3) attached to the group that caused it.

Shared field markup: label `block text-[12px] font-medium text-[#6b7167] mb-1`; input/textarea
`w-full rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive`;
two-column layout `grid grid-cols-2 gap-3 max-md:grid-cols-1`; Save = the house primary button.

**General** — `VendorGeneralForm.tsx`
| Field | Control | Column |
| --- | --- | --- |
| Vendor name | text, required | `vendors.name` |
| Role | text + `<datalist>` of the live role set | `vendors.category` |
| Status | `<select>` of the six, labels from `VENDOR_STATUS_LABEL` | `vendors.status` |
| Priority | three radio pills (`Must have` / `Nice to have` / `Optional`) | `vendors.priority` |
| Who's handling this | three radio pills (`Juliet` / `Juan` / `Both of us`) | `vendors.assigned_to` = `juliet|juan|both` |
| Notes | `<textarea rows={4}>` | `vendors.notes` |

**Contact** — `VendorContactForm.tsx`: Primary contact (`contact_name`), Company (`company`),
Phone (`phone`, `type="tel"`), Email (`email`, `type="email"`), Website (`website`, `type="url"`),
Instagram (`instagram`, stored without the `@`, displayed with it), Business address
(`address`, `<textarea rows={2}>`). Phone/email/website/Instagram render as live `<a>` links above the
inputs when set — `text-[12.5px] font-medium text-olive hover:text-rose` — so Juliet can call from her
phone without editing anything. Instagram href is `https://instagram.com/${handle}`.

**Financial** — `VendorFinancialForm.tsx`. This is where the client's list must be split, and the split
is deliberate:

*Editable here (columns on `vendors`):*
| Client's field | Column | Notes |
| --- | --- | --- |
| Estimated | `estimated_cents` | `parseMoneyInput`; blank → null |
| Quoted | `quoted_cents` | |
| Negotiated / Final contract price | `contracted_cents` | **One column, not two.** Storing "negotiated" and "final contract price" separately gives two numbers that mean the same thing and drift apart — exactly what decision 4 forbids. The field is labelled `Final contract price` and helper text says `This is the number you shook hands on — update it if you renegotiate.` |
| Currency | `currency` | Read-only `USD` chip beside the money fields. It becomes an editable `<select>` only if any vendor in the wedding has a non-USD currency; see §8 for the mixed-currency notice. No FX conversion anywhere. |

The three numbers render **adjacent, in one row**, with the linked item's `benchmark_cents` as a
fourth read-only cell to their right labelled `Alison paid` — Zola A/B-tested adjacency against a
toggle and adjacency won. Never behind a tab, never behind an expander.

*Not editable here (derived — rendered read-only in `VendorPaymentsPanel`):*
Deposit amount, deposit paid, remaining balance, payment status (unpaid / partial / paid), payment
due dates, payment method. All of these are `budget_payments` rows, and payment status is derived per
decision 5. A second copy on `vendors` would be a drift factory. The Financial card shows them as a
compact read-only summary line and links out: `Deposit $2,000 paid Aug 3 · $3,400 balance due Nov 1`
plus `Manage payments →` to the budget item.

*The one exception — `VendorDepositSetup.tsx`.* When a vendor is linked to exactly one budget item and
that item has **no payments at all**, the Financial card shows an inline sub-form: `Total` (pre-filled
from the contract price, read-only), `Deposit` (money input), `Deposit due` (date), `Balance due`
(date). Submitting creates exactly two `budget_payments` rows — the deposit (`is_deposit = true`) and
the balance, whose `amount_cents` is **computed** as total − deposit and shown live as she types.
Aisle Planner's rule, adopted verbatim: never make the user subtract. After those rows exist the
sub-form disappears for good and payments are managed on the budget item.

#### 4.3 The sync rule — vendor price → budget item (decision 6)

One direction only: the vendor's contract price can update the linked budget item's
`contracted_cents`. Nothing on the budget side ever writes back to `vendors`.

`updateVendorFinancials` in `app/admin/(dashboard)/vendors/actions.ts` returns

```ts
type VendorFinancialState = {
  ok: boolean;
  message?: string;
  sync?: {
    budgetItemId: string;
    itemName: string;
    fromCents: number | null;
    toCents: number;
    applied: boolean;        // true = already written
    requiresConfirm: boolean; // true = a human typed the budget number; we did not touch it
  };
};
```

Behaviour:

- **No linked item, or 2+ linked items** → no sync at all. With 2+ items the Financial card renders a
  muted note naming them and no sync happens, because the app cannot know which one she meant.
- **Case A — safe** (`item.contracted_cents` is `null`, **or** equals the vendor's *previous*
  `contracted_cents`): apply the write in the same action, `applied: true`. On return the card renders a
  sage confirmation banner `rounded-[10px] bg-sage-band px-3.5 py-3 text-[12.5px] font-medium text-olive-deep`
  naming both numbers (copy in §8). Log `vendor.price_synced_to_budget`.
- **Case B — a human typed it** (`item.contracted_cents` is set and differs from the vendor's previous
  value): **write nothing.** Return `requiresConfirm: true`. The card renders an amber reconcile panel
  `rounded-[10px] bg-[#f3edd8] px-3.5 py-3 text-[12.5px] text-[#7a6420]` showing both numbers side by
  side and two buttons: primary `Update the budget to $5,400` (calls `applyVendorPriceToBudgetItem(vendorId, budgetItemId)`,
  logs `vendor.price_synced_to_budget`) and secondary `Leave the budget as it is` (dismisses, logs
  `vendor.price_sync_declined`). Until one is chosen, the vendor carries the amber
  `Out of sync with budget` chip in the header **and** in the list's VENDOR cell.

The vendor's own save always succeeds regardless of which case fires — the sync is a second,
separately-announced act, never a silent side effect of the first.

#### 4.4 Right column

1. `VendorBudgetLink.tsx` — `rounded-xl border border-hairline p-5`, `h2` = **Budget**. Linked: item
   name as a `<Link>`, then a four-cell read-only row `Alison / Estimated / Quoted / Contract` in the
   same adjacent style as §4.2, plus a `ConfirmButton label="Unlink" confirmLabel="Unlink from budget?"`.
   Unlinked: a `<select>` of unlinked budget items in this vendor's `budgetCategory` first, then all
   others, and a `Link to budget` primary button. Also a secondary `Create a budget line for this vendor`
   which calls an action creating an item named after the vendor in the mapped category with
   `contracted_cents` seeded from the vendor.
2. `VendorPaymentsPanel.tsx` — `h2` = **Payments**. One row per payment across all linked items:
   left `label` + `text-[12px] text-muted` due line (`Due Nov 1 · in 12 days` / `9 days overdue` in
   `text-rose`), right `formatMoney(amount_cents)` with a paid tick
   (`bg-sage-band text-olive-deep` pill reading `Paid Aug 3`) or an unpaid pill
   (`bg-[#f1f0ea] text-[#6b7167]` reading `Unpaid`). Footer line: derived payment status —
   `Paid in full` / `$2,000 of $5,400 paid` / `Nothing paid yet`. Empty → the deposit sub-form's
   invitation instead.
3. `VendorContractCard.tsx` — `h2` = **Contract**. `contract_signed_at` date input and `contract_url`
   text input (paste a Drive/Dropbox link; file upload to Vercel Blob is explicitly **out of scope for
   this section** — do not build an uploader here). When `status === "booked"` and
   `contract_signed_at` is null, the card shows the blush nudge used on Overview:
   `flex items-center gap-2 rounded-[10px] bg-blush px-3.5 py-3` + `h-2 w-2 rounded-full bg-rose` +
   `text-[12.5px] font-medium text-rose-deep` copy from §8.
4. Activity — copy the household page's Activity card verbatim, including its `timeAgo` helper
   (lift `timeAgo` into `lib/format/relative-time.ts` with a test rather than copy-pasting it a second
   time, and update the household page's import in the same commit). Feeds from
   `activity.log` entries whose payload carries this `vendorId`. Actions logged by this section:
   `vendor.created`, `vendor.updated`, `vendor.status_changed`, `vendor.deleted`,
   `vendor.linked_budget_item`, `vendor.unlinked_budget_item`, `vendor.price_synced_to_budget`,
   `vendor.price_sync_declined`, `vendor.contract_recorded`, `vendor.deposit_scheduled`.

---

### 5. Quote comparison — `app/admin/(dashboard)/vendors/compare/page.tsx`

Three photographers side by side, which is the single thing couples keep a spreadsheet open for.

**Entry points:** the `Compare quotes` header link on the vendors page; a `deciding` role tile with
2+ non-passed vendors; the `Compare quotes` button on a vendor profile.

**No `?category=`** → a picker: `h1` **Compare quotes**, then one `rounded-xl border border-hairline p-5`
row per role holding 2+ vendors — role name, `3 vendors · 2 quotes in`, and a `Compare` secondary
button. Roles with fewer than 2 vendors are listed at the bottom, muted, non-clickable, under the line
`Roles with only one vendor so far`.

**With `?category=Photographer`** → `VendorCompare.tsx`:

- Outer `overflow-x-auto` wrapper (never let the page body scroll sideways); inner grid
  `grid min-w-max grid-flow-col auto-cols-[minmax(220px,1fr)] gap-3`, plus a sticky first column of row
  labels `w-[150px] text-[12px] font-medium text-[#6b7167]`.
- One column per vendor, each a `rounded-xl border border-hairline p-4`; the booked vendor's column
  gets `border-olive bg-sage-band/40`.
- **Rows, top to bottom:** vendor name (`<Link>`, `text-[14px] font-semibold text-ink`) · status badge ·
  `Estimated` · `Quoted` · `Contract price` · `vs Alison` (delta chip, same colour rules as the list's
  ALISON column) · `Deposit` (from the linked item's `is_deposit` payment, or `—`) ·
  `Next payment` · `Contact` (name + phone) · `Website` / `Instagram` as links · `Notes`
  (`line-clamp-4 text-[12.5px] text-[#4a5147]`).
- Money rows render right-aligned; the **lowest** contract price in the row gets
  `text-olive-deep font-semibold` and a `text-[11px] text-olive` caption `lowest`. Never say "best" —
  cheapest is not best and the app must not imply it.
- **Action row (last):** for a non-booked, non-passed vendor — primary `Book this one` (sets `booked`,
  logs `vendor.status_changed`, `revalidatePath("/admin/vendors")`) and a `ConfirmButton` `Pass`
  (`confirmLabel="Pass on them?"`, sets `passed`). Booked vendor → `Booked` state text plus a
  secondary `Undo booking` returning it to `quoted`. Passed vendor → a single secondary `Reconsider`
  returning it to `quoted`.
- Max 4 columns fit at desktop width; a fifth simply scrolls. Do not paginate, do not hide.

**Passed vendors are retained and de-emphasised, everywhere and consistently:**
they stay in the database and in every view; their compare column sorts last and renders with
`opacity-60`; their table row renders with `opacity-60` and sorts to the bottom of its group; their role
tile does not count toward `filled`; a role whose only vendors are `passed` still reads `empty` so it
comes back as a slot to fill. Never strikethrough a name — she may go back to them, and the app
should not editorialise. There is a dedicated `Passed` filter chip so the shortlist history is one
click away.

---

### 6. The vendor dashboard strip — four cards, seven demotions

Eleven numbers is a wall. `VendorSummaryCards.tsx` renders **four**, in the house metric grid
(`grid grid-cols-4 gap-4 max-md:grid-cols-2 max-md:gap-2.5`, card
`flex flex-col gap-2 rounded-[14px] border border-hairline p-5 max-md:p-4`, label
`text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]`, value `text-[34px] font-semibold leading-none`,
accent `text-[13px] font-medium text-olive`, sub `text-[12.5px] text-muted`) — the exact shape of
`components/admin/MetricCards.tsx`.

**Selection rule: a card must imply an action.** Four survive.

| Card | Value | Accent | Sub | Rose? |
| --- | --- | --- | --- | --- |
| `BOOKED` | `rolesFilled` | `of ${rolesTotal} roles` | `${empty} roles still empty` | no |
| `AWAITING CONTRACT` | `contractsOutstanding` | `booked, nothing signed` | `${signed} contracts on file` | yes when > 0 |
| `AWAITING DEPOSIT` | `awaitingDeposit` | `deposits not yet paid` | soonest deposit: `Deposit due Sep 12` or `Nothing scheduled` | yes when > 0 |
| `VENDOR SPEND` | `formatMoney(vendorSpendCents)` | `of ${formatMoney(vendorContractedCents)} committed` | `Alison paid ${formatMoney(benchmarkForBookedRoles)}` | no |

Definitions, all computed by pure functions in `lib/data/vendor-rules.ts`:
- `contractsOutstanding` = vendors where `status = 'booked'` and `contract_signed_at is null`.
- `awaitingDeposit` = vendors where `status = 'booked'` and (a linked item has an unpaid
  `is_deposit` payment) **or** (linked items exist and have zero paid payments).
- `vendorSpendCents` = Σ `amount_cents` of `paid = true` payments on items whose `vendor_id` is set.
- `vendorContractedCents` = Σ `contracted_cents` of vendors with status `booked` or `completed`.

**Demoted, and where each one went:**
- *Total Vendors* → the count line above the search box (`18 vendors · 9 of 19 roles filled`), the way
  `GuestList` states its totals.
- *Pending*, *Researching*, *Completed*, *Passed* → counts appended to their own filter chips (§2.2),
  where the number is also the control that acts on it.
- *Final Payment Due* and *Upcoming Payment Deadlines* → collapsed into one `UpcomingPayments` list
  below the table (max 5 rows, soonest first, overdue pinned to the top in rose). A date with a name
  beats a count.
- *Upcoming Vendor Tasks* → not rendered on the vendors page at all until `vendor_tasks` exists. A card
  that always reads `0` teaches Juliet to ignore that corner of the screen.

---

### 7. The Overview page — `app/admin/(dashboard)/page.tsx`

#### 7.1 Final layout

The client listed ten cards; four of them are already on screen or belong elsewhere. The page becomes
two labelled four-card rows plus two panels, not fourteen boxes. Small eyebrow headings
(`text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7167]`) separate the rows so the page
reads as three thoughts rather than one wall.

```
1  header row (h1 "Overview", Export, Send reminders)      — unchanged
2  <CountdownRibbon />                                      — NEW, full width
3  eyebrow "The guest list"  +  <MetricCards m={m} />       — existing 4 cards, untouched
4  eyebrow "The money"       +  <MoneyCards mv={mv} />      — NEW 4 cards
5  <WeddingTeamPanel /> | <UpcomingPayments limit={5} />    — NEW, flex items-start gap-4 max-md:flex-col, flex-1 each
6  Recent RSVPs | Meal counts                               — unchanged
```

**Two of the requested cards already exist — do not duplicate them.** *Total Guests Invited* is the
accent line of the existing `GUESTS ATTENDING` card (`of 200 invited`); *RSVP %* is the existing
`RSVP COMPLETION` card. Adding them again would be the wall of numbers the client is trying to avoid.
The eyebrow heading is the only change to that row.

**Days until wedding** is the ribbon, not a card. It is the one number on the page that is not a
metric, and the sidebar's `dateLabel` already carries a quiet version — the ribbon earns its space by
pairing the countdown with the two dates that matter (`weddings.wedding_date` and
`weddings.rsvp_deadline`) rather than restating the sidebar. Do not remove or change the sidebar's
`dateLabel`.

`CountdownRibbon.tsx` (server component): `rounded-xl border border-hairline bg-sage-band/60 px-5 py-4 flex items-center gap-5 max-md:flex-col max-md:items-start max-md:gap-2`.
Left: `text-[34px] font-semibold leading-none text-olive-deep` number + `text-[13.5px] font-medium text-olive`
label. Middle: `text-[13.5px] text-[#4a5147]` long date. Right (`ml-auto`, `text-[12.5px] text-[#6b7167]`):
the RSVP-deadline line, omitted when `rsvp_deadline` is null. If `wedding_date` is null the component
returns `null` — no placeholder, no broken maths.

**Contracts Outstanding**, **Vendors Pending** and **Tasks Due This Week** are demoted from cards into
`WeddingTeamPanel`, because each is a to-do rather than a status and each needs a destination to click:

`WeddingTeamPanel.tsx` — `rounded-xl border border-hairline p-5`. Heading row: `h2` **Your wedding team**
+ right-aligned `View vendors` `<Link>` (`text-[12.5px] font-medium text-olive hover:text-rose`).
Then `grid grid-cols-3 gap-3`, each cell value `text-[22px] font-semibold text-ink` (rose when the
number is an outstanding item > 0) over label `text-[12px] text-[#6b7167]`: **Booked** / **Still deciding** /
**Contracts outstanding** — each cell wrapped in a `<Link>` to the matching filter chip
(`/admin/vendors?filter=booked`, `?filter=quoted`, `?filter=booked` for now). Then the roles bar
(`h-1.5 rounded-full bg-[#f0efe3]` + `bg-olive` fill) with the caption `9 of 19 roles filled`. Then the
tasks line at the bottom, `text-[12.5px]`.

`UpcomingPayments.tsx` — `rounded-xl border border-hairline p-5`, `h2` **Coming up** + right-aligned
`View budget` `<Link>`. Up to `limit` rows, soonest `due_date` first with overdue pinned above
everything: each row `flex items-center gap-3 py-2.5 border-b border-[#f1f0ea] last:border-0` — left
`text-[13px] font-medium text-ink` payment label with `text-[12px] text-muted` second line
`${vendorName ?? itemName} · ${formatCalendarDate(due)} · ${relative}`, right
`text-[13.5px] font-semibold text-ink` amount. Overdue rows: a leading `h-2 w-2 rounded-full bg-rose`
and `text-rose-deep` on the second line.

#### 7.2 `metrics.moneyAndVendors(scope)`

Added to `lib/data/metrics.ts`, alongside `overview`, same shape: parallel scoped selects → one pure
reducer → `cache(...)`. All arithmetic lives in `lib/data/vendor-rules.ts` and (for the budget totals)
`lib/data/budget-rules.ts`; `metrics.ts` itself stays I/O-only.

```ts
export async function moneyAndVendors(scope: WeddingScope, now: Date = new Date()): Promise<MoneyVendorMetrics>
```

It reads `weddings.timezone` and `weddings.wedding_date` itself and returns them, so the Overview page
keeps a single `Promise.all` and never has to await the wedding row first. Cache key
`` `metrics:${scope.weddingId}:money:${monthKey}` `` where `monthKey` is `calendarMonthBounds(now, timeZone).start`
— including the month means a rollover at the venue's midnight cannot serve a stale
"due this month". TTL 60s, matching `overview`.

Every vendor, budget-item and payment mutation must call `invalidateCache(\`metrics:${scope.weddingId}\`)`
(prefix match — it also clears `:overview`, which is correct and cheap).

`MoneyVendorMetrics`, added under `OverviewMetrics` at the bottom of `lib/types.ts`:

```ts
export type MoneyVendorMetrics = {
  timeZone: string;
  weddingDate: string | null;      // raw `date` string — NEVER pass to new Date()
  rsvpDeadline: string | null;     // timestamptz ISO
  spentCents: number;
  forecastCents: number;
  remainingCents: number;          // may be negative
  benchmarkTotalCents: number;
  committedUnpaidCents: number;
  dueThisMonthCents: number;
  dueThisMonthCount: number;
  overdueCents: number;
  overdueCount: number;
  vendorsBooked: number;
  vendorsPending: number;
  vendorsPassed: number;
  rolesTotal: number;
  rolesFilled: number;
  contractsOutstanding: number;
  contractsSigned: number;
  awaitingDeposit: number;
  nextDepositDue: string | null;   // `date`
  vendorSpendCents: number;
  vendorContractedCents: number;
  upcoming: Array<{
    paymentId: string; budgetItemId: string; label: string;
    vendorName: string | null; itemName: string;
    amountCents: number; dueDate: string | null; overdue: boolean;
  }>;
  tasksDueThisWeek: number | null; // null until `vendor_tasks` exists
};
```

#### 7.3 Exact definition of every number

| Number | Definition |
| --- | --- |
| **Days until wedding** | `daysUntilCalendarDate(mv.weddingDate, new Date(), mv.timeZone)`. `weddingDate` is a Postgres `date`; it must never be handed to `new Date()`. The helper floors at 0, which is right here: on the day it reads 0 → "Today is the day." For a past date use `signedDaysUntilCalendarDate` to render the married-already copy. |
| **Budget Spent** | Σ `budget_payments.amount_cents` where `paid = true`, all items in the wedding. Derived from payments only — never a stored `actual` column (decision 4). |
| **Budget Remaining** | `forecastCents − spentCents`, where `forecastCents` = Σ per item of `coalesce(contracted_cents, quoted_cents, estimated_cents, 0)`. May go negative; do not clamp — render the absolute value in rose with the "over your plan" accent. |
| **Alison benchmark** | Σ `budget_items.benchmark_cents`. Shown as the sub of Budget Spent, never as its own card. |
| **Payments Due This Month** | Σ `amount_cents` of payments with `paid = false` and `due_date` inside `calendarMonthBounds(now, timeZone)`, compared as `YYYY-MM-DD` strings — **string comparison on calendar days, no `Date` objects.** |
| **Overdue** | `paid = false` and `due_date < todayAt(timeZone)`, same string comparison. |
| **Total Guests Invited** | `m.guestsInvited` — already rendered by `MetricCards`. Not re-added. |
| **RSVP %** | `m.completionPct` — already rendered by `MetricCards`. Not re-added. |
| **Vendors Booked** | `status in ('booked','completed')`. `completed` counts as booked: a finished vendor is not an open slot. |
| **Vendors Pending** | `status in ('researching','contacted','quoted')`. `passed` is excluded. |
| **Contracts Outstanding** | `status = 'booked' and contract_signed_at is null`. `completed` is excluded — chasing paperwork for a finished vendor is noise. |
| **Tasks Due This Week** | `null` until `vendor_tasks` exists; then the count of incomplete tasks whose `due_date` falls in the next 7 calendar days at `timeZone`. |

#### 7.4 The three new date helpers in `lib/format/wedding-date.ts`

Add to the existing file (which already has the private `calendarDayAt`), each with tests in
`lib/format/wedding-date.test.ts`:

- `formatCalendarDateLong(date: string | null): string | null` — `"2027-06-12"` → `"Saturday, June 12, 2027"`,
  via `Intl.DateTimeFormat("en-US", { weekday:"long", dateStyle:… })` with `timeZone: "UTC"`.
- `signedDaysUntilCalendarDate(date: string, now: Date, timeZone: string): number` — identical maths to
  `daysUntilCalendarDate` **without the `Math.max(0, …)` floor**. Payment due dates need negatives to
  say "9 days overdue". Document in a comment that `daysUntilCalendarDate` must not be used for
  payments, because its floor silently turns every overdue payment into "due today".
- `calendarMonthBounds(now: Date, timeZone: string): { start: string; end: string }` — first and last
  calendar day of the current month at the venue, as `YYYY-MM-DD`. Tests must cover a UTC-vs-venue
  month boundary (e.g. `2026-08-01T04:00:00Z` in `America/Los_Angeles` is still July 31).

#### 7.5 Overview page mechanics

Add `metrics.moneyAndVendors(scope)` to the existing `Promise.all` in
`app/admin/(dashboard)/page.tsx`. Do not add a second sequential await. `MoneyCards` is a client
component fed a fully serialised `MoneyVendorMetrics` — no `Date` objects, no functions cross the
boundary; every string is pre-formatted on the server where it depends on `timeZone`.
`WeddingTeamPanel`, `UpcomingPayments` and `CountdownRibbon` are plain server components (no
`"use client"`).

**Graceful degradation is mandatory for the loop's intermediate states.** If the `vendors` /
`budget_*` tables do not exist yet, `moneyAndVendors` returns a zeroed `MoneyVendorMetrics` rather than
throwing, and the Overview page must still render. The Overview must never be the thing that breaks
mid-milestone.

---

### 8. Copy deck

Warm and editorial. Nothing here says "record", "entity", "N/A", "0 items", or "Manage your vendors".

> **JSX whitespace warning.** Any of these strings that spans more than one line in JSX loses the
> space at the line break. Build every multi-line sentence as a single template literal in a `const`
> above the return, or use an explicit `{" "}`. Every string below marked **[multi-line]** is one that
> will be tempting to wrap and must be built as a variable. This bug has shipped in this codebase
> before; the existing `<>No one matches “{query.trim()}”.</>` fragments in `GuestList.tsx` are the
> pattern to imitate when interpolation is needed on one line.

**Navigation & page furniture**
- Nav label: `Vendors`
- Vendors `h1`: `Vendors`
- Vendors subtitle **[multi-line]**: `` `${booked} booked · ${pending} still deciding · ${empty} roles yet to fill` ``
- Header buttons: `Compare quotes` · `Add a vendor`
- Count line **[multi-line]**: `` `${plural(n,"vendor")} · ${filled} of ${total} roles filled` ``
- Search placeholder: `Search by name, company, role, phone…`
- Sort buttons: `By role` · `By price` · `By name`

**The team strip**
- Heading: `Your wedding team`
- Heading count: `· 9 of 19 roles filled`
- Expander: `+ 9 more roles` / `Show fewer roles`
- Empty slot sub-label: `Not started`
- Deciding slot sub-label **[multi-line]**: `` `${plural(n,"quote")} in` `` / `` `${plural(n,"name")} on the shortlist` ``
- First-run strip subtitle **[multi-line]**: `Let's build your team. Start anywhere — the venue is usually the one that decides the rest.`
- First-run heading: `No vendors yet`

**Empty & zero states**
- Filtered table empty: `No vendors with that status yet.`
- Searched table empty: `<>No vendors match “{query.trim()}”.</>`
- Payments empty on a vendor: `No payments scheduled yet.`
- `UpcomingPayments` empty: `Nothing due yet. Enjoy it while it lasts.`
- Compare picker, thin roles: `Roles with only one vendor so far`

**Vendor profile**
- Group headings: `General` · `Contact` · `Financial` · `Budget` · `Payments` · `Contract` · `Activity`
- Field labels: `Vendor name` · `Role` · `Status` · `Priority` · `Who's handling this` · `Notes` ·
  `Primary contact` · `Company` · `Phone` · `Email` · `Website` · `Instagram` · `Business address` ·
  `Estimated` · `Quoted` · `Final contract price` · `Alison paid`
- Priority pills: `Must have` · `Nice to have` · `Optional`
- Owner pills: `Juliet` · `Juan` · `Both of us`
- Contract price helper **[multi-line]**: `This is the number you shook hands on — update it if you renegotiate.`
- Save buttons: `Save details` · `Save contact` · `Save numbers`
- Derived-payments note **[multi-line]**: `Deposits and due dates live with the budget line, so there's only ever one version of them.`
- Payment summary variants: `Paid in full` · `` `${formatMoney(paid)} of ${formatMoney(total)} paid` `` · `Nothing paid yet`
- Booked-without-contract nudge **[multi-line]**: `` `${vendor.name} is booked but there's no signed contract on file yet.` ``
- Unlink confirm: `Unlink` → `Unlink from budget?`
- Remove confirm: `Remove` → `Remove vendor?`

**Deposit setup**
- Heading: `Set up the deposit`
- Intro **[multi-line]**: `Enter what you're putting down and we'll work out the balance.`
- Labels: `Total` · `Deposit` · `Deposit due` · `Balance due`
- Live computed line **[multi-line]**: `` `Balance of ${formatMoney(total - deposit)} due ${formatCalendarDate(balanceDue)}` ``
- Button: `Schedule both payments`

**The sync notices (decision 6 — this copy is the feature)**
- Case A banner **[multi-line]**: `` `Saved. ${itemName} in your budget moved from ${formatMoney(from)} to ${formatMoney(to)} to match.` ``
- Case A, item had no number **[multi-line]**: `` `Saved. ${itemName} in your budget now shows ${formatMoney(to)}.` ``
- Case B heading: `Your budget says something different`
- Case B body **[multi-line]**: `` `${itemName} is down as ${formatMoney(itemValue)} in the budget, and someone typed that in by hand. We haven't touched it.` ``
- Case B buttons **[multi-line]**: `` `Update the budget to ${formatMoney(to)}` `` · `Leave the budget as it is`
- Out-of-sync chip: `Out of sync with budget`
- Two-items note **[multi-line]**: `` `This vendor is linked to ${n} budget lines, so we won't guess which one to update. Change the numbers on the budget lines themselves.` ``

**Compare**
- `h1`: `Compare quotes`
- Subtitle **[multi-line]**: `` `${n} ${category.toLowerCase()} options, side by side.` ``
- Row labels: `Estimated` · `Quoted` · `Contract price` · `vs Alison` · `Deposit` · `Next payment` ·
  `Contact` · `Links` · `Notes`
- Lowest-price caption: `lowest`
- Buttons: `Book this one` · `Pass` → `Pass on them?` · `Reconsider` · `Undo booking`

**Overview**
- Countdown, future **[multi-line]**: value `` `${days}` ``, label `days until the wedding`
- Countdown, tomorrow: value `1`, label `day until the wedding`
- Countdown, today: value `Today`, label `is the day.`
- Countdown, past **[multi-line]**: `` `You did it — married ${n} days ago.` ``
- Countdown middle: `formatCalendarDateLong(weddingDate)`
- Countdown right **[multi-line]**: `` `RSVPs close in ${n} days` `` / `RSVPs are closed`
- Eyebrows: `THE GUEST LIST` · `THE MONEY`
- Money card labels: `BUDGET SPENT` · `BUDGET REMAINING` · `DUE THIS MONTH` · `VENDORS BOOKED`
- Budget Spent accent **[multi-line]**: `` `of ${formatMoney(forecast)} planned` ``; sub **[multi-line]**: `` `Alison's wedding: ${formatMoney(benchmark)}` ``
- Budget Remaining accent: `` `${pct}% of the plan left` `` / when negative: `over your plan`;
  sub **[multi-line]**: `` `${formatMoney(committedUnpaid)} already promised` ``
- Due This Month accent: `` `${plural(count,"payment")}` ``; sub: `Nothing overdue` /
  **[multi-line]** `` `${plural(overdueCount,"payment")} overdue · ${formatMoney(overdueCents)}` ``
- Vendors Booked accent: `` `of ${rolesTotal} roles` ``; sub **[multi-line]**:
  `` `${pending} still deciding · ${plural(contractsOutstanding,"contract")} outstanding` ``
- Team panel: `Your wedding team` · `View vendors` · cell labels `Booked` / `Still deciding` /
  `Contracts outstanding` · bar caption **[multi-line]** `` `${filled} of ${total} roles filled` ``
- Tasks line, before `vendor_tasks` ships: `Your to-do list is coming next.` (muted, not a link)
- Tasks line, after **[multi-line]**: `` `${plural(n,"task")} due this week` `` as a `<Link>` to the tasks view;
  when zero: `Nothing due this week.`
- Coming-up panel: `Coming up` · `View budget`

**Currency (decision 2 — do not guess)**
- Chip beside the money fields: `USD`
- Mixed-currency notice, rendered as an amber panel at the top of the vendors page **only** when 2+
  distinct `currency` values exist across `vendors` **[multi-line]**:
  `Some vendors are priced in another currency. Totals below just add the numbers up — they don't convert anything. Worth settling with Juliet before you trust the total.`

---

### 9. Acceptance checks

#### 9.1 Commands (all must pass)

```
npx tsc --noEmit          # zero errors
npm test                  # 257 existing tests still pass, plus the new ones
npm run build             # clean production build
```

New tests required by this section, all under `lib/**` (the only place vitest looks):
- `lib/domain/vendor-roles.test.ts` — `roleSlots` produces exactly 19 default slots for an empty
  vendor set; a custom category appends a 20th slot; a role whose only vendor is `passed` is `empty`;
  a role with one `booked` and two `passed` is `filled`; `completed` counts as filled.
- `lib/data/vendor-rules.test.ts` — `sortVendors` in all three modes puts `passed` last;
  `matchesVendorQuery` hits company and notes; `contractsOutstanding` excludes `completed`;
  `awaitingDeposit` counts a booked vendor with an unpaid `is_deposit` payment and one with no
  payments at all, and excludes one whose deposit is paid; `paymentsDueInMonth` includes the first and
  last day of the window and excludes the day either side.
- `lib/format/wedding-date.test.ts` — `signedDaysUntilCalendarDate` returns a negative for a past
  date (proving it does not inherit the floor); `calendarMonthBounds` returns July for
  `2026-08-01T04:00:00Z` in `America/Los_Angeles`; `formatCalendarDateLong("2027-06-12")` is
  `"Saturday, June 12, 2027"` (this is the assertion that catches a `new Date()` regression).
- `lib/format/relative-time.test.ts` — the lifted `timeAgo`.

#### 9.2 Browser checks — drive a real browser against `npm run dev` on port 3006

Reviews cannot catch a wrong goal; verify the UI by driving it (per the project's standing rule). Free
the port with `lsof -ti:3006 | xargs kill` if it is busy — never a name-based kill.

1. **Nav.** Load `http://localhost:3006/admin`. The sidebar shows **Vendors** between Budget (or
   Meals) and Communications, with a storefront icon at the same weight as its neighbours. Click it —
   the item turns `bg-olive-deep text-cream` and the URL is `/admin/vendors`. Collapse the sidebar; the
   icon still renders and the tooltip reads `Vendors`.
2. **Empty state.** With zero vendors, `/admin/vendors` shows `No vendors yet`, the invitation line,
   and ten dashed role tiles beginning with Venue. No empty table, no zeroed metric cards. Click the
   dashed **Photographer** tile — the add form opens with the role already filled in.
3. **Create + fill a role.** Add three photographers with statuses researching / quoted / quoted. The
   Photographer tile turns to the `deciding` state reading `2 quotes in`. Set one to `booked` — the
   tile turns sage, names that vendor, and the strip's count and progress bar both advance by one.
4. **List behaviour.** With ~10 vendors: click each status chip and confirm the table changes and the
   chip's count matches the row count. Type `pho` in the search — the row count line updates without a
   page reload, and after ~250ms the URL carries `?q=pho`. Reload: the query is still in the box.
   Switch sort to **By price** — the highest contract price is first, `—` rows are last, and passed
   vendors sit at the bottom. Confirm the ALISON column shows a benchmark and a coloured delta for at
   least one linked vendor.
5. **Phone.** Resize to 390px wide. The table is gone, the card list is there, chips scroll
   horizontally, and **the page body does not scroll sideways**. The metric grid is 2×2.
6. **Profile.** Open a vendor. Confirm the three groups render in order General / Contact / Financial,
   that Estimated / Quoted / Final contract price / Alison paid sit in **one row, adjacent**, and that
   nothing financial is behind a tab. Edit the phone number, save, reload — it persisted. Click the
   phone link and confirm it is a real `tel:` anchor.
7. **The sync, case A.** Link the vendor to a budget item whose `contracted_cents` is empty. Change the
   contract price to `$5,400` and save. A sage banner names both the item and the new number. Open the
   budget item — it shows `$5,400`.
8. **The sync, case B — the one that matters.** On the budget item, type a different contract number by
   hand (say `$5,000`). Return to the vendor, change its contract price to `$5,900`, save. The vendor
   saves; **the budget number is still `$5,000`**; an amber panel names both numbers and offers
   `Update the budget to $5,900` / `Leave the budget as it is`; the header shows the
   `Out of sync with budget` chip. Click `Leave the budget as it is` — the budget still reads `$5,000`
   and the vendor's Activity shows `vendor price sync declined`. Repeat and click the update button —
   the budget now reads `$5,900` and the chip is gone.
9. **Deposit split.** On a linked vendor with a `$5,400` contract and no payments, open `Set up the
   deposit`, type `2000`, and confirm the balance line reads `Balance of $3,400 due …` **as you type**,
   with no subtraction asked of the user. Submit — two payments exist, one flagged as the deposit, and
   the sub-form is gone on reload.
10. **Overdue dates.** Give a payment a `due_date` of yesterday. The vendor row's NEXT PAYMENT cell is
    rose and reads `1 day overdue`; `UpcomingPayments` pins it to the top with a rose dot. Confirm the
    same date reads correctly with the machine's clock set near UTC midnight — this is the bug class
    the conventions warn about, so check it rather than assuming.
11. **Compare.** From a role with three vendors, click `Compare quotes`. Three columns render with the
    rows listed in §5, the lowest contract price is marked `lowest` in olive, and the grid scrolls
    inside its own container. Click `Pass` twice on one column — it dims to `opacity-60`, moves last,
    and gains a `Reconsider` button. Click `Book this one` on another — it gains the olive border, the
    role tile on `/admin/vendors` is now filled, and the Overview's `VENDORS BOOKED` card went up by one.
12. **Overview.** Load `/admin`. Confirm, in order: the countdown ribbon with a real day count and
    `Saturday, June 12, 2027`; the `THE GUEST LIST` eyebrow over the four unchanged guest cards; the
    `THE MONEY` eyebrow over Budget Spent / Budget Remaining / Due This Month / Vendors Booked;
    `Your wedding team` beside `Coming up`; then Recent RSVPs and Meal counts. Budget Spent's sub line
    names Alison's total. The tasks line reads `Your to-do list is coming next.` Every money figure
    matches the budget page's totals to the cent.
13. **Viewer role.** Sign in as (or temporarily set `wedding_members.role` to) `viewer`. Every vendor
    screen still renders; no Save button, no Add a vendor, no Remove, no Book this one is present
    anywhere. Then confirm a direct POST to a vendor action is rejected by `requireEditor()`.
14. **Console.** Zero React hydration warnings and zero errors in the browser console on
    `/admin`, `/admin/vendors`, `/admin/vendors/[id]` and `/admin/vendors/compare?category=Photographer`.

---

## Seed Data, Import & Exports

The source of truth for the seed is `/Users/admin/Downloads/Wedding Budgeting Spreadsheet - Wedding Budget.csv`
(87 lines: 1 header, 1 grand-total row, 10 category header rows, 75 item rows). Every number in this
section was computed from that file, not estimated. If your parse disagrees with a figure below, your
parse is wrong — stop and fix it before inserting anything.

### 5.0 Numbers this section is accountable for

| Figure | Cents | Dollars |
| --- | --- | --- |
| Sum of every seeded `budget_items.benchmark_cents` | `4096200` | **$40,962** |
| Sum of every seeded `budget_items.estimated_cents` | `6247000` | **$62,470** |
| Grand-total row as printed in the CSV (line 2) | `4096200` / `6017000` | $40,962 / $60,170 |
| `budget_payments` rows seeded | `0` | $0 spent, $62,470 due |

The benchmark lands **exactly** on the client's $40,962. The forecast does **not** land on $60,170, and
that is deliberate — see §5.3. Read §5.3 before writing the seed; if any other section of this spec
asserts $60,170 as an on-screen headline, the arithmetic in §5.3 supersedes it.

### 5.1 Schema columns this section writes (hard requirements for the schema section)

The seed and the exports only ever touch these. Names are load-bearing for the code below.

- `budget_categories`: `id, wedding_id, name text not null, sort_order int not null, notes text null`.
  **Categories store no money columns.** Every category figure on screen is `SUM` over its items —
  a stored category total is exactly the drift the pre-decided design forbids.
- `budget_items`: `id, wedding_id, category_id, vendor_id null, name text not null, qty text null,
  unit_price_cents bigint null, benchmark_cents bigint null, estimated_cents bigint null,
  quoted_cents bigint null, contracted_cents bigint null, currency text not null default 'USD',
  is_reconciliation boolean not null default false, sort_order int not null, notes text null`.
  - `qty` **must be `text`, not numeric.** CSV line 12 reads `100 liters (abundant)`. It is provenance,
    never arithmetic.
  - `unit_price_cents` is provenance only. `qty x each` disagrees with the recorded cost on 8 of the
    23 rows that carry both (see §5.2 flags) — never compute a cost from it.
  - **No `check (… >= 0)` on `estimated_cents`.** One seeded reconciliation row is `-100000`.
- `budget_payments`: `id, wedding_id, budget_item_id, label text not null, amount_cents bigint not null,
  currency text not null default 'USD', due_date date null, paid_at date null, method text null,
  reference text null, notes text null, sort_order int not null`.
  `due_date` and `paid_at` are Postgres `date` columns — see §5.5 for the mandatory helper usage.
- `vendors`: read-only for this section; the exports need `id, name, category_id, status, contact_name,
  email, phone, website, contract_url, notes`.

### 5.2 The complete category → item mapping

`Bench` and `Est` are cents. `null` = the seed writes SQL `NULL`. `0` = the seed writes zero (the CSV
distinguishes them and so must we — see the parse rules below the table). Line = 1-based line number in
the source file. `sort_order` for both categories and items is the CSV order, starting at 1 within each
parent.

**Parse rules (implemented once, in `lib/format/money.ts` → `parseMoneyInput`):**
- `""` (blank) → `null` — "not known / not broken out".
- `"-"` → `null`, **and** the seed appends `Marked "—" (not applicable) in the source spreadsheet.` to
  that item's `notes`. Blank and `-` mean different things to Juliet and the note is how that survives.
- `"0"` and `"$0"` → `0` — "she spent nothing / DIY". Renders as `$0`, not `—`.
- `"$1,277"` → `127700`. Strip `$`, `,`, and surrounding whitespace, then `Math.round(n * 100)`.
- `"$8.70"` → `870`; `"$4.00"` → `400`; `"$36.38"` → `3638`. Sub-dollar precision is real in the `Each`
  column and must not be truncated.
- Leading `-` or wrapping parens (`-$50`, `($50)`) → negative cents. Not present in this CSV; required
  by the reconciliation rows and by manual entry later.
- Anything else non-empty → **throw**. The seed must abort loudly on an unparseable cell, never coerce.
- Item names: `.trim()` only. Do not fix spelling ("Bouqets"), casing, or punctuation. They are her words.

| Line | Name | Category | Qty | Each | Bench | Est |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | *(grand total row — **skip**, assert only)* | — | — | — | 4096200 | 6017000 |
| 3 | **Venue** | CATEGORY 1 | — | — | *(hdr 807900)* | *(hdr 1537000)* |
| 4 | Venue Rental | Venue | `1` | null | 675000 | 1537000 |
| 5 | Linen Rental | Venue | `1` | null | 127700 | null `—` |
| 6 | Shot Glasses | Venue | `1` | null | 2100 | null `—` |
| 7 | Banquet Permit (x2) | Venue | `2` | 1000 | 2000 | null `—` |
| 8 | Masks | Venue | `1` | null | 1100 | null `—` |
| 9 | Photobooth Rental | Venue | null | null | null | null |
| 10 | **Food and Beverage** | CATEGORY 2 | — | — | *(hdr 993300)* | *(hdr 1650000)* |
| 11 | Ceremony Dinner | Food and Beverage | `180` | null | 742600 | 940000 |
| 12 | Alcohol, Ice, Non-Alcoholic Drinks (BevMo) | Food and Beverage | `100 liters (abundant)` | null | 213800 | 400000 |
| 13 | Cakes | Food and Beverage | `1` | null | 20400 | 20000 |
| 14 | Oranges/Grapefruits/Limes (Costco) | Food and Beverage | `1` | null | 8600 | 10000 |
| 15 | Flan | Food and Beverage | `180` | null | **7900** ⚠F1 *(row prints $400)* | 30000 |
| 16 | Pho Food Truck - late night | Food and Beverage | null | null | null | 50000 |
| 17 | Taco Food Truck - late night | Food and Beverage | null | null | null | 50000 |
| 18 | Wedding Party Rehearsal dinner | Food and Beverage | null | null | null | 150000 |
| 19 | **Music + Photography** | CATEGORY 3 | — | — | *(hdr 698400)* | *(hdr 830000)* |
| 20 | Photographer/Videographer | Music + Photography | `1` | null | 563400 | 500000 |
| 21 | DJ | Music + Photography | `1` | null | 135000 | 130000 |
| 22 | Harp - ceremony | Music + Photography | null | null | null | 50000 |
| 23 | Band | Music + Photography | null | null | null | 150000 |
| 24 | Other Vendors | Music + Photography | null | null | null | 50000 |
| 25 | Lion Dance | Music + Photography | `1` | null | null | 50000 |
| 26 | **Attire + Beauty** | CATEGORY 4 | — | — | *(hdr 409300)* | *(hdr 520000)* |
| 27 | Juliet Dress 1 - Ceremony | Attire + Beauty | `1` | null | 111800 | 150000 |
| 28 | Juliet Dress 2 - Ao Dai Reception | Attire + Beauty | `1` | null | 44800 | 80000 |
| 29 | Juliet Dress 3 - Dancing | Attire + Beauty | `1` | null | null `—` | 50000 |
| 30 | Groom's Outfit | Attire + Beauty | `1` | null | 103300 | 100000 |
| 31 | Wedding Bands | Attire + Beauty | `1` | null | 54600 | 100000 |
| 32 | Alterations | Attire + Beauty | `1` | null | 43600 | 0 |
| 33 | Bride Hair | Attire + Beauty | `1` | null | 25300 | 20000 |
| 34 | Mani/Pedi | Attire + Beauty | `1` | null | 15000 | 10000 |
| 35 | Shoes | Attire + Beauty | `1` | null | 6500 | 10000 |
| 36 | Veil (Etsy) | Attire + Beauty | `1` | null | 4400 | 0 |
| 37 | **Gifts** | CATEGORY 5 | — | — | *(hdr 426100)* | *(hdr 200000)* |
| 38 | Groomsmen Gifts | Gifts | `9` | null | 135000 | null |
| 39 | Bridesmaid Gifts | Gifts | `9` | null | 105000 | null |
| 40 | Attendee Party Favor | Gifts | `200` | 400 | 80000 | null |
| 41 | Bridesmaids Hair | Gifts | `1` | null | 67000 | 0 |
| 42 | Dad's/Brother's Ties/Socks | Gifts | `2` | 4000 | 14500 ⚠E2 | 0 |
| 43 | Bach Gift | Gifts | `13` | 970 | 12600 | null |
| 44 | Flower Girl, Ring Boy Gifts (Outfits + Accessories) | Gifts | `1` | 15000 | 12000 ⚠E2 | null |
| 45 | **Flowers + Decor** | CATEGORY 6 | — | — | *(hdr 172200)* | *(hdr 500000)* |
| 46 | Flowers for Centerpieces | Flowers + Decor | `25` | 2500 | 62500 | null |
| 47 | Flowers for Ceremony Isle/Chairs | Flowers + Decor | null | null | 0 | null |
| 48 | Bridesmaids Bouqets (10) | Flowers + Decor | `8` | 3100 | 25000 ⚠E2 ⚠Q1 | null |
| 49 | SIGN 1: Welcome sign + easel | Flowers + Decor | `1` | 20000 | 20000 | null |
| 50 | Flower petals + holder | Flowers + Decor | `1` | null | 13700 | null |
| 51 | Eucalyptus | Flowers + Decor | `1` | null | 10700 | null |
| 52 | Bride Bouqet (1) | Flowers + Decor | `1` | 7500 | 7500 | null |
| 53 | Corsages (2 Moms, 1 Grandma, 1 Sister) | Flowers + Decor | `4` | 1900 | 7500 ⚠E2 | null |
| 54 | Guestbook book items | Flowers + Decor | `1` | 7500 | 7500 | null |
| 55 | Disposable Cameras | Flowers + Decor | `5` | 1400 | 6800 ⚠E2 | null |
| 56 | Vases for Centerpieces | Flowers + Decor | `23` | 870 | 3200 ⚠E2 | null |
| 57 | PRINT: Menus | Flowers + Decor | `200` | 10 | 2600 ⚠E2 | null |
| 58 | Lighters + Candles | Flowers + Decor | `1` | null | 2000 | null |
| 59 | SIGN 3: Seating chart sign | Flowers + Decor | `1` | 4000 | 2000 ⚠E2 | null |
| 60 | PRINT: Name tags | Flowers + Decor | `100` | 10 | 1200 ⚠E2 | null |
| 61 | SIGN 2: Drink signs | Flowers + Decor | `1` | 0 | 0 | null |
| 62 | FRAME: Guestbook sign | Flowers + Decor | `1` | 0 | 0 | null |
| 63 | Card Box | Flowers + Decor | null | null | 0 | null |
| 64 | Wedding Arch | Flowers + Decor | null | null | 0 | null |
| 65 | Wedding Arch Flowers | Flowers + Decor | null | null | 0 | null |
| 66 | Boutonnieres (1 Groom, 8 Groomsmen + 2 Dads + 1 brother) | Flowers + Decor | null | null | 0 | null |
| 67 | Table numbers | Flowers + Decor | null | null | 0 | null |
| 68 | **Printing** | CATEGORY 7 | — | — | *(hdr 35500)* ⚠P1 | *(hdr 30000)* |
| 69 | Postage | Printing | `200` | null | 11600 | null |
| 70 | Save the Dates | Printing | `100` | 150 | 10700 ⚠E2 | null |
| 71 | Card Stock | Printing | `2` | 3638 | 7300 | null |
| 72 | Thank you notes | Printing | `1` | null | 3800 | null |
| 73 | Envelopes | Printing | `1` | null | 1200 | null |
| 74 | Invites | Printing | `120` | null | 1000 | null |
| 75 | **Misc** | CATEGORY 8 | — | — | *(hdr 210100)* | *(hdr 400000)* |
| 76 | Wedding Planner | Misc | `1` | null | 0 | 350000 |
| 77 | Transportation/Shuttle Service | Misc | `1` | null | 66000 | 50000 |
| 78 | Marriage License | Misc | `1` | 7100 | 7100 | 0 |
| 79 | Day of Food (Sandwiches & Breakfast) | Misc | `1` | null | 7000 | 0 |
| 80 | **Hotels** | CATEGORY 9 | — | — | *(hdr 343300)* | *(hdr 300000)* |
| 81 | Le Family Airbnb (3 nights) | Hotels | `1` | null | 253600 | null |
| 82 | J+J Hotel Nights (5) | Hotels | `2` | null | 56700 | 150000 |
| 83 | Jauregui/Boyd Family Airbnb | Hotels | `1` | null | 33000 | null |
| 84 | **Flights** | CATEGORY 10 | — | — | *(hdr 0)* | *(hdr 280000)* |
| 85 | Mom Flight | Flights | null | null | null | 70000 |
| 86 | Dad Flight? | Flights | null | null | null | 70000 |
| 87 | Juliet + Juan Flight | Flights | null | null | null | 140000 |

**Plus one category that is not in the CSV:**

| — | **Contingency** | CATEGORY 11 | — | — | — | — |

Seeded with **zero items and zero money**, `notes = 'Every planner surveyed recommends holding back
5–10%. On a $62,470 forecast that is $3,124–$6,247. Nothing set aside yet.'` It exists so the category
list contains the idea; it changes no total. Do not seed a dollar figure into it — that would be
configuring on Juliet's behalf.

**Rows with trailing whitespace in the source** (lines 15 `Flan `, 32 `Alterations `, 43 `Bach Gift `):
trim. **Line 9 `Photobooth Rental`** is entirely empty apart from its name — seed it as a real item with
all money `null`. It is a live "maybe", and dropping it loses a decision she has not made yet.
**Every cell in the `Juliet Actual Cost` and `Notes` columns is empty or `-` across all 87 lines** — the
seed reads neither. Nothing in this file records money actually spent.

### 5.3 Where the CSV's own arithmetic does not add up, and the resolution

Six categories do not reconcile against their own item rows, and the grand-total row does not reconcile
against the category rows. Resolutions below; the seed prints all of them and none are silent.

**Rule R1 — a header *above* its rows is unallocated budget.** Insert one item named
`Not yet itemized`, `is_reconciliation = true`, carrying the positive difference, with a `notes` string
that states the arithmetic. This is real money Juliet has budgeted and not broken out; dropping it would
under-forecast her wedding, which is the exact failure the research says to avoid.

**Rule R2 — a header *below* its rows is a stale formula.** Insert one item named
`Spreadsheet reconciliation`, `is_reconciliation = true`, carrying the negative difference, unless the
gap can be attributed to a single row with exact arithmetic (⚠F1 below), in which case attribute it.

**Reconciliation items the seed must create — exactly 6, and no others.** Each is appended as the last
item of its category (`sort_order` = max + 1):

| # | Category | Item name | Bench | Est | `notes` (verbatim) |
| --- | --- | --- | --- | --- | --- |
| 1 | Music + Photography | Spreadsheet reconciliation | `null` | **-100000** | `Juliet's Music + Photography total reads $8,300, which is Photographer $5,000 + DJ $1,300 + Harp $500 + Band $1,500. "Other Vendors" ($500) and "Lion Dance" ($500) were added to the sheet after that total was last calculated. This row holds the -$1,000 so the category matches her spreadsheet. Ask Juliet whether the category should be $9,300.` |
| 2 | Gifts | Not yet itemized | `null` | **200000** | `Juliet budgeted $2,000 for Gifts without breaking it out. Alison's seven gift rows total $4,261.` |
| 3 | Flowers + Decor | Not yet itemized | `null` | **500000** | `Juliet budgeted $5,000 for Flowers + Decor without breaking it out. Alison's twenty-two rows total $1,722.` |
| 4 | Printing | Not yet itemized | `null` | **30000** | `Juliet budgeted $300 for Printing without breaking it out. Alison's six rows total $356.` |
| 5 | Hotels | Not yet itemized | `null` | **150000** | `Juliet budgeted $3,000 for Hotels; only the $1,500 for J+J hotel nights is broken out.` |
| 6 | Misc | Not yet itemized | **130000** | `null` | `Alison's Misc total is $2,101 but only $801 is broken out. $1,300 of her spend has no line item.` |

Cross-check: the 75 CSV item rows contribute `3966200` benchmark (`3998300` as literally printed, minus
the `40000` Flan cell, plus the `7900` ⚠F1 resolves it to) and `5467000` estimate. Reconciliation rows
contribute `+130000` benchmark and `-100000 + 200000 + 500000 + 30000 + 150000 = +780000` estimate.
`3966200 + 130000 = 4096200` ✓ and `5467000 + 780000 = 6247000` ✓. If your parse yields anything else,
one of the 81 rows is wrong — do not "fix" it with a seventh reconciliation row.

**The named anomalies:**

- **⚠F1 — Food and Beverage benchmark, line 15 `Flan`.** The row prints $400. Her F&B header reads
  $9,933, but the five costed rows add to $10,254 — a gap of exactly $321. The gap is fully attributable
  to this one cell: `7426 + 2138 + 204 + 86 + 79 = 9933` to the dollar, and `400 - 321 = 79`. Two of her
  three figures (the category header and the grand total) agree on **$79**; only the row cell says $400.
  **Resolution: seed `benchmark_cents = 7900`.** The row's printed value is preserved verbatim in the
  item's notes — nothing is lost — and it is open question #2 for Juliet. Append to that item's notes:
  `Alison's spreadsheet row prints $400, but both her Food and Beverage total ($9,933) and her grand
  total ($40,962) were calculated with $79. Using $79 so the app agrees with her own totals. Confirm
  which is right.` No reconciliation item — a -$321 phantom line would hide the cause, and a $400 value
  would put every headline $321 out.
- **⚠P1 — Printing benchmark.** Six rows total $356; the header prints $355. Her figures are all
  displayed to the whole dollar, so the true total carried cents. **Resolution: no reconciliation item.**
  Printing benchmark reads $356. This is the same dollar as the grand-total variance below, and leaving
  it in is what makes the wedding total land on her $40,962.
- **⚠E2 — `Qty x Each` ≠ the recorded cost** on lines 42, 44, 48, 53, 55, 56, 57, 59, 60, 70 (worst:
  line 56, `23 x $8.70 = $200.10` vs a recorded $32; line 70, `100 x $1.50 = $150` vs $107).
  **Resolution: the cost column is authoritative always. `qty`/`unit_price_cents` are display captions
  only.** The UI renders them as a muted caption under the item name (`200 × $4.00`) and never multiplies.
- **⚠Q1 — line 48 `Bridesmaids Bouqets (10)` has `Qty = 8`.** Name says ten, quantity says eight.
  Store both verbatim. Open question for Juliet.
- **⚠G1 — the grand-total row, benchmark.** Line 2 prints $40,962; her ten category headers add to
  $40,961. Because ⚠P1 leaves Printing at its true $356, the seeded item sum is **$40,962 exactly** —
  the drift and the grand total are the same dollar, and the app agrees with her headline number.
- **⚠G2 — the grand-total row, forecast. This is the big one.** Line 2 prints $60,170. Her ten category
  headers add to $62,470. The difference is $2,300, and
  `15370 + 16500 + 8300 + 5200 + 5000 + 4000 + 3000 + 2800 = 60170` — her total formula's range skips the
  **Gifts ($2,000)** and **Printing ($300)** rows entirely. **Resolution: the app forecasts $62,470.**
  Shipping $60,170 would tell her she has $2,300 of headroom she does not have, and the two categories it
  drops are real. The correction is never applied silently: the Budget page renders a persistent
  reconciliation strip (spec below) naming both figures.

**Reconciliation strip — `components/admin/budget/SeedReconciliation.tsx`.** Rendered directly beneath
the headline numbers on `/admin/budget`, in the blush card style
(`rounded-xl border border-[#f2d9d4] bg-blush p-5`), heading `text-[14.5px] font-semibold text-ink`
reading `Two numbers from your spreadsheet didn't match`, body `text-[13.5px] text-[#6b7167]`:

> Your spreadsheet's grand total says **$60,170**. Adding your ten category totals line by line comes to
> **$62,470**. The $2,300 difference is Gifts ($2,000) and Printing ($300) — the total formula skipped
> those two rows. We're using $62,470 so nothing gets forgotten.
>
> Alison's total says $40,962 and her categories add to $40,961 — a dollar of rounding. We're using
> $40,962, the same as your sheet.

Plus a `Got it` secondary button (house secondary-button class) that writes an `activity_log` row
`budget.reconciliation_acknowledged` and hides the strip. Dismissal is per-wedding, not per-user, and it
never reappears. It is not a toast — it must survive a reload until acknowledged.

### 5.4 Taxonomy: Juliet's ten categories win

**Juliet's own category names are seeded verbatim and are the app's category list.** Her groups are the
axis the benchmark works on — Alison's numbers and Juliet's numbers live in the *same* ten buckets in the
same sheet, so remapping either side onto a generic 22-name list would silently destroy the one
comparison that makes this module worth building. And the categories are her mental model: "Music +
Photography" is one decision to her, and splitting it into Photography / Videography / Entertainment
would make her app disagree with her own spreadsheet on day one.

The standard list is not discarded — it becomes the suggestion source for the "Add a category" control,
via a pure crosswalk in `lib/domain/budget-taxonomy.ts`. `suggestCategory(standardName)` returns the
existing category a standard name should fold into, or `null` when it is genuinely new. This is what
stops her creating a duplicate "Photography" alongside "Music + Photography".

| Standard name | Folds into Juliet's | |
| --- | --- | --- |
| Venue | Venue | existing |
| Rentals | Venue | existing (linens, photobooth, shot glasses all sit there) |
| Catering | Food and Beverage | existing |
| Bar | Food and Beverage | existing (the BevMo row) |
| Cake & Dessert | Food and Beverage | existing (Cakes, Flan) |
| Rehearsal Dinner | Food and Beverage | existing (line 18) |
| Welcome Party | Food and Beverage | existing |
| Farewell Brunch | Food and Beverage | existing (line 79 is the nearest match) |
| Photography | Music + Photography | existing |
| Videography | Music + Photography | existing (line 20 is one combined vendor) |
| Entertainment | Music + Photography | existing (DJ, Harp, Band, Lion Dance) |
| Wedding Attire | Attire + Beauty | existing |
| Hair & Makeup | Attire + Beauty | existing |
| Florals | Flowers + Decor | existing |
| Decor | Flowers + Decor | existing |
| Invitations & Stationery | Printing | existing |
| Gifts | Gifts | existing |
| Transportation | Misc | existing (line 77) |
| Marriage License | Misc | existing (line 78) |
| Accommodations | Hotels | existing |
| Miscellaneous | Misc | existing |
| Contingency | Contingency | seeded empty (§5.2) |

Two of Juliet's categories have no standard equivalent and stay as they are: **Flights** and **Misc**
(which for her holds the wedding planner, the largest single forecast line at $3,500). `suggestCategory`
returns `null` for any name not in the table, and the UI then offers to create it.

### 5.5 The seed script

**`scripts/seed-budget.mjs`** — loads the CSV, builds the plan, prints it, and (only when told to)
writes it. Node ESM `.mjs`, no build step, matching `scripts/std-check.mjs` / `scripts/std-apply.mjs`.

- **Env:** copy the 8-line `.env.local` reader verbatim from the top of `scripts/dev-login.mjs`
  (lines 11–21). It needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not use
  `--env-file`; no other script in this repo does.
- **Loading the pure parser:** the parser lives in TypeScript under `lib/`, because that is the only
  place vitest can see it. Load it from the `.mjs` runner with `jiti`, which is already installed
  (transitive dep of Next, v2.7.0, verified working against this repo's `@/` alias):
  ```js
  import { createJiti } from "jiti";
  const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } });
  const { buildBudgetSeedPlan } = await jiti.import("../lib/csv/budget.ts");
  ```
  If resolution fails, `npm i -D jiti` (already in the lockfile — no new dependency).
  **Do not reimplement the parsing in the script.** Untested duplicated money arithmetic is how the
  $321 above got shipped in the first place.
- **Invocation:**
  ```
  node scripts/seed-budget.mjs "/Users/admin/Downloads/Wedding Budgeting Spreadsheet - Wedding Budget.csv"
  node scripts/seed-budget.mjs <csv> --apply
  node scripts/seed-budget.mjs <csv> --reset --apply
  node scripts/seed-budget.mjs <csv> --reset --apply --force
  ```
  Add `"seed:budget": "node scripts/seed-budget.mjs"` to `package.json` `scripts`.
- **Default is a dry run.** No flag = parse, validate, print the plan and every anomaly from §5.3, write
  nothing, exit 0. This is the `std-check` / `std-apply` split the repo already uses and the house rule
  of confirmation before configuration.
- **Idempotency / refusing to double-insert:**
  1. Count `budget_categories` for `DEFAULT_WEDDING_ID` (`11111111-1111-1111-1111-111111111111`).
  2. `--apply` with count > 0 and no `--reset` → print
     `Budget already seeded (11 categories, 81 items). Re-run with --reset to replace it.` and
     `process.exit(1)`. Nothing is written.
  3. `--reset` counts `budget_payments` and `vendors` linked to budget items first. If either is
     non-zero and `--force` is absent → print exactly what would be destroyed
     (`4 payments totalling $12,400 and 3 linked vendors — these are not in the CSV and cannot be
     rebuilt. Re-run with --force to delete them anyway.`) and exit 1.
  4. `--reset --apply` deletes `budget_payments` → `budget_items` → `budget_categories` for the wedding,
     in that order, each `.eq("wedding_id", WEDDING_ID)`, then inserts. Never `truncate`, never delete
     without the wedding filter.
  5. Inserts happen in three batched calls (categories, then items with resolved `category_id`, then the
     zero payments) so a partial run is visible rather than a 100-round-trip crawl.
- **Post-write assertions — the script fails the run if any of these is false:**
  `SUM(benchmark_cents) === 4096200`, `SUM(estimated_cents) === 6247000`, `count(categories) === 11`,
  `count(items) === 81` (75 CSV rows + 6 reconciliation rows), `count(payments) === 0`, and per-category
  benchmark/estimate matching the header column of §5.2 with the one documented exception (Printing
  benchmark is `35600`, `+100` over its printed header — see ⚠P1). On failure it prints the offending category and
  exits 1 **after** rolling nothing back — say so plainly and tell the operator to `--reset --apply`.
- **Reporting:** on success prints a JSON object to stdout (`std-check.mjs` house style):
  ```json
  { "mode": "apply", "categories": 11, "items": 81, "reconciliationItems": 6, "payments": 0,
    "benchmarkCents": 4096200, "estimatedCents": 6247000,
    "benchmark": "$40,962", "forecast": "$62,470",
    "printedGrandTotal": { "benchmark": "$40,962", "forecast": "$60,170" },
    "variances": [ { "code": "G2", "cents": 230000, "explanation": "..." }, ... ],
    "anomalies": [ { "line": 15, "code": "F1", "message": "..." }, ... ] }
  ```
- **Activity log:** one direct insert into `activity_log` (`lib/data/activity.ts` shows the shape) with
  `wedding_id`, `actor_type: "system"`, `action: "budget.seeded"`, and the summary object above as
  `payload`. The seed is a real event in the couple's history and must appear on the Overview feed.
- **Dates and timezone:** the seed writes no dates at all. It must not call `new Date()` on anything.

### 5.6 Generic CSV import for future budget updates — **deferred to a later milestone**

Explicitly out of scope for the budget/vendor build. Two reasons: the seed script is already
re-runnable, which covers the known need (the client will redo this dataset); and a column-mapping
wizard is a milestone in its own right — `components/admin/import/` is five components plus
`lib/csv/{detect,validate,summary,group,fields}.ts`, and half-building it produces a worse tool than the
spreadsheet.

What the later milestone must do, so it is cheap when it comes:

- **Model on:** `lib/csv/detect.ts` for header auto-detection (same `find(...aliases)` shape, aliases
  `alisonswedding|benchmark|actual`, `estimated|estimate|budget`, `quoted|quote`, `contracted|contract`,
  `item|description`, `category|group`, `qty|quantity`, `each|unit|unitprice`, `notes`);
  `lib/csv/validate.ts` for the dry-run `{ ok, errors, warnings }` shape with 1-based line numbers;
  `lib/csv/summary.ts` for the human-readable problem roll-up; `components/admin/import/UploadStep.tsx`
  → `ColumnMatches.tsx` → `ReviewStep.tsx` → `DoneStep.tsx` for the four-step flow.
- **Category-row convention:** the interleaved-header shape of this CSV is not generic. The importer
  detects a category row as *a row with a non-empty Item cell, an empty Qty cell, and a name matching an
  existing category*, and shows the inferred grouping in the review step for confirmation before commit.
  Never infer silently.
- **Conflict resolution when a row already exists** (matched on
  `(category_id, lower(trim(name)))`, exact only — no fuzzy matching, per the house rule against
  unexplainable matches):
  - `benchmark_cents`, `estimated_cents`: fill-blanks-only. An existing non-null value is never
    overwritten by an import; the difference is listed in the review step as "we left yours alone".
  - `quoted_cents`, `contracted_cents`: **never touched by an import.** They come from a vendor
    conversation, not a spreadsheet.
  - Any item with one or more `budget_payments` rows: **read-only to imports**, full stop.
  - Unmatched CSV rows → new items. Unmatched DB rows → left alone and listed, never deleted.
  - Every change is a reviewable line in the review step with a one-sentence reason, and the commit
    writes an `activity_log` `budget.imported` row carrying prior values so it can be undone.
- **Interim stopgap available now:** `node scripts/seed-budget.mjs <csv> --merge` — dry-run diff against
  the live rows using exactly the rules above, `--merge --apply` to write. This costs ~60 lines on top of
  the seed script and is the answer if Juliet sends a revised sheet before the wizard exists.

### 5.7 Exports

Five new report keys in the existing `app/api/export/[report]/route.ts`. Both CSV and XLSX for all five —
no work required, the route's `format=xlsx` branch already covers every key, and `xlsx` is installed.

**Structural change to the route (required):** `buildReport` currently calls `loadShared(scope)` at the
top, which fires seven guest/seating queries. Budget reports need none of them. Add an early dispatch
*before* that call:

```ts
const BUDGET_REPORTS = new Set(["budget-full","budget-outstanding","budget-paid","vendor-costs","payment-schedule"]);
async function buildReport(scope: WeddingScope, report: string): Promise<Table> {
  if (BUDGET_REPORTS.has(report)) return buildBudgetReport(scope, report);
  const { hhs, responses, ... } = await loadShared(scope);
  ...
```

New files:

- **`lib/data/budget-exports.ts`** — I/O shell. `buildBudgetReport(scope, report): Promise<Table>`; one
  `Promise.all` of four scoped selects (`budget_categories`, `budget_items`, `budget_payments`,
  `vendors`, each `.eq("wedding_id", scope.weddingId)`) plus the wedding's `timezone`, then delegates.
  No logic beyond assembling the arguments.
- **`lib/data/budget-export-rows.ts`** — pure. Five exported functions
  (`fullBudgetRows`, `outstandingPaymentRows`, `paidExpenseRows`, `vendorCostRows`, `paymentScheduleRows`),
  each taking plain arrays plus `now: Date` and `timeZone: string`, each returning
  `Array<Record<string, string | number>>` with keys in the exact header order below. All ordering,
  derivation and money conversion lives here. This is the tested half.
- **`lib/data/budget-export-rows.test.ts`** — see §5.8.

**Money in exports:** every money cell is a **number in dollars to two decimals** (`cents / 100`), never
a pre-formatted string — Excel must be able to sum the column. A `Currency` column carries `USD`.
Empty money is `""`, not `0`. **Dates** are emitted as the raw ISO `YYYY-MM-DD` string straight off the
`date` column — never through `new Date()`. `Days Until Due` uses
`daysUntilCalendarDate(due_date, now, timeZone)` from `lib/format/wedding-date.ts`, with `timeZone`
read from `weddings.timezone ?? "America/Los_Angeles"`. Counting "due in 3 days" off the server clock is
the exact bug this repo has already shipped once.

**Derived values used by more than one report:** `Paid` = sum of that item's payments where
`paid_at is not null`. `Committed` = `contracted_cents ?? quoted_cents ?? estimated_cents ?? 0`.
`Remaining` = `Committed - Paid`, floored at 0. `Payment Status` = `paid` when `Remaining === 0` and
`Paid > 0`, `partial` when `Paid > 0`, otherwise `unpaid`.

| Key | Label | Group | Description (ExportCenter) |
| --- | --- | --- | --- |
| `budget-full` | Full budget | Budget & vendors | Every line item with Alison's number beside yours |
| `budget-outstanding` | Outstanding payments | Budget & vendors | What's still owed, soonest first |
| `budget-paid` | Paid expenses | Budget & vendors | Everything already paid, most recent first |
| `vendor-costs` | Vendor cost summary | Budget & vendors | One row per vendor — quoted, contracted, paid |
| `payment-schedule` | Payment schedule | Budget & vendors | Every payment on a calendar, with a running total |

Add these five to the `REPORTS` array in `app/admin/(dashboard)/imports/page.tsx` **immediately after the
`pending` entry** (line 22) and before the `caterer` entry. `ExportCenter` groups by first appearance, so
this puts "Budget & vendors" between "RSVPs" and "For your vendors" without touching the component.

**1. `budget-full`** — sheet name `Full Budget`. One row per `budget_items` row, reconciliation rows
included (they are real money). Order: `categories.sort_order`, then `items.sort_order`.
Headers, in order:
`Category, Item, Vendor, Vendor Status, Qty, Unit Price, Alison's Actual, Estimated, Quoted, Contracted, Paid, Remaining, Delta vs Alison, Currency, Payment Status, Notes`
`Delta vs Alison` = `Estimated - Alison's Actual` in dollars, `""` when either side is null. Negative
means under Alison. `Vendor`/`Vendor Status` are `""` when `vendor_id is null`.

**2. `budget-outstanding`** — sheet name `Outstanding`. One row per `budget_payments` row with
`paid_at is null`, **plus** one synthetic row per item where `Remaining > 0` and the item has no unpaid
payment (blank `Due Date`, `Label` = `Unscheduled balance`) — otherwise contracted money with no payment
plan silently vanishes from the report Juliet uses to plan cash. Order: `due_date` ascending, blank dates
last, then `Category`, then `Item`. Headers:
`Due Date, Days Until Due, Category, Item, Vendor, Label, Amount, Currency, Notes`
`Days Until Due` is `""` for blank dates and may be negative (overdue) — do not floor it here;
`daysUntilCalendarDate` floors at zero, so overdue days are computed as the negative of
`daysUntilCalendarDate(today, dueDateAsAnchor)`. Simpler and required: add
`daysBetweenCalendarDates(from, to, timeZone): number` (signed) to `lib/format/wedding-date.ts` with its
own tests, and use it here.

**3. `budget-paid`** — sheet name `Paid`. One row per `budget_payments` row with `paid_at is not null`.
Order: `paid_at` **descending**, then `Category`, then `Item`. Headers:
`Paid On, Category, Item, Vendor, Label, Amount, Currency, Method, Reference, Notes`

**4. `vendor-costs`** — sheet name `Vendor Costs`. One row per `vendors` row, including vendors with no
linked budget items (all money `0`/`""`) — an unfilled role is information. Order: status rank
`booked, completed, quoted, contacted, researching, passed`, then `name` A–Z. Headers:
`Vendor, Category, Status, Contact Name, Email, Phone, Website, Items, Estimated, Quoted, Contracted, Paid, Remaining, Currency, Contract On File, Next Payment Due, Notes`
`Items` = count of linked budget items. `Contract On File` = `yes`/`""` from `contract_url`.
`Next Payment Due` = earliest `due_date` among that vendor's unpaid payments, ISO, `""` if none.

**5. `payment-schedule`** — sheet name `Payment Schedule`. One row per `budget_payments` row, paid and
unpaid together. Order by effective date `due_date ?? paid_at` ascending, blanks last, then `Category`,
then `Item`. Headers:
`Date, Kind, Status, Category, Item, Vendor, Label, Amount, Currency, Running Total, Notes`
`Kind` = `due` or `paid` (which date the row sorted on). `Running Total` = cumulative `Amount` in row
order, so the sheet reads as a cash-flow plan. Computing it in the pure module is what makes it testable.

### 5.8 Tests

All under `lib/`, so `vitest.config.ts` (`include: ["lib/**/*.test.ts"]`) picks them up unchanged. The
257 existing tests must still pass.

**`lib/format/money.test.ts`** (the module is specified elsewhere; these cases are owned here — merge if
another section also lists cases):
- `parseMoneyInput("$1,277") === 127700`; `("1277") === 127700`; `(" $1,277 ") === 127700`
- `parseMoneyInput("$8.70") === 870`; `("$4.00") === 400`; `("$36.38") === 3638`; `("$0.10") === 10`
- `parseMoneyInput("-") === null`; `("") === null`; `("   ") === null`; `(null) === null`
- `parseMoneyInput("0") === 0` and `("$0") === 0` — **both distinct from `null`**, asserted with
  `toBe(0)` not a truthiness check
- `parseMoneyInput("-$50") === -5000`; `("($50)") === -5000`; `("-1,000") === -100000`
- `parseMoneyInput("abc")` and `("$1.2.3")` throw
- `formatMoney(4096200) === "$40,962"`; `formatMoney(6247000) === "$62,470"`;
  `formatMoney(0) === "$0"`; `formatMoney(-100000) === "-$1,000"`; `formatMoney(3638) === "$36.38"`
  (cents shown only when non-round); `formatMoney(null) === "—"`

**`lib/csv/budget.test.ts`** — against a fixture string, not the file on disk (the file lives outside
the repo and CI will not have it). Fixture: an inline template literal in the test holding **the exact
87 lines** of the source CSV. Cases:
- 11 categories out (10 from the CSV in CSV order + `Contingency` last), 81 items
  (75 + 6 reconciliation)
- the grand-total row (line 2) is not emitted as a category or an item
- `totals.benchmarkCents === 4096200` and `totals.estimatedCents === 6247000`
- **per-category subtotal assertions**, one `expect` per category:
  Venue `807900 / 1537000`; Food and Beverage `993300 / 1650000`; Music + Photography `698400 / 830000`;
  Attire + Beauty `409300 / 520000`; Gifts `426100 / 200000`; Flowers + Decor `172200 / 500000`;
  Printing `35600 / 30000`; Misc `210100 / 400000`; Hotels `343300 / 300000`; Flights `0 / 280000`;
  Contingency `0 / 0`
- each subtotal test also asserts the *difference from the printed header* is the documented one:
  `+100` on Printing benchmark (⚠P1), `0` everywhere else including Food and Beverage — the F&B header
  matches only because ⚠F1 seeded Flan at `7900`, so a regression to `40000` fails this test
- line 15 `Flan` has `benchmark_cents === 7900` and its notes contain both `$400` and `$79`
- `qty` for line 12 is the literal string `"100 liters (abundant)"` — the case that proves `qty` is text
- lines 61–67 carry `benchmark_cents === 0`, not `null`; lines 38–40/43/44 carry
  `estimated_cents === null`, not `0`
- line 29 (`Juliet Dress 3`) has `benchmark_cents === null` and its notes contain `not applicable`
- lines 5–8 have `estimated_cents === null` and the `not applicable` note; line 9 has every money field
  `null` and is still emitted
- names are trimmed (`"Flan"`, `"Alterations"`, `"Bach Gift"`) and not otherwise altered
  (`"Bridesmaids Bouqets (10)"` keeps its typo)
- exactly 6 items have `is_reconciliation === true`, with the six `(category, benchmark, estimate)`
  triples of §5.3 asserted explicitly
- `anomalies` contains entries for `F1`, `P1`, `Q1`, `G1`, `G2` and ten `E2` lines
- a category row whose header is *below* its items produces a negative reconciliation
  (drive it with a 6-line synthetic fixture, not the real file)
- a malformed money cell throws with the line number in the message
- **idempotence of the pure layer:** parsing the same text twice deep-equals

**`lib/domain/budget-taxonomy.test.ts`**:
- `suggestCategory("Photography") === "Music + Photography"`;
  `suggestCategory("Bar") === "Food and Beverage"`; `suggestCategory("Accommodations") === "Hotels"`;
  `suggestCategory("Rentals") === "Venue"`; `suggestCategory("Contingency") === "Contingency"`
- `suggestCategory("Fireworks") === null`
- case- and whitespace-insensitive: `suggestCategory("  hair & makeup ") === "Attire + Beauty"`
- every one of the 22 standard names resolves to either a seeded category name or `Contingency` —
  assert against the seeded category list so the two files cannot drift apart
- `Flights` and `Misc` are reachable as categories but are not targets of any standard name

**`lib/data/budget-export-rows.test.ts`**:
- each of the five builders returns `Object.keys(rows[0])` exactly equal to the header array in §5.7,
  in order (this is the contract with Excel)
- `budget-full` ordering follows category then item `sort_order`
- `budget-outstanding` sorts blank due dates last and emits the `Unscheduled balance` synthetic row for
  a contracted item with no payments
- `budget-paid` sorts `paid_at` descending
- `payment-schedule` `Running Total` accumulates in row order and equals the sum of `Amount`
  on the final row
- `vendor-costs` status ranking puts `booked` first and `passed` last, and includes a vendor with zero
  linked items
- money cells are numbers, not strings; a null money cell is `""`
- `Days Until Due` is computed in `America/Los_Angeles`, not UTC: with `now` at
  `2026-07-29T04:00:00Z` (which is 2026-07-28 in LA) and a due date of `2026-07-30`, the answer is `2`,
  not `1`. This test is the whole reason the timezone is threaded through.

### 5.9 Acceptance checks for this slice

**Commands:**
1. `npx tsc --noEmit` — clean.
2. `npm test` — 257 existing tests still pass, plus the new files above.
3. `node scripts/seed-budget.mjs "/Users/admin/Downloads/Wedding Budgeting Spreadsheet - Wedding Budget.csv"`
   — dry run prints `11 categories / 81 items / benchmark $40,962 / forecast $62,470` and lists the
   `G2` variance. Writes nothing.
4. `node scripts/seed-budget.mjs <csv> --apply` — succeeds; all post-write assertions pass.
5. Re-run step 4 verbatim — exits 1 with `Budget already seeded`. **Nothing is duplicated.**
6. `node scripts/seed-budget.mjs <csv> --reset --apply` — succeeds, and step 4's assertions still hold
   (this is the re-runnability the client needs).

**Proving query** (run through `mcp__supabase__execute_sql`, not the CLI):
```sql
select
  (select count(*) from budget_categories where wedding_id = '11111111-1111-1111-1111-111111111111') as categories,
  (select count(*) from budget_items      where wedding_id = '11111111-1111-1111-1111-111111111111') as items,
  (select count(*) from budget_items      where wedding_id = '11111111-1111-1111-1111-111111111111' and is_reconciliation) as recon,
  (select count(*) from budget_payments   where wedding_id = '11111111-1111-1111-1111-111111111111') as payments,
  (select coalesce(sum(benchmark_cents),0) from budget_items where wedding_id = '11111111-1111-1111-1111-111111111111') as benchmark_cents,
  (select coalesce(sum(estimated_cents),0) from budget_items where wedding_id = '11111111-1111-1111-1111-111111111111') as estimated_cents;
```
Must return exactly `11, 81, 6, 0, 4096200, 6247000`.

Per-category proof:
```sql
select c.name,
       coalesce(sum(i.benchmark_cents), 0) as bench,
       coalesce(sum(i.estimated_cents), 0) as est
from budget_categories c
left join budget_items i on i.category_id = c.id
where c.wedding_id = '11111111-1111-1111-1111-111111111111'
group by c.name, c.sort_order
order by c.sort_order;
```
Must return, in order: Venue `807900/1537000`, Food and Beverage `993300/1650000`,
Music + Photography `698400/830000`, Attire + Beauty `409300/520000`, Gifts `426100/200000`,
Flowers + Decor `172200/500000`, Printing `35600/30000`, Misc `210100/400000`,
Hotels `343300/300000`, Flights `0/280000`, Contingency `0/0`.

**What a human must see on screen** (drive a real browser at `http://localhost:3006`, sign in with
`node scripts/dev-login.mjs`, per the house rule that reviews cannot catch a wrong goal):
- `/admin/budget` headline row reads **Alison's wedding $40,962** and **Your forecast $62,470**,
  **$0 paid**, **$62,470 due** — adjacent numbers, no tab, no toggle.
- Directly beneath, the blush reconciliation strip naming **$60,170** and **$40,962** with the $2,300
  explanation, and a working `Got it` that survives a reload.
- Eleven category rows in CSV order, each showing Alison's number beside Juliet's with the delta;
  Flowers + Decor reads $1,722 vs $5,000, the module's most striking comparison.
- Expanding Food and Beverage shows eight items totalling **$9,933 vs $16,500**, with `Flan` reading
  `$79` and carrying a visible note explaining that her row printed `$400`.
- Expanding Gifts shows seven Alison rows plus one `Not yet itemized $2,000` row visibly marked as a
  reconciliation, not mistakable for a real purchase.
- `Contingency` renders as an empty category with the 5–10% prompt and no dollar figure.
- `/admin/imports` shows a new **Budget & vendors** group with five rows between RSVPs and
  "For your vendors". Downloading `Full budget` as Excel yields 81 data rows whose `Alison's Actual`
  column sums to `40962` and whose `Estimated` column sums to `62470` in Excel's own status bar.
- `Outstanding payments` downloads with **0 payment rows and exactly 33 `Unscheduled balance` rows**
  (one per item whose committed amount is above zero, all blank-dated), totalling `62470`. That is the
  fastest way to see at a glance that no payment ledger exists yet, which is the true state of things.

### 5.10 Handoffs and open questions

**Other sections must know:**
- `budget_items.qty` is `text`. `budget_items.estimated_cents` must permit negatives. Categories carry
  no money columns.
- The seed creates **zero `vendors` rows**. The CSV contains no vendor names — only roles. Inventing
  "TBD Photographer" records would pollute a production CRM. The vendor section owns its own empty
  state; these nine seeded item names are the roles it should offer to fill:
  `Photographer/Videographer`, `DJ`, `Harp - ceremony`, `Band`, `Lion Dance`, `Wedding Planner`,
  `Transportation/Shuttle Service`, `Venue Rental`, `Ceremony Dinner`.
- The seed creates **zero `budget_payments` rows**, so every "spent / paid / due this month" number is
  $0 / $0 / $62,470 on day one. Empty states for payments must be designed for, not treated as an edge case.
- `lib/format/wedding-date.ts` gains `daysBetweenCalendarDates(from, to, timeZone)` (signed) for the
  overdue case in `budget-outstanding`.

**Open questions for Juliet — surface, do not guess:**
1. **The $2,300.** Her sheet totals $60,170; the categories add to $62,470 because the total formula
   skips Gifts and Printing. We use $62,470. Confirm.
2. **Flan (line 15).** Her row says $400, but her Food and Beverage total ($9,933) and her grand total
   ($40,962) were both computed with $79. We use $79; the $400 is preserved in the item's note.
3. **Music + Photography.** Header $8,300, items $9,300 once "Other Vendors" and "Lion Dance" are
   included. We hold the $1,000 in a visible reconciliation row so the category matches her sheet —
   should the category be $9,300?
4. **Bridesmaids Bouqets (10)** has quantity 8.
5. **Currency.** Everything here is USD, but the venue is in Guadalajara. When a Mexican vendor quotes
   MXN, the app stores the currency and displays it as entered, with **no FX conversion** — mixed-currency
   totals will refuse to add rather than guess a rate. Confirm she wants that rather than a fixed rate.
6. **"Other Vendors" $500 (line 24)** is a placeholder, not a vendor. Seeded verbatim; flag it in review.

---

## Open questions for Juliet — do not guess at these

Build the accommodating thing, leave the question here, and move on. Never silently pick an answer
and never let one of these block a milestone.

1. **The timezone contradiction.** `weddings.timezone` says `America/Los_Angeles`, but the venue and
   the emails say Guadalajara. Every event time may already be an hour off, and now payment due
   dates depend on it too. **Do not change the value.** Build everything to read
   `weddings.timezone`, so that flipping one row fixes the whole app when she confirms.
2. **Currency.** The spreadsheet is in dollars, but the venue is in Mexico and some vendors will
   quote and invoice in pesos. Store `currency` per item, display as entered, do no conversion. Ask
   whether she wants peso vendors tracked in pesos with a display rate, or converted at entry.
3. **Is Alison's number private?** Her friend's real wedding costs are in this database. They should
   almost certainly not appear in any export Juliet forwards to a vendor or a parent. Default to
   **excluding the benchmark column from all exports** and flag it — the label should also be
   editable, so it can read "Reference wedding" rather than a real person's name if she prefers.
4. **Is $60,170 a forecast or a ceiling?** Zola's model separates "max spend" (the line you refuse
   to cross) from "total cost" (what things currently add up to). The spreadsheet only has the
   second. Ask for the first — the whole over/under health indicator depends on it.
5. **No contingency line exists.** Every credible source treats a 5–10% buffer as mandatory, and
   about 45% of couples overspend by an average of ~$7,000. Seed a Contingency category at 0 and ask
   her to fund it, rather than inventing a number that changes her totals.
6. **Hotels and Flights.** The spreadsheet has $3,433 of lodging and $2,800 of flights. Are these
   the couple's own travel, family travel they are paying for, or guest accommodation being tracked
   for information? It changes whether they belong in the wedding total at all.
7. **Default assigned owner.** Vendor records carry Juliet or Juan. Which is the default for a new
   vendor?
8. **Tax, service charge, gratuity, and delivery fees.** The research is blunt that omitting these
   is the single biggest reason wedding budgets blow up, and the spreadsheet does not break them
   out. Are the quoted numbers all-in, or plus tax and service?

---

## Blocked

Items that failed twice and were routed around. Each needs a human decision or an unblock.

*(none yet)*

---

## Iteration log

One line per iteration: what got built, what proved it, what was decided. Append; never rewrite.

| # | When | What shipped | Proof | Decisions / notes |
| --- | --- | --- | --- | --- |
| 0 | 2026-07-29 22:20 | Baseline measured before any work | `npm test` 250 passed / 26 files; `npx tsc --noEmit` clean; tree clean on `main` | Older docs claim 107 tests — stale. |
| 0b | 2026-07-29 22:34 | **Security fix, pre-loop:** invite-code lookup accepted SQL LIKE wildcards, so `AB%%` logged the caller into any household with a unique two-character prefix. Added `normalizeInviteCode` + 7 regression tests. Commit `e5716cf` on `feat/budget-vendors`. | `npm test` 257 passed / 26 files; `npx tsc --noEmit` clean | **257 is the regression tripwire from here on.** Milestone 0's first box is therefore already checked. Production stays vulnerable until this branch merges — flag it first thing. |
| 1 | 2026-07-29 23:00 | **Milestone 0 complete.** Scoping sweep (seating + comms + 4 others), seven seating actions guarded with typed results and a working alert, cache invalidation moved into the data layer, both deadline/timezone bugs fixed. | `npm test` **289 passed / 28 files**; `npx tsc --noEmit` clean; `npm run build` clean; greps 14 / 10 / 7 (gates ≥8 / ≥5 / =7). Browser at 1280px: admin pill reads "RSVPs close in 257 days" — hand-checked, 2026-07-29 → 2027-04-12 venue-local is 257 days. Guest page reads "12 de abril de 2027", no console errors. | **The adversarial verify pass earned its keep — it refuted 2 of 3 implementers and I fixed both myself.** (1) `rsvpDeadlineNotice` treated `delta <= 0` as closed, so for the *entire* final day — the real deadline is 23:59 Apr 12 venue-local — the header said "RSVPs closed" while the guest form kept accepting. The agent's own test pinned that wrong behaviour at 12 hours before cutoff. Now: closed is driven by the **instant**, wording by **calendar days**, and `delta === 0` renders "RSVPs close today". (2) `RsvpFlow` defaulted `timeZone ?? "UTC"` and the page never passed the prop, so the guest page rendered **April 13** — a date on which submissions are already rejected. Added `rsvp.getDeadlineContext()` (deadline + zone in one query), threaded it through, and made the prop **required** so a missing zone is now a compile error. Also fixed the Milestone 0 gate itself: `grep -c unstable_rethrow … is 7` is arithmetically unreachable (the import line makes 8 the floor) and had pushed an agent to reword a doc comment to satisfy it. |
| 2 | 2026-07-30 00:50 | **Milestone 1 complete.** Migration `0012_budget_vendors` applied to the live DB; `lib/format/money.ts`, `lib/data/budget-rules.ts`, `lib/data/vendor-rules.ts`, and the `budget.ts` / `vendors.ts` I/O shells written. | `npm test` **637 passed / 31 files** (from 289); `npx tsc --noEmit` clean. DB verified by the orchestrator directly, not from the agent's report: 4 tables × RLS on × 4 policies each; `apply_payment_schedule` and `set_vendor_contracted_price` both `anon`/`authenticated` execute = **false**; 248 guests and 161 households unchanged across the migration; 12 categories seeded with exactly 1 contingency. | Money is integer cents with `null` ("not priced") kept distinct from `0` ("spent nothing") throughout — conflating them distorts every delta. Composite FKs carry `wedding_id`, so cross-wedding parenting is impossible at the DB level even if app code has a bug. `weddings.budget_total_cents` is deliberately **null** — that is Open Question 4 and the UI must prompt rather than invent a ceiling. **Gate corrected:** the "no hardcoded benchmark name" check was a repo-wide grep for `alison`, which matches 18 legitimate guest-name fixtures (she is an invited guest as well as the benchmark). Rescoped to non-test source, where it correctly returns 0. |
