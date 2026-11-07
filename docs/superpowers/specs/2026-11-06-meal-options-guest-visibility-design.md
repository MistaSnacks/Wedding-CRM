# Meal options: "Show to guests" switch and translated names — design

- **Date:** 2026-11-06
- **Status:** Accepted for the public multi-tenant release. Not built.
- **Scope:** Let a couple hide or show each meal option for guests, and type the option's name in each guest language, from the admin menu editor.

## Why

Juliet & Juan asked to hide Kids Meal "for now" and to retire Fish. Migration `0021` did this with SQL: it added `meal_options.is_active` and `meal_options.name_i18n`, hid both options, and set the Spanish and Vietnamese names. A couple on the public product has no developer. They need the same control on the menu screen.

## What the admin sees

- Each option row in **Manage meal options** has a **Show to guests** switch. New options start on.
- A row with the switch off says **Hidden from guests**, and shows how many guests already chose it.
- Each row has one name field for each guest language the wedding offers (from wedding setup). A blank field means guests in that language see the main name.
- Renaming the main name marks the other languages for review. Today `manage_meal_option` clears them instead, so a guest never sees a translation of the old dish.
- **Remove** appears only on an option that is shown to guests and that no guest chose.
- The switch refuses to hide the last shown option for an event that needs a meal. The database still asks for a meal when only hidden options exist, so guests could not finish.

## What guests see

- Only options with the switch on, in menu order, in the guest's language. When the language is missing, they see the main name (`lib/domain/meal-name.ts`).
- A guest who chose an option before it was hidden keeps that choice. When they reopen the RSVP, show the current choice with "no longer offered", not "No meal selected". The current form shows "No meal selected" and still keeps the old value.

## Rules

- **Hide, never delete when guests picked it.** `guest_event_responses.meal_option_id` is `ON DELETE SET NULL`, so a delete silently erases every guest's choice. An option with recorded choices can be hidden, never removed. A hidden option cannot be removed either (`manage_meal_option` refuses since `0021`).
- Reports, the caterer export and seating keep counting hidden options that guests chose.
- Data: `meal_options.is_active` (boolean, default true) and `meal_options.name_i18n` (jsonb object keyed by locale; English stays in `name`).
- Writes go through `manage_meal_option`. It is `security definer`: keep `revoke ... from public, anon, authenticated` after any change, and use `create or replace`. A new parameter changes the signature, so the old function must be dropped and the revokes repeated.

## Related

- Admin reorder control. New options get `sort_order` 0 today, so they show first.
- The multi-tenant roadmap (`docs/multi-tenant-roadmap.md`, not yet committed), section "Multi-tenant launch requirements": language choices in wedding setup.
