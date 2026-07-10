# Guest CRM — Delivery Handoff

_Last updated: 2026-07-09 (delivery to Juliet & Juan)._

This doc is the single source of truth for handing the project off — to the client, or to a future working session. If you're an agent picking this up: read this file, then `docs/seating-roadmap.md` for deferred work.

## Live environment

- **Production app:** https://guest-crm-camrens-projects-24b42280.vercel.app
- **Guest RSVP entry:** `/rsvp` (code entry) and `/rsvp/h/[token]` (direct household links)
- **Admin dashboard:** `/admin` (magic-link login at `/admin/login`)
- **Hosting:** Vercel project `guest-crm` (team `camrens-projects-24b42280`). No git remote — deploys are `vercel --prod` from the local checkout.
- **Database/auth:** Supabase. The MCP server and local CLI are linked to the *wrong* project/account — use the service-role key in `.env.local` for any admin API work (see `scripts/`).

## Giving the client access

```
node scripts/invite-admin.mjs juliet@example.com --role editor --link
```

Sends a Supabase invite email (custom template in `supabase/templates/invite.html`) and inserts their `wedding_members` row. `--link` also prints a direct sign-in URL (~1 hour validity) you can text them if email delivery is slow.

The admin auth callback accepts both PKCE (`?code=`) and `token_hash` links, so admin-generated links work without the email round-trip.

## What shipped in this delivery

- **Admin UX overhaul:** new sidebar (`AdminSidebar`), add-guest form, confirm-before-destructive-action button (replaces the old `Button`), dashboard layout rework.
- **Seating canvas:** major interaction improvements (~285 lines changed).
- **Guest RSVP flow:** reworked flow; plus-one saves are idempotent (autosave no longer consumes a second slot); friendly localized error messages (en/es/vi).
- **Invitation rules:** `openPlusOneSlots()` (UI never offers a slot the server would reject) and `normalizeHouseholdRules()` (party-size cap always fits named guests + granted plus-ones). Covered by tests.
- **Prod auth fixes:** Supabase `site_url` + redirect allow-list point at the production URL; no cookie writes during server-component render.
- **Ops scripts:** `scripts/invite-admin.mjs` (client access), `scripts/dev-login.mjs` (local login without email).

Verified at delivery: 42/42 tests pass, clean production build.

## Pending — do NOT forget

1. **Invite email template not yet live.** `supabase/config.toml` + `supabase/templates/invite.html` need `supabase config push`, blocked because the CLI is linked to the wrong Supabase project. Until pushed, invites use the default Supabase template. Fix the CLI link (`supabase link --project-ref <correct ref>`) then push.
2. **Save-the-date guest import — DO NOT RUN YET.** Waiting on ~200 more responses in the Google Sheet. When ready: declines map to `rsvp_status = 'declined'`. See memory note / import tooling in `lib/data/imports.ts`.
3. **Seating roadmap deferred** until this client is live — spec in `docs/seating-roadmap.md`.

## Local development

```
npm run dev          # Next.js on port 3006
npm run dev:login    # print a direct admin sign-in URL (bypasses email)
npm test             # vitest
```

Heads-up: this repo's Next.js version has breaking changes vs. public docs — read `node_modules/next/dist/docs/` before writing code (see `AGENTS.md`).
