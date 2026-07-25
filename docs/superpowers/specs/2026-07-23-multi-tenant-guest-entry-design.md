# Multi-tenant guest entry & delivery — design

- **Date:** 2026-07-23
- **Status:** Approved (design); pending implementation plan
- **Scope:** Full multi-tenant build (NOT the current single-client "Juliet" delivery)

## Background

Today guests reach their RSVP two ways:

- **Invite code** — type the household `invite_code` → `households.byInviteCode` → guest session → redirect to `/rsvp/h/{access_token}` (`app/(guest)/rsvp/actions.ts` `enterWithCode`).
- **Find my invitation** — name + email fuzzy match → the app *emails* a per-household link (deliberate anti-enumeration; never opens the page directly) (`app/(guest)/rsvp/actions.ts` `findInvitation`).

The direct per-household route `/rsvp/h/{token}` already exists and requires no login — the token in the URL is the credential (`app/(guest)/rsvp/h/[token]/page.tsx`, saves via `saveRsvp` → `submit_rsvp` RPC).

The full multi-tenant product needs a **shared, no-email entry point**: guests arrive from the couple's own wedding website (or a shared QR on paper invites) with no per-guest email and no per-guest code. They identify themselves by typing a household member's name. The schema is already multi-tenant — every domain table carries `wedding_id`, and `weddings` has a `slug` (`supabase/migrations/0001_init.sql`).

## Product boundary

Our product is the **RSVP + guest-CRM layer**, not a public wedding-website builder. The couple keeps whatever public website they already have (Squarespace, Wix, a planner's site) and links into our app. Public guest surface is exactly two routes:

- `/{slug}/rsvp` — shared name-search entry (**new**)
- `/rsvp/h/{token}` — direct per-household entry (**exists**)

Everything downstream — the RSVP flow, autosave, `saveRsvp` → `submit_rsvp` RPC, meals, plus-ones, party-size caps — is reused unchanged. Once a guest is resolved to a household, they are handed to the existing flow exactly as if they had arrived via a token.

## Decisions

1. **Tenant identified by path slug:** `app.com/{slug}/rsvp`, using `weddings.slug`. No subdomain (avoids wildcard DNS/TLS), no query param (easy to strip/lose).
2. **Name matching is fuzzy + confirm:** reuse `households.fuzzyFind`, scoped to the resolved `wedding_id`, then show a confirmation card before entry. No silent wrong-household matches.
3. **Second factor only on collision:** a unique name match enters immediately (the common case). A name matching 2+ households prompts for a **partner / other household member name** to disambiguate — the gap every competitor leaves open.
4. **Rate-limit + temporary lockout** on repeated failed name searches (Zola's pattern — the one enumeration defense competitors ship).
5. **Three delivery modes**, selectable per wedding; per-household QR generation is included in this spec; **SMS is deferred**.
6. **Out of scope:** public wedding-website hosting; per-guest (vs per-household) tokens; seating features (already parked in `docs/seating-roadmap.md`).

## Architecture

### Tenant resolution

`{slug}` → look up `weddings.slug` → `wedding_id`. That `wedding_id` scopes every subsequent query (name search, household lookup, session).

- **Unknown/invalid slug** → friendly dead-end page: "You need your couple's RSVP link — check your invitation or their website," plus an optional, **rate-limited** "search by couple's names" fallback.
- **Bare `/rsvp` with no slug** → same dead-end + couple-name search.

The couple-name search returns at most a small set of matching weddings by `couple_names`; it is rate-limited and never lists the full wedding directory.

### Name sign-in flow

```
/{slug}/rsvp
  → guest types a household member's full name
  → households.fuzzyFind(wedding_id, name)
  ├─ 0 matches  → "We couldn't find you" + retry (counts toward lockout)
  ├─ 1 match    → confirm card: "Is this you? The Smith household — Michael & Sarah"
  │                 [Yes] → enter    [No] → back to search
  └─ 2+ matches → disambiguation: "Who are you attending with?"
                    (partner / other household member name)
                    → resolves to exactly one household → confirm card → enter
  → issue existing guest session (lib/guest-session.ts) scoped to that household
  → redirect into the existing household RSVP flow (/rsvp/h/{token} internals reused)
```

The confirmation card shows the household `display_name` and its members' first names so the guest can verify before entering.

### Abuse protection

- Per-(wedding, IP) counter on failed name searches; after N failures within a window, temporary lockout (~15–20 min), matching Zola.
- The confirm step prevents silent wrong-household entry from a loose fuzzy match.
- **Accepted tradeoff:** confirming reveals a household's member first names to someone who typed a matching name. Acceptable for a wedding threat model and gated by rate-limiting.

### Delivery modes (per-wedding, planner-dependent)

The product supports all three; each wedding uses whatever its planner/couple allows:

1. **Shared link** — couple's website → `/{slug}/rsvp` (name search). The constrained "one shared QR" mode (the Juliet reality). No per-guest data on the invite.
2. **Per-household direct link/QR** — `/rsvp/h/{token}` + **QR-image generation** for that URL, surfaced on the admin household page (next to the existing "Copy RSVP link" button) and via a **bulk print/export view** for admins. Requires adding a QR library (none present today). This is the previously deferred per-household QR feature; it lives here.
3. **Email / SMS per-household links** — email pipeline already exists (`lib/email/send.ts`, per-household `access_token` links). **SMS is a new provider dependency (e.g. Twilio) and is deferred** — flagged as a follow-up, not part of this build.

## What exists vs. what's new

**Reused as-is:** `/rsvp/h/{token}` page and actions, `saveRsvp`/`submit_rsvp` RPC, guest session (`lib/guest-session.ts`), `households.fuzzyFind`/`byAccessToken`/`byInviteCode`, email templates, multi-tenant schema (`wedding_id` everywhere, `weddings.slug`).

**New:**
- `/{slug}/rsvp` route + name-search / confirm / disambiguation UI.
- Slug → `wedding_id` resolution and a shared "wedding scope" for guest queries.
- Rate-limit / lockout mechanism for name search.
- Missing/invalid-slug dead-end page + rate-limited couple-name search.
- QR-image generation (new dependency) + admin household QR display + bulk print/export view.
- Per-wedding delivery-mode configuration.

## Open implementation questions (for the plan, not blocking design)

- **Route layout / collision:** how `/{slug}/rsvp` coexists with the existing `/rsvp/h/{token}` and the legacy `/rsvp` (code + find-invitation) under `app/(guest)/`. Decide canonical vs. legacy entry.
- **Rate-limit store:** where the failed-attempt counter lives (DB table vs. edge/middleware store).
- **QR library choice** and whether QR rendering is server- or client-side.
- **Session scoping:** confirm the existing guest session shape carries `wedding_id` + household cleanly for the name-entry path.

## Testing considerations

- Fuzzy match: nicknames, accents, typos, case; 0 / 1 / many results.
- Collision disambiguation resolves to exactly one household; wrong partner name fails gracefully.
- Lockout triggers after N failures and clears after the window.
- Unknown slug, bare `/rsvp`, and stale slug all reach the dead-end + search.
- Cross-tenant isolation: a name search under wedding A never returns households from wedding B.
- Per-household QR resolves to the correct `/rsvp/h/{token}` and enters the right household.
