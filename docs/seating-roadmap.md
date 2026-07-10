# Seating — Product Roadmap Spec

**Status:** Deferred. Revisit **after the current client (Juliet & Juan) is situated / live.**
**Audience:** future multi-tenant SaaS product, not the single current wedding.
**Written:** 2026-07-05, from a competitive scan of Zola, The Knot, WeddingWire, Say I Do, Joy,
Aisle Planner, PerfectTablePlan, Prismm/Cvent, Wedibox, SeatYourself, TopTablePlanner, SeatLogic.

---

## 0. Why these four

Market reality (verified, SEO-fluff filtered):

- The marquee consumer apps are **weaker than their reputation**: Zola / WeddingWire / Say I Do
  ship drag-and-drop; **The Knot has no live tool** ("coming 2026"); Joy / Riley & Grey / Appy
  Couple have nothing.
- Across all consumer apps: **zero auto-seating, zero keep-apart rules, zero day-of check-in,
  near-zero guest-facing seat lookup.** Those live only in tiny single-purpose tools (Wedibox,
  SeatYourself) and pro planner software (Aisle Planner, PerfectTablePlan, Prismm).
- We already **beat Zola/Knot on data integration**: household-level drag, RSVP-gated draggables,
  per-table dietary badge, per-event charts, publish-to-guests, escort/place-card print.

So the roadmap is about **owning the gaps**, in priority order:

| # | Feature | Market gap it closes | Build size |
|---|---------|----------------------|-----------|
| 1 | Guest-facing "find your seat" | No consumer app has it; Wedibox's whole business | S |
| 2 | Caterer / BEO export | Top logistics pain; only pro tools do it | S |
| 3 | RSVP-reactive reseating | The market's #1 complaint; our structural edge | M |
| 4 | Confidence-first auto-seater | Nobody in the consumer tier has it | L |

Recommended sequence: **1 + 2 first** (days each, immediately demoable, no competitor parity),
then **3** (signature differentiator), then **4** (the "wow", largest build).

Explicitly **out of scope**: 3D walkthroughs / scaled CAD floor plans (Prismm/Merri). Wrong lane
for a couple-facing CRM. At most, cheap "venue prop" blocks (dance floor / head table) later.

---

## 1. Shared foundations (build once, all four depend on them)

These cut across features; do them as they're first needed rather than up front, but design for them.

### 1a. Relationship / constraint model  *(needed by #3 and #4)*
New table, tenant-scoped:

```
seating_constraints
  id            uuid pk
  wedding_id    uuid  not null            -- tenancy scope + RLS
  event_id      uuid  null                -- null = applies to all events
  kind          text  check in ('keep_together','keep_apart')
  guest_a_id    uuid  not null
  guest_b_id    uuid  not null
  created_by    uuid                      -- admin user
  created_at    timestamptz default now()
  unique (wedding_id, event_id, guest_a_id, guest_b_id, kind)
```

- Households already imply `keep_together` implicitly — the table is for **explicit exceptions**
  ("seat these two apart", "seat these two together across households").
- Validation runs the same way the current capacity guard does: check on assign, surface a
  non-blocking warning toast if violated (do **not** hard-block — planners override for reasons).

### 1b. Seat-level assignment  *(optional; upgrades #1 and print)*
`seat_assignments.seat_number` already exists and is always null today. Table-level is fine for v1
of every feature. Adopt seat-level only when we want "Table 4, Seat 3" on place cards / find-my-seat.
Keep it lazy.

### 1c. Per-event seating config  *(needed by #4, nice for #1/#2)*
Fold into the existing `events` row or a sibling `event_seating_settings`:
`meal_shown_to_guests bool`, `gender_alternate bool`, `optimizer_weights jsonb`. Avoids a config
table sprawl until SaaS needs per-tenant defaults.

### 1d. Multi-tenancy invariants (apply to ALL four)
- Every new table carries `wedding_id`; every query goes through `WeddingScope` /
  `forWedding(admin.weddingId)` exactly like `lib/data/seating.ts` does today. RLS is the backstop.
- **Guest-facing routes (feature #1) are the only public surface** — they must be isolated by an
  unguessable per-wedding token/slug and expose **only** events with `seating_published_at set`.
  No cross-tenant guest data can be reachable by iterating IDs.
- Optimizer / reflow jobs (features #3, #4) run server-side inside a single `WeddingScope`; never
  batch across tenants in one query.

---

## 2. Feature 1 — Guest-facing "find your seat"

**Validation:** Wedibox / SeatYourself are whole businesses built on just this. None of the 7
consumer apps do it. Static QR + live chart = edit day-of with zero reprints.

### UX
- Admin already has `seating_published_at` per event + a "Visible to guests" toggle. Extend that:
  publishing mints a **public seating URL** and a **printable QR poster** ("Scan to find your seat").
- Guest opens the link → single search box → types name → sees **"You're at Table 4"** (+ optional
  table-mates, + their meal). Works with no login/app.
- **Fuzzy match is the differentiator** (Wedibox nails this): typo-tolerant, nickname-aware
  ("Liz" → "Elizabeth"), partial-name. Guests fat-finger; first-try match is the whole UX.
- Static QR, live data: reassign during the reception and the guest's lookup updates instantly.

### Data / routing
- No new tables required for table-level. Add `weddings.public_seating_slug` (or reuse an existing
  per-wedding token) for the public route: `/(guest)/seat/[slug]`.
- Reuse the existing guest-token infra if one already scopes guest RSVP pages.
- Query: published events for that wedding → tables → assignments → guest names. Read-only,
  cache-light (`force-dynamic`, it's tiny).

### Multi-tenant notes
- Route resolves tenant from the slug, **not** from `DEFAULT_WEDDING_ID`. This is the first place
  the app must resolve a wedding per-request — a good forcing function for the SaaS tenant resolver.
- Rate-limit the search endpoint (reuse `lib/limiter.ts`) to prevent guest-list scraping.

### Fuzzy search
- Postgres `pg_trgm` similarity, or client-side (guest counts are small — a few hundred rows) with a
  Levenshtein/trigram match + a nickname map. Client-side keeps the name list on a published,
  intentionally-public page; acceptable since it's already publish-gated.

**Effort:** S (days). **Deps:** none. **Risk:** low. Demoable immediately.

---

## 3. Feature 2 — Caterer / BEO export

**Validation:** Aisle Planner & Prismm generate this; consumer apps don't. Caterers currently do
manual spreadsheet reconciliation. We already store everything needed.

### What it produces (one click, from the live chart)
- **Per-table meal sheet:** each table → guest → meal choice, with **meal counts per table**.
- **Kitchen summary:** total heads, per-meal totals across the room, kids' meals
  (`meal_options.is_kids_meal`) broken out.
- **Allergy / dietary list with locations:** every `dietary_restrictions` / `allergies` guest, their
  table (and seat, if 1b adopted) — so the caterer knows *where* the nut allergy is sitting.
- Format: printable PDF/HTML (match existing escort/place-card print routes under
  `app/admin/print/`) + CSV for the caterer's own tools.

### Data
- **No schema changes.** Joins existing `seat_assignments` × `guest_event_responses.meal_option_id`
  × `meal_options` × `guests.dietary_restrictions/allergies`, all `wedding_id`-scoped.
- New print route `app/admin/print/catering/[event]` + a data function
  `seating.cateringReport(scope, eventId)` returning `{ tables[], mealTotals, dietary[] }`.

### Multi-tenant notes
- Pure read within `WeddingScope`. Nothing tenant-special beyond the standard scoping.

**Effort:** S (days). **Deps:** none (independent of #1). **Risk:** low.

---

## 4. Feature 3 — RSVP-reactive reseating

**Validation:** The single loudest complaint in the whole market — late RSVPs / plus-ones force a
manual re-scan of the entire chart in Zola/Knot. We are the **CRM**, so we know the instant it
happens. Nobody does this well. This is the signature differentiator.

### UX
- A persistent **"Seating needs attention"** banner on the seating page when the chart has drifted
  from the RSVP truth. It names the drift, per affected table:
  - Guest declined after being seated → "Table 2 has an open seat (Grandma Rose declined)."
  - New attending guest / new plus-one, unseated → "The Nguyens' +1 (Anh) is unseated."
  - Guest switched events / meal changed → surfaced inline.
- **One-click reflow of only the affected tables** (never a full-chart reshuffle — that's what people
  hate). Show a **diff/preview** before applying: who moves where, what stays locked.
- Everything is a suggestion; the planner accepts/edits. Non-destructive.

### How drift is detected
- The truth: `guest_event_responses` (attending = yes) vs `seat_assignments`. We already compute
  `unassigned` and `attendingIds` in `SeatingCanvas`. Promote that to a server-side
  `seating.drift(scope, eventId)` returning structured deltas:
  `{ orphanedSeats[], unseatedAttendees[], mealChanges[] }`.
- Because plus-ones are already **idempotent** (recent fix `7a58993`), a new plus-one appears as a
  clean new attending guest — no dedup nightmare. This feature is already primed.

### Reflow logic (v1, before the full optimizer exists)
- Greedy + constraint-aware: place each unseated attendee at a table that (a) has room, (b) already
  seats their household, (c) doesn't violate a `keep_apart` from 1a. Fall back to any open table.
- Reuse the optimizer core from #4 once it exists — reflow is just "solve, but hold locked tables
  fixed."

### Data
- Uses 1a (constraints). Add `seat_assignments.locked bool default false` so planners can pin a
  table the reflow must not touch.
- Optional `activity.log` entries for each auto-move (we already have the audit trail).

### Multi-tenant notes
- Drift + reflow run inside one `WeddingScope`. If SaaS later adds background jobs (e.g. nightly
  drift digests / emails), they must iterate tenants **one scope at a time**, never a cross-tenant
  query.

**Effort:** M (1–2 weeks). **Deps:** 1a (constraints), benefits from #4's solver but doesn't
require it. **Risk:** medium (UX of the diff/preview is the hard part).

---

## 5. Feature 4 — Confidence-first auto-seater

**Validation:** PerfectTablePlan's genetic optimizer is the most impressive automation in the space;
Zola's "only auto-place when confident" framing is the trust model. No consumer-tier product has a
real solver. This is the "wow" and the largest build.

### Behavior
- **Confidence-first (the trust model):** auto-seat only the high-certainty groups — intact
  households, explicit `keep_together` pairs — and **leave ambiguous singles in the Unassigned tray**
  for the human. Never silently seat someone the model is unsure about. (Zola's insight: an AI that
  seats the divorced parents together once destroys all trust.)
- **Transparent:** show *why* — which constraints were satisfied/violated, per table. Not a black box
  (the small tools like SeatLogic are black boxes; that's a weakness to beat).
- **Tunable + iterative:** planner **locks** tables they like (`seat_assignments.locked`) and hits
  "re-solve around locks." Adjustable weights (keep-together strength, gender-alternate on/off,
  fill-evenly vs cluster).

### Algorithm
- Simulated annealing or a genetic approach over the assignment space (both are proven here —
  PerfectTablePlan uses genetic; academic write-ups use MILP/annealing). Scoring function:
  - `+` keep_together satisfied, household intact, table filled evenly, VIP prefs (weight ×3 like
    PerfectTablePlan)
  - `−` keep_apart violated, over/under capacity, orphaned plus-one, empty seats
- Runs server-side in an action; bounded by a time/iteration budget (user-configurable stop
  condition). Returns a proposed assignment set the UI previews before commit.
- Start simpler: a **greedy first-fit with constraint checking** ships value before the full
  metaheuristic and doubles as the #3 reflow engine.

### Data
- 1a (constraints), 1c (weights in `optimizer_weights jsonb`), `seat_assignments.locked`.
- A `seating_proposals` scratch concept (or just compute-and-preview in memory; persist only on
  accept) to avoid polluting real assignments during exploration.

### Multi-tenant notes
- CPU-bound. In SaaS, cap solver runtime per request and consider a queue so one tenant's 400-guest
  solve can't starve others. Weights are per-event/per-tenant config (1c).

**Effort:** L (multi-week). **Deps:** 1a, 1c, `locked`; shares its core with #3. **Risk:** high
(quality of output + runtime + the "explain why" UI).

---

## 6. Sequencing summary

```
Phase 1  (days)      Feature 1  find-my-seat        ── independent, public-route forcing function
         (days)      Feature 2  caterer/BEO export  ── independent, pure read
Phase 2  (1–2 wk)    1a constraints  → Feature 3    reactive reseating (greedy reflow)
Phase 3  (multi-wk)  1c weights + locked → Feature 4 auto-seater (promotes greedy → metaheuristic)
```

Features 1 and 2 are parallelizable and carry zero dependencies — ship them first for immediate,
competitor-beating demo value. 3 and 4 share the constraint model and the solver core, so 3's greedy
reflow is the on-ramp to 4.

## 7. Open questions to resolve at revisit
- Does a per-wedding public guest token already exist we can reuse for #1's route, or is a new
  `public_seating_slug` needed?
- Seat-level (1b) — do we want "Seat 3" on place cards, or is table-level enough for the product?
- For SaaS: where does the tenant resolver live once `DEFAULT_WEDDING_ID` goes away? Feature 1 is the
  first code path that must resolve a tenant per-request — design it there deliberately.
- Optimizer runtime budget + whether it needs a job queue at expected tenant scale.
