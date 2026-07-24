# Admin roles, team invites & branded email — design

- **Date:** 2026-07-24
- **Status:** Draft — pending approval
- **Scope:** Current single-client Juliet & Juan delivery. Multi-tenant sender config is explicitly a follow-up (see [Follow-up](#follow-up-multi-tenant-sender-config)); guest-side multi-tenancy lives in `2026-07-23-multi-tenant-guest-entry-design.md`.

## Background

### Verified current state

Roles already exist. `wedding_members` carries `role text check (role in ('owner','editor','viewer'))` and `requireAdmin()` (`lib/admin-auth.ts`) resolves the signed-in user's membership, redirecting to `/admin/login?error=no_access` when absent.

**But role is not enforced.** `requireAdmin()` gates only on *membership existing*; it returns `role` and no caller checks it. Every admin write runs through server actions that use `adminDb()` — the **service-role client, which bypasses RLS** — so the `is_wedding_editor` policies in `0001_init.sql` never fire on the admin surface. A `viewer` can today edit guests, seating, and send email. The role column is decorative.

Admin invites exist only as `scripts/invite-admin.mjs` — a developer-run CLI script using the service-role key. There is no in-app way to grant access.

Email splits into two surfaces with different transports:

| Surface | Today | Problem |
|---|---|---|
| Guest email (invitations, reminders, campaigns) | Resend API via `lib/email/send.ts`, branded `emailShell()` | Sends from `onboarding@resend.dev`; sender is a single global `RESEND_FROM` env var |
| Admin auth (magic link, dashboard invite) | Supabase's built-in sender | Rate-limited and unreliable to non-team addresses — the reason `invite-admin.mjs` carries a `--link` fallback |

`supabase/templates/invite.html` is branded but **was never pushed** to the remote project (403 from a CLI logged into the wrong account). Only the `invite` template is customized — `magic_link`, the email admins see on *every* sign-in, is unstyled Supabase default.

`supabase/config.toml` still has `site_url = "https://guest-crm-camrens-projects-24b42280.vercel.app"`, but the live site is `www.julietandjuan.com` (apex 308-redirects to `www`; `/rsvp` returns 200). Auth redirects point at a stale host.

### Current access

| User | Role |
|---|---|
| `camren@gettailor.ai` | `owner` |
| `julietle24@gmail.com` | `editor` |
| `cmcmath89@gmail.com` | auth user exists, **no membership** |

Juliet already has an account. Bootstrapping is a promotion, not an invitation.

### Environment hazards

Four separate credential mismatches were found while scoping this work, all of which have already caused or nearly caused writes to the wrong account:

1. **Supabase MCP** targets a different project; `execute_sql` returns Unauthorized. Use the service-role key from `.env.local`.
2. **Supabase CLI** — previously 403'd on `config push`; now correctly sees `guest-crm` (`lagjcyaquqbddmnmzvcm`, linked). Re-verify before relying on it.
3. **Resend** — the `RESEND_API_KEY` in `.env.local` belongs to a *different account* (owns `snackboxcms.com`) than the MCP-authorized account where `julietandjuan.com` was created. **The app is currently sending through the wrong Resend account.**
4. **Vercel CLI** — authenticated as `mistasnacks`, which sees the owning team as empty; `.vercel/project.json` points at a `guest-crm` project while the live deployment is `camrens-projects-24b42280/juliet-juan-wedding`.

### Roles research

Surveyed 11 products (Joy, Zola, The Knot, RSVPify, Appy Couple, Prismm/AllSeated, Aisle Planner, HoneyBook, Dubsado, Eventbrite, Splash, Cvent). Findings that drove the decisions below:

- **Universal pattern:** one Owner holding two exclusive powers — *delete the event* and *money* — with collaborators getting everything else. Joy, Zola, Dubsado, and HoneyBook converge independently.
- **A named "planner" role is rare.** Only Prismm and Cvent have one. Joy explicitly routes wedding coordinators through its generic Collaborator role. Zola's official answer to planner access is *share your password*; The Knot has no multi-user support at all.
- **Read-only splits by market.** Every professional/event tool ships it (RSVPify, Aisle Planner, Splash, Dubsado, Cvent); *zero* consumer wedding tools do. Aisle Planner names this exact use case: family who should see some things but not change them.
- **Most common shape is Owner → Editor → Viewer** — already this schema.

## Goals

1. Juliet manages her own collaborators without a developer.
2. `viewer` becomes a genuine read-only tier.
3. All outbound email — guest and auth — is branded and sent from `julietandjuan.com`.
4. Deliverability verified by real test sends, not assumed.

## Non-goals

- **No bespoke "planner" role** — research says it's rare and unnecessary; the planner gets `editor`.
- **No per-tool permission matrix** (Aisle Planner / Prismm only; heavy UI cost for a 3-person team).
- **No billing role split** — billing doesn't exist in this product.
- **No day-of check-in role** — real in event tools, but not needed for this delivery.
- **No per-wedding sender config** — see Follow-up.

## Decisions

1. **Keep `owner` / `editor` / `viewer` unchanged.** Matches the cross-product common denominator; no migration needed.
2. **The wedding planner gets `editor`.** Full guest list, RSVPs, seating, and guest email; cannot manage members or delete the wedding — the universal collaborator restriction, just unnamed.
3. **Enforce in application code, not RLS**, because the admin surface deliberately runs on the service role. RLS stays as a backstop for any future anon/authenticated-key access.
4. **Owner-exclusive powers:** manage members, delete the wedding.
5. **Two sender identities:** `rsvp@julietandjuan.com` for guest mail, `noreply@julietandjuan.com` for auth mail.
6. **Route Supabase Auth email through Resend SMTP** — fixes branding and deliverability together, and retires the `--link` workaround.
7. **Bootstrap by promoting Juliet `editor` → `owner`.** She invites Juan (`owner`) and the planner (`editor`) herself.

## Architecture

### Role enforcement

`lib/admin-auth.ts` gains two guards alongside `requireAdmin()`:

```
requireEditor(): AdminContext   // redirects when role === 'viewer'
requireOwner():  AdminContext   // redirects unless role === 'owner'
```

Server actions are the *only* write path into the domain tables, so gating them at the top is complete coverage. Applied to every mutating action in:

- `app/admin/(dashboard)/guests/actions.ts`
- `app/admin/(dashboard)/seating/actions.ts`
- `app/admin/(dashboard)/comms/actions.ts`
- `app/admin/(dashboard)/imports/actions.ts`
- `app/admin/(dashboard)/team/actions.ts` (new — `requireOwner`)

Read-only pages continue to use `requireAdmin()`.

UI must match enforcement or viewers hit dead ends: hide the "＋ New household" button, per-row edit/delete controls, the comms send form, and the seating drag handles when `role === 'viewer'`. A guard that only rejects server-side produces a broken-feeling UI.

### Team page — `/admin/team`

Owner-only, enforced in both the page and every action.

Displays each member's email, role, and join date. Email lives in `auth.users`, which is not reachable through PostgREST, so it is resolved via the Auth admin API (`/auth/v1/admin/users`) and joined to `wedding_members` in the data layer.

Operations: `invite(email, role)`, `changeRole(userId, role)`, `remove(userId)`.

Guardrails:

- **Last-owner invariant** — the final `owner` cannot be demoted or removed.
- **No self-removal** — prevents accidental self-lockout.
- **Invite is idempotent** — an address that already has an auth account skips the invite email and only upserts the membership row (the existing script's behavior).

New module `lib/data/members.ts` holds list/invite/setRole/remove. `scripts/invite-admin.mjs` is refactored to call it, so the script and the UI share exactly one code path rather than drifting.

### Email identities

| Surface | From | Transport |
|---|---|---|
| Guest | `Juliet & Juan <rsvp@julietandjuan.com>` | Resend API |
| Auth | `Juliet & Juan <noreply@julietandjuan.com>` | Supabase Auth → Resend SMTP |

Configuration changes:

- **Resend:** verify `julietandjuan.com` (created 2026-07-24, id `1151fc2e-25f0-41a1-b073-dc412d967d0d`, status `not_started`); enable open tracking — `communication_recipients.status` already models `opened` and `app/api/webhooks/resend/route.ts` already exists to receive it.
- **Key rotation:** mint a scoped API key in the MCP-authorized Resend account; update `RESEND_API_KEY` and `RESEND_FROM` in `.env.local` *and* Vercel env. This repoints production sending off the snackbox account.
- **`supabase/config.toml`:** enable `[auth.email.smtp]` → `smtp.resend.com:587`, user `resend`, pass `env(RESEND_API_KEY)`, sender `noreply@julietandjuan.com`; correct `site_url` to `https://www.julietandjuan.com` and refresh `additional_redirect_urls`.
- **Templates:** push the pending `invite.html`; add a branded `magic_link` template matching `emailShell()`.

### DNS

Zone is Vercel-managed (`ns1/ns2.vercel-dns.com`). Four records, none currently present:

| Type | Name | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDRhdFKOt+FBnxhKP9BmMnXP+rv71b31m1JyAAZmtxyaBpvtUv4Hq4ww51CyOrJIahpUwVsBcwC5OA4D5K2deAnJgDWB48jqCVPScc4h2q7lls2kMuYneXscBChno4aHT+lqmfjG1zxU7o1rzXDV4u5T7CqA+biDxE2Yhq9DDRsewIDAQAB` | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:camren@gettailor.ai` | — |

DMARC is not required by Resend but materially helps inbox placement for a few-hundred-recipient guest send.

## What exists vs. what's new

**Reused as-is:** `wedding_members` schema and roles, `requireAdmin()`, `emailShell()` and the branded guest templates, the comms pipeline, the Resend webhook route, `supabase/templates/invite.html`, the invite logic in `scripts/invite-admin.mjs`.

**New:**

- `requireEditor()` / `requireOwner()` and their application across all mutating server actions
- Viewer-aware admin UI (hidden write controls)
- `/admin/team` page + actions
- `lib/data/members.ts` (shared by page and script)
- Branded `magic_link` auth template
- `[auth.email.smtp]` configuration + corrected `site_url`
- Verified sending domain, rotated API key, four DNS records

## Risks

- **Key rotation repoints production sending.** Do it only after the domain verifies, and confirm with a real test send before announcing anything to guests.
- **The SMTP change affects all auth email.** A misconfiguration locks every admin out of the dashboard. Verify with a live magic-link sign-in before treating it as done; keep the old path recoverable until confirmed.
- **`env(RESEND_API_KEY)` must be present** in the environment where `supabase config push` runs, and the value is stored by Supabase — rotating the key later means re-pushing config.
- **Last-owner lockout** if the invariant is implemented incorrectly. Cover it with a test.
- **Wrong-account writes** — see Environment hazards. Confirm the active account before every Resend, Supabase, or Vercel mutation.

## Open questions

1. **Reply-To for guest email** — Juliet's personal address, or a shared couple inbox? Guests *will* reply to a wedding invitation.
2. **Should `cmcmath89@gmail.com` get an `owner` membership** for ongoing testing? It currently receives email but cannot log in.
3. **Keep `scripts/invite-admin.mjs`** as a break-glass path for owner lockout, or delete it once the Team page ships? (Leaning keep — it is the only recovery route if the last owner is lost.)

## Testing considerations

**Roles**
- A `viewer` is rejected by every mutating server action — exercise guests, seating, comms, and imports individually rather than assuming shared coverage.
- A `viewer` sees no write controls in the UI.
- An `editor` can mutate but cannot reach `/admin/team` (page *and* direct action invocation).
- The last `owner` cannot be demoted or removed.
- A user cannot remove themselves.

**Invites**
- Invite to a brand-new address creates the auth user, upserts membership, and delivers a branded email.
- Invite to an address that already has an account (Juliet) is idempotent — no duplicate user, membership updated.
- Role changes take effect on the invitee's next request.

**Email**
- Magic link from `/admin/login` arrives from `noreply@julietandjuan.com` and completes sign-in against `www.julietandjuan.com`.
- Guest invitation and reminder arrive from `rsvp@julietandjuan.com`; RSVP links resolve to `www.julietandjuan.com` and open the correct household.
- Received-message headers show SPF, DKIM, and DMARC all passing.
- Test sends to `cmcmath89@gmail.com` covering invitation, reminder, and magic link.
- Open tracking produces an `opened` row in `communication_recipients` via the existing webhook.

## Follow-up: multi-tenant sender config

`lib/email/send.ts` reads `env().RESEND_FROM` — one global sender for the entire app. That is the concrete blocker to multi-tenant email, and it should move onto the `weddings` table (`from_name`, `from_email`, `reply_to`, `resend_domain_id`) so `sendEmail` resolves the sender per wedding.

Three product shapes were considered for the full SaaS:

1. **Platform sending domain** — one verified domain (e.g. `mail.gettailor.ai`), per-couple From name and Reply-To. Zero client DNS work; clients share sending reputation.
2. **Per-client custom domain** — what this delivery does. Best branding and isolated reputation; every client must do DNS work.
3. **Subdomain per client** on a zone we control — auto-verified via the DNS provider API, no client work, per-client DKIM isolation; most infrastructure to build.

**Recommended:** ship #1 as the default and offer #2 as a premium path for couples who own a domain — which is exactly Juliet & Juan, making this delivery the prototype for that tier. Out of scope here; pairs naturally with `docs/seating-roadmap.md` and the multi-tenant guest-entry spec.
