# Event Management Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let Juliet add, edit, reorder and delete her own wedding events, and choose which households are invited to each — without a developer writing a migration.

**Architecture:** A new `lib/data/events.ts` owns I/O; a pure `lib/data/event-rules.ts` owns the logic worth testing (deletion impact, invite diffing, form validation) since vitest covers only `lib/**`. A new `/admin/events` route holds the list and form. The invite matrix is reachable from both the event and the household, because she thinks in both directions.

**Tech Stack:** TypeScript, Next.js 16.2.10, React 19, vitest, Tailwind, Supabase/Postgres with RLS.

## Global Constraints

- **The schema already supports this.** `events`, `household_event_invites`, `guest_event_responses`, event-scoped `meal_options` all exist. One migration adds `visibility`; nothing else changes.
- **Migrations `0001`–`0006` are applied to a live database.** `supabase db push` refuses to re-apply a recorded migration — new SQL goes in a **new** file. Use `create or replace function`, never `drop` + `create`: replace preserves privileges, drop-and-recreate silently restores Supabase's default `EXECUTE` grant to `anon`. Any new `security definer` function needs `revoke execute … from public, anon, authenticated`.
- **Deleting an event with responses is the most dangerous action in this feature.** A verified user report describes a competitor silently wiping RSVPs and meal choices during a routine bulk action, with no undo. It must state the true cost and require typed confirmation.
- **No mandatory "main event" hierarchy.** Any household may be invited to any subset — including a rehearsal dinner without the reception. That asymmetric case is a confirmed competitor failure and must round-trip.
- **Test command:** `npx vitest run`; `include` is `lib/**/*.test.ts`. **All 107 existing tests must pass untouched.** Components and pages aren't covered — `tsc`, `npm run build`, and driving a browser are their verification.
- **Read `node_modules/next/dist/docs/` before touching any Next.js API.** This repo's Next.js differs from public docs and from training data.
- This toolchain drops the leading space of a JSX text node wrapping to a second line — it once shipped `"seats areheld"`. Build strings as single expressions. See the comment in `ReviewStep.tsx`.
- Palette: `olive-deep`, `hairline`, `muted`, `sage-band`, `blush`, raw hex like `#dddbd0`, `#6b7167`. Warm and editorial, not a SaaS dashboard. Follow `app/admin/(dashboard)/meals/page.tsx` and `components/admin/import/*` for house style.
- Never run broad name-based process kills. To free a port: `lsof -ti:<port> | xargs kill`. A dev server runs detached on 3006 — use it, don't kill it.
- **Production is live** at `rsvp.julietandjuan.com`. The database holds only seed data (1 wedding, 3 households, 8 guests) — leave it that way.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0007_event_visibility.sql` | `visibility` column + the Rehearsal Dinner event |
| `lib/data/event-rules.ts` | **Pure.** Deletion impact, invite diffing, form validation |
| `lib/data/event-rules.test.ts` | Unit tests — where the logic that matters lives |
| `lib/data/events.ts` | I/O: list, create, update, reorder, delete, invite toggles |
| `app/admin/(dashboard)/events/page.tsx` | The list |
| `app/admin/(dashboard)/events/actions.ts` | Server actions |
| `components/admin/events/EventForm.tsx` | Add/edit |
| `components/admin/events/InvitePicker.tsx` | The household ↔ event matrix |
| `components/admin/events/DeleteEventButton.tsx` | The guarded delete |
| `components/admin/AdminSidebar.tsx` | Nav entry |
| `app/admin/(dashboard)/guests/[householdId]/page.tsx` | Per-household event checkboxes |

---

### Task 1: Migration + pure rules

**Files:** Create `supabase/migrations/0007_event_visibility.sql`, `lib/data/event-rules.ts`, `lib/data/event-rules.test.ts`

- [ ] **Step 1: Write the migration.**

```sql
alter table events
  add column if not exists visibility text not null default 'all'
  check (visibility in ('all', 'invited_only'));

insert into events (wedding_id, name, visibility, rsvp_enabled, sort_order)
select '11111111-1111-1111-1111-111111111111', 'Rehearsal Dinner', 'invited_only', true, 2
where not exists (
  select 1 from events
  where wedding_id = '11111111-1111-1111-1111-111111111111' and name = 'Rehearsal Dinner'
);
```

Default `'all'` preserves current behaviour for Ceremony and Reception. The insert is guarded so re-running is safe.

- [ ] **Step 2: Write failing tests for the pure rules.** Cover:
  - `deletionImpact(eventId, invites, responses)` → `{ households, replied, mealsChosen }`. **The counts must be exact** — the confirmation dialog states them, and a number that doesn't match what's actually deleted is worse than no number.
  - An event with zero responses reports zeros and is safe to delete without typed confirmation.
  - `inviteDiff(currentHouseholdIds, selectedHouseholdIds)` → `{ toAdd, toRemove }`, with no spurious churn when the selection is unchanged.
  - `validateEvent({ name, startsAt, endsAt })` — name required and trimmed; everything else optional; an end before its start is an error.
  - An event with a name of only whitespace is invalid.

- [ ] **Step 3: Run tests, confirm they fail.**
- [ ] **Step 4: Implement `lib/data/event-rules.ts`.** Pure — no I/O, no React, no `Date.now()`.
- [ ] **Step 5: Prove the tests have teeth.** Break `deletionImpact` to count all responses rather than the event's, and confirm a test fails. Restore. Report it. *(Earlier work here repeatedly shipped tests that passed against wrong implementations.)*
- [ ] **Step 6:** `npx vitest run` (107 + yours), `npx tsc --noEmit`. Apply the migration with `supabase db push`. **Then re-verify the anon probe still returns `42501` on `import_households`** — confirming nothing regressed the earlier revoke. Commit.

---

### Task 2: Data layer

**Files:** Create `lib/data/events.ts`

- [ ] **Step 1:** Implement against `WeddingScope`, following the shape of `lib/data/households.ts`:
  - `list(scope)` — events with invited-household and responded counts, ordered by `sort_order`
  - `create(scope, input)`, `update(scope, id, input)`, `remove(scope, id)`
  - `reorder(scope, orderedIds)`
  - `invitedHouseholdIds(scope, eventId)` and `setInvites(scope, eventId, householdIds)` — using `inviteDiff` so unchanged selections write nothing
  - `impactOf(scope, eventId)` — the real counts for the delete confirmation
- [ ] **Step 2:** Every function takes `WeddingScope` and filters on `wedding_id`. This is the tenancy guarantee; RLS is the backstop.
- [ ] **Step 3:** `npx tsc --noEmit` clean. Commit.

---

### Task 3: The events screen

**Files:** `app/admin/(dashboard)/events/{page,actions}.tsx`, `components/admin/events/{EventForm,DeleteEventButton}.tsx`, sidebar entry

**Invoke the `frontend-design` skill.**

- [ ] **Step 1: The list.** Each event shows name, when, where, how many households invited, how many replied. Drag to reorder. An **Add event** button. An event with nobody invited says so plainly rather than looking finished.
- [ ] **Step 2: The form.** Plain language, only the name required:
  > **What is it?** with quick presets — Welcome Party · Rehearsal Dinner · Ceremony · Reception · Farewell Brunch
  > **When?** date and time, both optional
  > **Where?** venue name and address, optional
  > **What should people wear?** optional
  > **Who's invited?** *Everyone* / *Only some households*
  > **Collect RSVPs for this?** yes/no

  No required-field asterisks — say what's needed in words if it's missing.
- [ ] **Step 3: The guarded delete.**
  - No responses → a normal confirm.
  - Responses exist → state the true cost: *"14 households have already replied to Rehearsal Dinner, and 3 have chosen meals. Deleting it removes those replies permanently."* Require typing the event name.
  - Disabling RSVP on an event with responses warns but retains them.
- [ ] **Step 4:** Add the sidebar entry between Guests and Meals.
- [ ] **Step 5:** Page-level auth uses `requireEditorPage()` (redirects), **not** `requireEditor()` (throws — it's an action gate, and using it on a page crashed viewers once). Server actions keep `requireEditor()`.
- [ ] **Step 6:** `npx vitest run`, `npx tsc --noEmit`, `npm run build` — clean. Commit.

---

### Task 4: The invite matrix

**Files:** `components/admin/events/InvitePicker.tsx`, plus the household detail page

- [ ] **Step 1: From the event.** A searchable household list with checkboxes, **Select all**, and selection by existing tag — the importer already produced `family:…` and list tags. Selecting a tag **expands into individual checkboxes** rather than saving a rule, so there is no invisible state and she can then uncheck one.
- [ ] **Step 2: From the household.** On `guests/[householdId]`, a short list of events with checkboxes. Same data, opposite direction.
- [ ] **Step 3:** Changes apply immediately and are reversible; counts on the events list follow.
- [ ] **Step 4:** `npm run build` clean. Commit.

---

### Task 5: Verify by using it

**The point of the task.** A previous feature here passed 95 tests and thirteen reviews and shipped unusable, because nobody drove it until the end.

Playwright isn't installed. Install temporarily, then restore with `git checkout package.json package-lock.json && npm ci` so `git status` ends clean. `npm ci` drops the dev server — restart it detached and confirm it serves.

- [ ] **Step 1:** Sign in (`node scripts/dev-login.mjs`), open `/admin/events`.
- [ ] **Step 2:** Create a **Welcome Party** with only a name. Confirm it saves and appears.
- [ ] **Step 3:** Invite two of the three seed households. Confirm the count reads 2, and that the third is genuinely not invited.
- [ ] **Step 4: The asymmetric case.** Invite a household to the Rehearsal Dinner but **not** the Reception. Confirm it round-trips — this is the case a competitor's hierarchy makes impossible.
- [ ] **Step 5:** Open that household's page and confirm its event checkboxes agree with what you set from the event side.
- [ ] **Step 6:** Reorder events; reload; confirm the order persisted.
- [ ] **Step 7: The dangerous one.** Give an event a response (insert directly with the service-role key), then delete it. Confirm the dialog states the **true** count, that typing the wrong name doesn't proceed, and that the right name does — and that the count matched what was actually removed.
- [ ] **Step 8:** Delete the Welcome Party and any test invites. **Database must end at 1 wedding, 3 households, 8 guests, 0 imports, and exactly 3 events** (Ceremony, Reception, Rehearsal Dinner). Verify and report.
- [ ] **Step 9:** Screenshots into the scratchpad: `events-list.png`, `event-form.png`, `invite-picker.png`, `delete-guard.png`.
- [ ] **Step 10:** Report honestly — what would confuse Juliet, what's mislabelled, what would make her stop and ask someone. "This part is still bad" is worth more than a clean pass.

---

## Out of scope

Per-guest invite overrides within a household (a real need, but a schema change — recorded in the spec), event-scoped meal options in this UI, and any guest-facing schedule page.
