# Admin Usability Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four audit blockers — safe sends, visible mailing addresses, one live search, mobile admin — per `docs/superpowers/specs/2026-07-26-admin-usability-blockers-design.md`.

**Architecture:** Pure logic lands in `lib/` with vitest coverage (search matcher, address update resolution, recipient split, review guard). UI work converts three server-rendered fragments into small client components (guest list, header search, campaign composer) and retrofits Tailwind `max-md:`/`md:` classes onto the existing layout. No schema changes; `MailingAddress.source` gains `"admin"` at the type level only (jsonb column).

**Tech Stack:** Next.js App Router (repo-pinned version — read `node_modules/next/dist/docs/` before route/actions work), Tailwind v4 classes, vitest, existing Supabase data layer (`lib/data/*` via `WeddingScope`).

## Global Constraints

- Desktop layout must be pixel-identical; all mobile work behind `max-md:` variants (breakpoint 768px).
- Addresses are never parsed — free text stored verbatim as `{raw, source:"admin"}` (spec §2).
- No vendor names or internals in UI copy ("Resend", "webhooks").
- Every `security definer` concern is untouched — no new RPCs in this plan.
- All copy in plain language; match existing tone ("Nothing is saved until you say so").
- `npm test`, `npx tsc --noEmit`, `npm run build` green at every commit.

---

### Task 1: Shared search matcher

**Files:**
- Create: `lib/search/guest-query.ts`
- Test: `lib/search/guest-query.test.ts`

**Interfaces:**
- Produces: `normalizeQuery(s: string): string`; `matchesGuestQuery(query: string, h: SearchableHousehold): boolean`; `type SearchableHousehold = { display_name: string; email: string | null; phone: string | null; guests: Array<{ first_name: string; last_name: string }> }`.

- [ ] **Step 1: Write failing tests** — diacritics (`huyen` matches `Huyền Nguyen`), partial first/last name, household display name, email substring, phone digit-run (`4258` matches `(425) 890-1026`), multi-token query requires all tokens (`ali irwin` matches Alison Aw-Irwin, `ali smith` doesn't), blank query matches everything.
- [ ] **Step 2: Run `npx vitest run lib/search` — expect FAIL (module missing).**
- [ ] **Step 3: Implement** — NFD + strip `\p{M}`, lowercase, split query into tokens; a household matches when every token hits at least one haystack field; phone haystack is digits-only.
- [ ] **Step 4: Run `npx vitest run lib/search` — expect PASS.**
- [ ] **Step 5: Commit** `feat(search): shared diacritic-insensitive guest matcher`

### Task 2: Guests page filters live as you type

**Files:**
- Create: `components/admin/GuestList.tsx` (client)
- Modify: `app/admin/(dashboard)/guests/page.tsx` (rows → serializable props; drop the search `<form>` + button; fix "1 households" pluralization)

**Interfaces:**
- Consumes: `matchesGuestQuery` (Task 1).
- Produces: `<GuestList rows={GuestListRow[]} initialQuery={string} filter={HouseholdFilter} canDelete={boolean} />` where `GuestListRow = { id, display_name, guests: {first_name,last_name}[], email, phone, max_party_size, plus_one_slots, rsvp_status, invite_code }`. Delete stays via existing `ConfirmButton` + `deleteHousehold` bind per row.

- [ ] **Step 1:** Build `GuestList`: local `query` state seeded from `initialQuery`; `useMemo` filter via `matchesGuestQuery`; input (no button) with the existing placeholder; keep URL shareable with `router.replace(…?q=…&filter=…, { scroll: false })` debounced ~250ms; render the existing table markup unchanged at `md+`; count line "X household**s** · Y guests" with proper singulars.
- [ ] **Step 2:** Page keeps server `filter` (chips still links, they reload with filter applied) but passes the full filtered-by-chip row set; text filtering is client-only.
- [ ] **Step 3:** Browser-verify: type "huyen" → Cau Tuan Huyen appears without Enter; chip + query compose; URL carries `?q=`.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`; commit `feat(guests): live search over the guest list`.

### Task 3: Real header search

**Files:**
- Create: `components/admin/HeaderSearch.tsx` (client), `app/admin/(dashboard)/search-actions.ts` (`"use server"`)
- Modify: `app/admin/(dashboard)/layout.tsx:41-48` (replace the fake-input `Link`)

**Interfaces:**
- Consumes: `matchesGuestQuery` (Task 1), `households.list(scope)` (existing).
- Produces: server action `fetchDirectory(): Promise<DirectoryEntry[]>` with `DirectoryEntry = { id, display_name, guests: string[], email: string | null, phone: string | null, rsvp_status }`; component `<HeaderSearch />`.

- [ ] **Step 1:** `fetchDirectory` = `requireAdmin()` + `households.list(defaultScope())` mapped to `DirectoryEntry` (guest names pre-joined).
- [ ] **Step 2:** `HeaderSearch`: fetches the directory once on first focus (`useRef` cache); dropdown shows top 8 matches (name, guest names line, status chip); ↑/↓ + Enter selects → `router.push('/admin/guests/'+id)`; Enter with nothing highlighted → `/admin/guests?q=…`; Escape/blur closes; empty-result row "No one matches “…”".
- [ ] **Step 3:** Replace the layout's `Link` with `<HeaderSearch />` keeping the pill styling.
- [ ] **Step 4:** Browser-verify typing, arrows, Enter, Escape; commit `feat(admin): header search is a real live search`.

### Task 4: Mailing address on the household page

**Files:**
- Create: `lib/domain/mailing-address.ts`, `lib/domain/mailing-address.test.ts`
- Modify: `lib/csv/types.ts:41` (`source: "csv" | "save_the_date" | "admin"`), `components/admin/HouseholdEditor.tsx`, `app/admin/(dashboard)/guests/actions.ts` (updateHousehold), `app/admin/(dashboard)/guests/[id]/page.tsx` (pass `mailingAddress`)

**Interfaces:**
- Produces: `formatMailingAddress(a: MailingAddress | null): string` (raw verbatim, else structured lines joined with `\n`); `provenanceLabel(a): string | null` ("from the Save-the-Date form" | "from your spreadsheet import" | "edited by you"); `resolveAddressUpdate(prev: MailingAddress | null, submitted: string): MailingAddress | null | undefined` — `undefined` = unchanged (skip write), `null` = cleared, object = `{ raw: submitted, source: "admin" }`.

- [ ] **Step 1: Failing tests** for all three functions: raw round-trip unchanged → `undefined`; structured prev formatted then unedited → `undefined`; edited text → `{raw, source:"admin"}` with newlines preserved verbatim; emptied → `null`; provenance strings for all three sources and null.
- [ ] **Step 2:** vitest FAIL → implement → PASS.
- [ ] **Step 3:** `HouseholdEditor`: "Mailing address" textarea (rows=3) defaulting to `formatMailingAddress`, quiet provenance line under it; hidden input `mailing_address_prev` carrying the formatted original for the server-side diff.
- [ ] **Step 4:** `updateHousehold`: compute `resolveAddressUpdate` from the two fields; include `mailing_address` in `households.update` only when not `undefined`.
- [ ] **Step 5:** Browser-verify on Aw-Irwin (shows the Seattle form address + "from the Save-the-Date form"), edit, save, reload, provenance flips to "edited by you". `npm test`; commit `feat(guests): mailing address visible and editable`.

### Task 5: Campaign review logic

**Files:**
- Create: `lib/domain/campaign-review.ts`, `lib/domain/campaign-review.test.ts`
- Modify: `app/admin/(dashboard)/comms/actions.ts`

**Interfaces:**
- Consumes: `households.search`, `needsReminder` filter semantics already in `sendCampaign` (reuse by extracting).
- Produces: `splitRecipients(hs: {display_name, email}[]): { emailable: T[]; skipped: T[] }`; `reviewToken(count: number, audience: string, type: string): string` (base64 JSON) + `tokenMatches(token, count, audience, type): boolean`; server actions `reviewCampaign(fd): Promise<CampaignReview>` with `CampaignReview = { token, count, skippedNames: string[], previews: Array<{locale, subject, html}> }` and `sendTestToMe(fd): Promise<void>`; `sendCampaign` gains a required `review_token` field and refuses on mismatch with a thrown, user-readable error.

- [ ] **Step 1: Failing tests** — split on null/empty email; token round-trip; mismatch when audience count changed.
- [ ] **Step 2:** Implement; extract the existing audience-resolution block from `sendCampaign` into `resolveAudience(scope, audience)` so review and send share it; previews rendered with the existing `invitationHtml`/`reminderHtml`/`emailShell` per distinct locale among recipients.
- [ ] **Step 3:** `sendTestToMe`: renders for the admin's locale=en, subject prefixed `[Test] `, `sendEmail({ to: admin.email … })`, no `comms.create`.
- [ ] **Step 4:** vitest PASS; commit `feat(comms): review-before-send actions`.

### Task 6: Campaign composer UI

**Files:**
- Create: `components/admin/CampaignComposer.tsx` (client)
- Modify: `app/admin/(dashboard)/comms/page.tsx` (compose form → component; copy fixes)

**Interfaces:**
- Consumes: `reviewCampaign`, `sendCampaign`, `sendTestToMe` (Task 5).

- [ ] **Step 1:** Composer state machine: `editing → reviewing → sent`. Buttons while editing: **Send a test to me** (secondary) · **Review campaign** (primary). Review panel: count sentence, skipped names (collapsed after 5 with "and N more"), iframe `srcdoc` preview with locale tabs when >1, **Send to N households** · **Back to editing**. Any field `onChange` while reviewing → back to `editing` (review token dropped, send disabled).
- [ ] **Step 2:** Copy: "Email (Resend)" → "Email"; footer line → "Sent in each guest's language with their personal RSVP link."; success state shows "Sent to N households" and refreshes History.
- [ ] **Step 3:** Browser-verify the full loop with audience "Declined" (1 household, safe) — review shows count + preview; then **real test-send to me** and confirm receipt in History-free inbox; never fire the real send.
- [ ] **Step 4:** `npm test`, `tsc`, build; commit `feat(comms): review-then-send composer with test sends`.

### Task 7: Responsive shell (layout + sidebar)

**Files:**
- Modify: `app/admin/(dashboard)/layout.tsx`, `components/admin/AdminSidebar.tsx`, `components/admin/SideNav.tsx`

- [ ] **Step 1:** Sidebar: `max-md:hidden` for the static rail; add client drawer state in `AdminSidebar` — hamburger button (rendered into the header via a small client `MobileNav` wrapper or lifted state) opens `fixed inset-y-0 left-0 z-40 w-72` panel + scrim (`bg-black/30`, tap closes); close on route change (`usePathname` effect).
- [ ] **Step 2:** Header: `px-9` → `px-4 md:px-9`; search pill `w-[320px]` → `w-full max-w-[320px] max-md:max-w-none max-md:flex-1`; deadline chip `max-md:hidden`; "＋ New household" keeps only the ＋ below `md` (`max-md:px-3` with `<span className="max-md:hidden">New household</span>`).
- [ ] **Step 3:** `<main>` padding `px-4 py-5 md:px-9 md:py-7`.
- [ ] **Step 4:** Browser-verify at 390px (via device toolbar or narrow window): drawer opens/closes, nothing overflows horizontally on Overview. Commit `feat(admin): responsive shell with drawer nav`.

### Task 8: Responsive content screens

**Files:**
- Modify: `components/admin/GuestList.tsx` (card variant), `app/admin/(dashboard)/guests/[id]/page.tsx`, `components/admin/HouseholdEditor.tsx`, `components/admin/MetricCards.tsx`, `app/admin/(dashboard)/page.tsx`, `app/admin/(dashboard)/comms/page.tsx`, `app/admin/(dashboard)/meals/page.tsx`, `app/admin/(dashboard)/team/page.tsx`

- [ ] **Step 1:** `GuestList`: table gets `max-md:hidden`; add `md:hidden` stacked cards — whole card is a `Link` to the household (name, guest names, status chip); filter chips row `max-md:flex-nowrap max-md:overflow-x-auto`.
- [ ] **Step 2:** Household page: outer `flex` → `max-md:flex-col`; right rail `w-[420px]` (or current) → `max-md:w-full`; `HouseholdEditor` name/email/phone row → `max-md:flex-col`, fixed widths → `max-md:w-full`.
- [ ] **Step 3:** Overview: metric grid → `grid-cols-2 md:grid-cols-4`; panels row → `max-md:flex-col`. Comms: selects row → `max-md:flex-col`. Meals/Team: verify, spot-fix overflow only.
- [ ] **Step 4:** Browser-verify each at 390px + 1440px unchanged; commit `feat(admin): phone layouts for core screens`.

### Task 9: Seating on phones — view + assign

**Files:**
- Modify: `components/admin/SeatingCanvas.tsx`
- Create: `components/admin/MobileAssignSheet.tsx`

**Interfaces:**
- Consumes: SeatingCanvas's existing table list, unassigned-household list, and its existing assign/unassign handlers (reuse the same callbacks the drag path uses — do not duplicate persistence logic).

- [ ] **Step 1:** Add `useIsMobile()` (matchMedia `(max-width: 767px)`) inside SeatingCanvas; when true: canvas renders scaled-to-fit and inert (no drag handlers), tables become tap targets showing name + seat count.
- [ ] **Step 2:** `MobileAssignSheet`: bottom sheet listing this table's households (tap to unassign) and the Unassigned list (tap to assign here), using the existing handlers; note at top: "Arrange tables on a computer — here you can seat people."
- [ ] **Step 3:** Browser-verify at 390px: assign + unassign round-trip persists (reload); desktop drag unchanged at 1440px.
- [ ] **Step 4:** Commit `feat(seating): view-and-assign on phones`.

### Task 10: Full verification pass

- [ ] **Step 1:** `npm test` (expect prior suite + new: ≥ 110), `npx tsc --noEmit`, `npm run build` — all green.
- [ ] **Step 2:** Browser sweep at 1440px and 390px: Overview, Guests (+search), a household (address edit), Events, Comms (review + test send), Meals, Imports, Seating, Team. Screenshot each mobile screen.
- [ ] **Step 3:** Fix anything found, re-run, final commit `chore: verification pass for usability blockers`.

## Self-review notes

- Spec §1 → Tasks 5–6; §2 → Task 4; §3 → Tasks 1–3; §4 → Tasks 7–9; testing section → Tasks 1, 4, 5, 10. No gaps.
- Type names consistent: `SearchableHousehold` (T1) consumed by T2/T3 via `matchesGuestQuery`; `CampaignReview` (T5) consumed by T6; `resolveAddressUpdate` semantics (T4) used in the same task's action edit.
- The events invite matrix already filters live and is untouched — consistency achieved by upgrading the other two surfaces to its behavior.
