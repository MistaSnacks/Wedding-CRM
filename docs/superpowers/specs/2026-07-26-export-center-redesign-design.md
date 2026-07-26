# Export center redesign — grouped report list with a single format toggle

**Date:** 2026-07-26
**Status:** Approved (pending spec review)

## Problem

The Export center on `/admin/imports` renders 12 reports as pill chips, each
with a bolted-on "XLSX" segment — 24 tap targets, the word "XLSX" repeated
twelve times, and no explanation of what any report contains. For the target
user (a non-technical bride) this is visual clutter and jargon: she doesn't
know what a CSV is, can't tell "RSVP status report" from "Pending guests"
without downloading both, and the format decision is forced on her once per
chip.

## Decision

Keep every report **visible on the page** (this page is the Export center;
exports are its content — hiding them in a dropdown would cost
discoverability), but reorganize:

1. **One format control for the whole card.** A radio-style pill pair at the
   top right of the card: **Excel** (pre-selected) and **CSV**, with a short
   hint line ("Excel opens in Excel, Numbers, or Google Sheets"). Client-side
   state only; not persisted.
2. **Reports as a grouped list, not chips.** Three groups with small
   uppercase headers. Each row: report name, a one-line plain-English
   description of what's inside, and a single download affordance. One click
   per export.
3. **Excel is the default format** because it opens cleanly for non-technical
   users. CSV remains one toggle away for vendors and tools that ask for it.

A dropdown "Export ▾" button was considered and rejected *for this page*: it
suits pages where export is a secondary toolbar action (guests, seating), not
a page whose purpose is exporting. That remains a good future pattern
elsewhere.

## Groups and copy

| Group | Report key | Label | Description (one line, plain English) |
|---|---|---|---|
| Guest lists | `guest-list` | Full guest list | Everyone, with RSVPs, meals, dietary notes, and tables |
| Guest lists | `households` | Household list | One row per household — contacts, party size, invite code |
| Guest lists | `addresses` | Mailing addresses | One row per household, ready for envelopes or a mail house |
| RSVPs | `rsvp-status` | RSVP progress | How many in each household have answered |
| RSVPs | `attending` | Attending guests | Everyone who said yes, with their meal choice |
| RSVPs | `declined` | Declined guests | Everyone who said no |
| RSVPs | `pending` | Awaiting reply | Invited guests who haven't answered yet |
| For your vendors | `caterer` | Caterer report | Attending guests with meals, kids' meals, and dietary needs |
| For your vendors | `meals` | Meal counts | Totals for each dish |
| For your vendors | `dietary` | Dietary restrictions | Guests with dietary notes or allergies, and their tables |
| For your vendors | `accessibility` | Accessibility requests | Guests who asked for accommodations |
| For your vendors | `seating` | Seating chart | Who sits at which table, per event |

Exact wording may be polished during implementation; the register (plain
English, no jargon) may not.

## What stays exactly as-is

- **The earned download feedback.** One-time `dl` token per link, echoed back
  as a short-lived cookie by the export route, polled client-side; pulsing
  dot while the file builds, checkmark when the browser has it, `aria-live`
  announcement, "taking longer than usual" fallback. This machinery moves
  from chips onto list rows unchanged in behavior.
- **The export route** (`app/api/export/[report]/route.ts`). It already
  serves both CSV and XLSX. Zero backend changes.
- **Real anchors.** Each row's download is an `<a href>` to
  `/api/export/[key]?format=…&dl=…` — right-click → Save link as,
  middle-click, keyboard activation, and no-JS all keep working. With JS off
  the toggle can't rewrite hrefs, so anchors are server-rendered with
  `format=xlsx` and the no-JS fallback downloads Excel — matching the
  default (see Implementation notes).
- The "Print escort cards" / "Print place cards" links below the card.

## Implementation notes

- Rewrite `components/admin/ExportLinks.tsx` (rename to `ExportCenter.tsx`)
  as a client component. Token/cookie/poll logic carries over; status is now
  keyed by report key alone (one status per row) instead of `key:format`.
- The `REPORTS` array in `app/admin/(dashboard)/imports/page.tsx` gains
  `description` and `group` fields and is passed through as today.
- Format toggle is a `radiogroup` (two real radio inputs styled as pills),
  labeled "File format". Server-rendered checked state = Excel, so the no-JS
  anchors are rendered with `format=xlsx` hrefs — meaning the no-JS fallback
  downloads Excel, matching the default.
- Row semantics: a plain list (`<ul>`), each row an `<a>` wrapping the name +
  description with a trailing download glyph; `aria-busy` while pending, the
  existing `StatusMark` inline.
- Card subtitle on the page updates to match (no more "CSV, or XLSX for
  Excel" jargon), e.g. "Pick a report and it downloads straight to your
  computer."

## Error handling

Unchanged from today: a failed/slow export flips the row to the "slow" state
("taking longer than usual") after 20 s; the route 404s unknown reports. No
new failure modes are introduced.

## Testing

- `lib/` unit tests are unaffected (no logic changes there).
- Verify in a real browser (per project practice): toggle defaults to Excel,
  clicking a row downloads `.xlsx`, switching to CSV downloads `.csv`,
  feedback dot → checkmark appears on the clicked row, announcement reads
  correctly, keyboard-only operation works, and the page still functions
  with JavaScript disabled.

## Out of scope (YAGNI)

- Persisting the format choice.
- New export formats (PDF, Google Sheets).
- An "Export ▾" dropdown on the guests/seating pages (good future work,
  separate effort).
- Any change to report contents or the export route.
