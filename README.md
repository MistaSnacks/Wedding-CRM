# Guest CRM & RSVP Platform

Wedding guest management CRM + guest RSVP experience (EN/ES/VI). Standalone Next.js app; tenant-ready core (every table scoped by `wedding_id`) for a future multi-tenant SaaS.

Spec: `Juliet Wedding/docs/superpowers/specs/2026-07-02-guest-crm-platform-design.md` · Mockups: Paper file "Wedding Guest CRM".

## Stack

Next.js (App Router, TS) · Tailwind v4 · Framer Motion · next-intl · Supabase (Postgres/Auth) · Resend · @dnd-kit · zod · jose · papaparse · xlsx · Vitest. Fonts: Cormorant Garamond + Montserrat.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in (see table below).
3. Supabase: create a project, then
   ```bash
   supabase link --project-ref <ref>
   supabase db push            # applies supabase/migrations/0001_init.sql
   psql "$DATABASE_URL" -f supabase/seed.sql   # seed wedding + fixture households
   ```
4. Create admin users: invite Juliet's/Camren's emails in Supabase Auth, then
   ```sql
   insert into wedding_members (user_id, wedding_id, role)
   values ('<auth-user-uuid>', '11111111-1111-1111-1111-111111111111', 'owner');
   ```
5. `npm run dev` → guest flow at `/rsvp` (fixture codes `TEST-AAA1/2/3`), admin at `/admin`.

## Environment

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-only; data layer |
| `SESSION_SECRET` | yes | `openssl rand -hex 32`; signs guest session cookies |
| `RESEND_API_KEY` | no (dev) | without it, emails write to `.emails/*.html` |
| `RESEND_WEBHOOK_SECRET` | no | set after creating the webhook endpoint in Resend |
| `RESEND_FROM` | no | verified sender, e.g. `Juliet & Juan <rsvp@mail.julietandjuan.com>` |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | memory rate-limiter/cache used when absent |
| `NEXT_PUBLIC_APP_URL` | yes | used in magic links/emails |

## Deploy (Vercel)

```bash
vercel link          # create project
vercel env add ...   # each var above, production
vercel --prod
```
Then in Resend: add webhook `https://<domain>/api/webhooks/resend` (events: sent, delivered, opened, bounced, complained) and set `RESEND_WEBHOOK_SECRET`.

## Architecture notes

- **Data layer** (`lib/data/*`): every function takes a `WeddingScope`; nothing queries without a `wedding_id`. RLS policies are the backstop.
- **Invitation rules** (`lib/domain/invitation-rules.ts`): pure, unit-tested; the server validates every submission. Rules are two numbers per household: `max_party_size`, `plus_one_slots`.
- **Guest access**: magic link (`/rsvp/h/<token>`) · invite code · verified name+email lookup (emails a link; never opens directly). Rate-limited; sessions are signed JWT cookies.
- **RSVP writes** go through the `submit_rsvp` Postgres function (atomic, activity-logged, status recomputed).
- **Emails**: localized (EN/ES/VI) via `lib/email/strings.ts`; dev fallback writes HTML files.
- **Seating**: dnd-kit canvas; "Visible to guests" toggle per event reveals each guest's table on their RSVP page.

## Tests

`npm test` — invitation rules (16), CSV import validation (5), rate limiter/cache (4), guest sessions (3).

## TODO (post-launch)

- Playwright e2e golden path (needs a live DB)
- Upstash Redis in prod (`UPSTASH_*` vars — zero code changes)
- Verified sending domain in Resend + DNS records
- Point rsvp.julietandjuan.com at the Vercel project when client approves
