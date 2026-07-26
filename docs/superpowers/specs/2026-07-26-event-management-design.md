# Event management — design

- **Date:** 2026-07-26
- **Status:** Approved to build
- **Scope:** Admin UI to create, edit, reorder and delete wedding events, and to control which households are invited to each.

## Why now

The schema has supported arbitrary events since day one — `events`, `household_event_invites`, per-guest `guest_event_responses`, event-scoped `meal_options`. There has never been a UI. Events exist only via database migration, so adding a rehearsal dinner currently requires a developer.

That is live right now: the master sheet carries a `Rehearsal Dinner RSVP` column, production has only `Ceremony` and `Reception`, and that column's data has nowhere to land.

## Who this is for

Juliet. She thinks *"we're doing a rehearsal dinner for family only, and the reception for everyone."* She does not think in entities, join tables, or invite lists. If the interface asks her to model her wedding, it has failed.

## Evidence from the field

Researched Zola, The Knot, Joy, Appy Couple, Minted, Riley & Grey. Full notes in `event-management-research.md`.

- **The dominant pattern for "who's invited to what" is a direct guest ↔ event checkbox matrix**, surfaced from the guest list (Zola, Minted, Riley & Grey).
- **Joy overloads generic "Tags"** for the same job — an extra abstraction the user must invent and maintain.
- **Appy Couple forces a mandatory "main event"** that all others must subset. A confirmed real failure: a user could not invite in-laws to the rehearsal dinner without first adding them to the main wedding list.
- **RSVP is per-event in every product studied** — never one wedding-wide yes/no.
- **Visibility is a separate axis from RSVP-enabled** everywhere. "Everyone can see it" and "we're collecting responses" are different questions.
- **Only Zola documents a deletion guard** — it blocks deleting an event while RSVPs exist. The Knot, Joy, Minted and Appy Couple leave it undocumented.
- **A verified user report describes Zola silently wiping RSVPs and meal choices** during a routine bulk guest-list action, with no undo. Deletion safety is a real failure mode, not a hypothetical.

## Decisions

1. **Invites are expressed as a checkbox matrix, not tags and not a hierarchy.** No "main event" concept — any household can be invited to any subset, including a rehearsal dinner they attend without the reception.
2. **Deleting an event with responses is guarded, never silent.** The user is told exactly how much will be lost and must confirm against a real count. This is the single most dangerous action in the feature.
3. **Visibility and RSVP-enabled are separate switches.** An event can be shown on the schedule without collecting responses.
4. **Freeform names with presets as a starting point.** Presets fill sensible defaults; she can rename anything.
5. **Invites stay household-level in v1**, matching the existing schema. Per-person overrides within a household (Minted's model — inviting two parents but not their children) are a real need but a schema change; deferred and recorded below.
6. **Event edits never silently discard responses.** Renaming and re-timing are free; only deletion and disabling RSVP touch data, and both are guarded.

## Screens

### `/admin/events` — the list

Events in their display order, each showing name, date/time, venue, how many households are invited, and how many have responded. Drag to reorder. An **Add event** button.

Empty of extra chrome — this is a short list, not a data grid.

### Add / edit an event

A single form, plain language:

> **What is it?** `Rehearsal Dinner` — with quick presets: Welcome Party · Rehearsal Dinner · Ceremony · Reception · Farewell Brunch
> **When?** date and time, both optional — a date can be decided later
> **Where?** venue name and address, optional
> **What should people wear?** optional
> **Who's invited?** *Everyone* · *Only some households* → opens the picker
> **Collect RSVPs for this?** yes/no

Nothing is required except the name. A half-finished event is normal months out.

### The invite picker

The matrix, reached from the event *or* from the guest list — both directions work, because she thinks both ways ("who's coming to the rehearsal?" and "what is the Smith family invited to?").

From the event: a searchable household list with checkboxes, plus **Select all** and selection by existing tag (`family:…`, `A List`) since the importer already produced those. Selecting by tag is a *shortcut that expands into checkboxes*, not a saved rule — no invisible state.

From a household's page: a short list of events with checkboxes.

Either way the change is immediate and reversible, and the count on the events list updates.

### Deleting an event

The guarded path.

- **No responses yet** → a normal confirm.
- **Responses exist** → name the cost precisely: *"14 households have already replied to Rehearsal Dinner, and 3 have chosen meals. Deleting it removes those replies permanently."* Require typing the event name to proceed, matching the pattern used for other destructive actions in this admin.
- **Disabling RSVP** on an event that has responses warns but does not delete — responses are retained and simply stop being collected.

## Data model

No migration needed for the core feature. `events` already carries `name`, `starts_at`, `ends_at`, `venue_name`, `venue_address`, `dress_code`, `rsvp_enabled`, `sort_order`.

**One migration is needed:** a `visibility` column (`'all' | 'invited_only'`), since visibility and `rsvp_enabled` are separate axes and only the latter exists. Default `'all'` preserves current behaviour.

Deleting an event cascades to `household_event_invites` and `guest_event_responses` by existing foreign keys — which is exactly why the confirm must state the count first.

## Error handling

- **Deleting the last event** is allowed but warned — the RSVP flow has nothing to collect without one.
- **An event with no invited households** shows plainly on the list ("nobody invited yet") rather than looking finished.
- **Reordering** is optimistic with rollback on failure.
- **Concurrent edits** — last write wins, consistent with the rest of this admin. Not worth more for a two-person team.

## Testing

- Creating an event with only a name succeeds; every other field is optional.
- Invite toggles write and remove `household_event_invites` rows, and the invited count follows.
- Selecting by tag expands to individual checkboxes and can then be partially unchecked — proving it is a shortcut, not a rule.
- **Deleting an event with responses requires typed confirmation and reports the true count** — the count shown must match the rows actually deleted.
- Disabling RSVP retains existing responses.
- A household invited to the rehearsal dinner but not the reception is valid and round-trips — the asymmetric case Appy Couple gets wrong.
- Reordering persists and survives reload.

## Deferred

**Per-guest invite overrides within a household.** Minted supports inviting two parents to an adults-only dinner without their children. Our `household_event_invites` is household-level; this needs a per-guest invite table and a decision about how it interacts with party-size caps. Real need, genuine schema work — not v1.

Also out of scope: event-scoped meal options in this UI (the column exists; managing it belongs with the meals page), and any guest-facing schedule page.
