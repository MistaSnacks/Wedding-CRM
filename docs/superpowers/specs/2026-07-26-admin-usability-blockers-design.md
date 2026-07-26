# Admin usability blockers — design

- **Date:** 2026-07-26
- **Status:** Approved to build (Camren, in-session)
- **Origin:** Browser-driven ease-of-use audit of the admin, performed with real
  imported data (164 households). Four findings were rated blockers for handing
  the app to Juliet and for productizing. This spec covers exactly those four.
- **Out of scope:** the smaller polish items from the same audit (activity-feed
  wording, seating default tab, copy plurals, entrance-animation timing). They
  ride along only where a file is already being touched.

## 1. Safe sends

**Problem.** `Send campaign` on `/admin/comms` is a bare form submit. One click
emails up to every household. No recipient count, no preview, no test send.

**Design.** Two-step review-then-send, in-page (no modal):

- The compose form's primary button becomes **Review campaign**. A server
  action computes the recipient list from the chosen audience and renders the
  exact email HTML (per-household language template; custom subject/body for
  the custom type) without sending anything or writing any rows.
- A review panel replaces the button area:
  - *"This will email **N** households. **M** have no email address and will
    be skipped."* — with the skipped names listed (they matter: those guests
    simply never hear anything).
  - The rendered email in an iframe (`srcdoc`), with a language switcher when
    recipients span locales.
  - **Send to N households** (primary) · **Back to editing** (secondary).
- **Send a test to me** sits next to Review — sends only to the signed-in
  admin's email, tagged `[Test]` in the subject, never recorded in History.
- Any change to a compose field invalidates the review (same pattern as the
  import dry-run gate: the send button is disabled until re-reviewed).
- Copy: "Email (Resend)" → "Email"; the webhook line → "Sent in each guest's
  language with their personal RSVP link."
- `sendCampaign` keeps its shape but gains a guard: it recomputes the audience
  and refuses (with a friendly error) if the reviewed count no longer matches —
  the review token carries the count.

The Overview "Send reminders (N)" button is already only a link to this page;
it inherits the safety.

## 2. Mailing addresses on the household page

**Problem.** `mailing_address` exists in the schema, in imports, in the
Save-the-Date merge, and in exports — but nowhere in the UI. Juliet cannot see
or fix an address.

**Design.** A "Mailing address" block inside Household settings & notes on
`/admin/guests/[id]`:

- Displays the address: `raw` verbatim if present, otherwise the structured
  pieces (`street`, `city`, `state`, `zip`, `country`) joined on one line each.
- A quiet provenance line: "from the Save-the-Date form" (`save_the_date`),
  "from your spreadsheet import" (`csv`), "edited by you" (`admin`).
- Editing: one free-text textarea. Saving stores `{raw, source: "admin"}`
  verbatim — **never parsed** (same principle the importer documents:
  international addresses defeat parsers, and a wrong parse corrupts a mailing
  label silently). Saving over a structured import address replaces the whole
  value; the old value is gone (acceptable: the admin is the top of the source
  hierarchy per the standing form-data-outranks-imports rule).
- `MailingAddress["source"]` union gains `"admin"`.

## 3. One search behavior everywhere

**Problem.** Three search patterns: the header "input" is a `Link` styled as a
text field (typed text is silently discarded), the Guests page search needs an
explicit submit, and the events invite matrix filters live. Only the last one
matches expectation.

**Design.** One primitive, two surfaces:

- A shared `matchesGuestQuery(query, household)` — lowercased,
  diacritic-stripped (NFD, same normalization the Save-the-Date matcher used),
  matched against household display name, every guest's full name, email, and
  phone. Unit-tested; both surfaces call it.
- **Header:** a real input. The dashboard layout already has every household's
  name/guests server-side for the page being viewed — instead the header mounts
  a small client component fed by a lightweight `/admin` search endpoint that
  returns the wedding's households + guest names once (~160 rows, cached in
  memory client-side). Typing shows a dropdown of the top 8 matches (household
  name + guest names + status chip); click → that household's page; Enter →
  `/admin/guests?q=…`; Escape closes. No results → "No one matches ⟨q⟩."
- **Guests page:** the search box filters the table live as you type
  (client-side over the already-rendered rows; the server `q` param stays for
  deep links). The Search button goes away. Filter chips unchanged, and chips
  compose with the text query.

## 4. Mobile admin

**Problem.** Outside events/import, the admin has zero responsive handling:
fixed 228px sidebar, fixed-width header, wide tables. Unusable at phone width.
The guest RSVP flow is already fluid and stays untouched.

**Design.** Responsive retrofit below Tailwind `md` (768px); desktop pixel-for-
pixel unchanged:

- **Layout:** sidebar hides; a hamburger in the header opens it as a slide-in
  drawer (overlay, closes on nav or scrim tap). Header keeps: hamburger,
  search, "+ New household". The RSVP-countdown chip hides on mobile.
- **Guests list:** the table becomes stacked cards — household name, guest
  names, status chip; whole card taps through to the household. Contact, rules,
  code, delete live only on the household page at this width. Filter chips
  scroll horizontally in one row.
- **Household page:** the two-column layout stacks (guests + settings first,
  invited-to / activity / communication after). Inputs go full-width.
- **Overview:** metric cards 2-up, then the two panels stack.
- **Comms / Meals / Imports / Team:** single column stack; the compose row of
  three selects stacks vertically.
- **Seating:** view + assign only (decided). At `<md` the canvas renders
  read-only (pinch/scroll to pan); each table gets a tap target opening an
  assign sheet listing unassigned households with an "assign to this table"
  action. Layout dragging, table creation/resize stay desktop-only, with a
  quiet note: "Arrange tables on a computer — here you can seat people."
- **Events / Import wizard:** already responsive; spot-fix anything that
  overflows during verification rather than redesigning.

## Testing

- Unit: recipient computation for every audience × the no-email skip split;
  review-token count-mismatch guard; `matchesGuestQuery` (diacritics, partial
  names, email, phone digits); address save writes `{raw, source:"admin"}`
  verbatim and leaves other fields untouched.
- Browser verification at 1440px and 390px for every touched screen; a real
  test-send to the admin email for the comms flow.
- Existing suite (95 tests) stays green.
