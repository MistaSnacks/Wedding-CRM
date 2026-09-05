# Venue-based seating — proposed feature

Status: interactive concept implemented on September 4, 2026 at `/venue-preview`; production integration remains proposed. No database changes were required for the sample-data prototype. The booked reception space and measured plan still need confirmation.

## Intended experience

Juliet opens Reception → Seating and sees the actual venue beneath her tables. She can switch between a scaled floor plan, a 3D view and the existing assignment list. Clicking a table opens its guest list, capacity, meals and dietary notes. Moving a household to that table updates the same RSVP-linked seating assignments used by reports and place cards.

The floor plan and 3D scene show the same saved layout. Table positions, dimensions, rotation and assignments do not diverge when changing views or screen sizes. Room editing and assigning guests are separate modes to prevent accidental table movement.

## Source material

The repository seed names Edén Benavento for both ceremony and reception. This identifies a candidate venue, not the booked reception area.

[Benavento's official event-space page](https://benavento.com/espacios-para-eventos/) lists the Terraza Panorámica as 28 × 28 metres, with an 8 metre internal roof height, and describes the Gran Salón separately. It does not supply a dimensioned architectural drawing on the page reviewed. Do not infer a complete room shape from capacity or a single span measurement.

Ask the venue for the booked space's current PDF/CAD floor plan, overall dimensions, fixed columns, doors/exits, stage, service access and existing furniture inventory. Table dimensions and actual chair footprints matter as well as seat counts. Photos and a video walkthrough provide architectural/material reference for 3D. A supplied existing 3D model may be reusable after scale, orientation and complexity checks.

If only photos are available, create a clearly labelled concept layout. Do not label inferred measurements as venue-verified. A generated image can establish visual direction, but interactive seating requires individually editable geometry and a confirmed coordinate system.

Suggested message to the venue — draft only, not sent:

> Hola, estamos preparando la distribución de mesas para la recepción de Juliet y Juan. ¿Nos podrían compartir el plano actualizado y acotado del espacio contratado, preferiblemente en PDF o CAD? Nos ayudaría que incluyera columnas, accesos y salidas, escenario, áreas de servicio y las medidas de las mesas y sillas disponibles. Si tienen un montaje de referencia, fotografías o un modelo 3D, también nos servirían. ¡Muchas gracias!

## First release: interactive floor plan

- Upload a plan image or select a page from a PDF. Show the selected page before saving it privately against the reception event.
- Set scale by selecting two points and entering their known distance. Record units, source, revision and whether dimensions are verified. Confirm orientation and crop.
- Pan, zoom, fit-to-room and adjust reference-image opacity. The plan remains locked while seating guests.
- Place round/rectangular/banquet tables using real dimensions, rotate them, snap or nudge with the keyboard, duplicate furniture and lock approved positions.
- Mark fixed room boundaries/columns and planning zones for the dance floor, DJ, bar, head table and service routes.
- Keep current guest/household drag assignment, table search, capacity checks, unassigned list, meal/dietary details and accessible list controls.
- Show geometric overlap and out-of-room warnings. Use venue-confirmed clearance settings; this is a planning aid, not a certificate of code compliance or venue approval.
- Save named layout drafts, compare alternatives, undo recent layout operations and explicitly approve the chosen layout. Table deletion/replacement previews guest-assignment consequences.
- Export a scaled overhead layout with event name, revision, scale and legend alongside the existing guest/table and caterer reports.

## Second release: interactive 3D

Construct a simplified room model from confirmed geometry. Add walls, columns and fixed features, then render each existing table/chair arrangement from the shared layout model. Use photos for materials and visual styling.

Support orbit, zoom, reset camera, table selection and an assignment side panel. Moving or rotating a table updates the same layout used by the floor-plan view. Guest labels appear on selection to keep the room readable. Preserve the list/floor-plan interface for phone use, keyboard access and devices that cannot render 3D smoothly.

Start with a useful lightweight model. Photorealistic lighting, decorative florals and walk-through presentation can follow once the geometry and interactions are dependable. Decorative assets must not obscure occupancy or misrepresent clearances.

## Fit with the existing app

- `components/admin/SeatingCanvas.tsx` already renders draggable tables and guest/household assignments. It currently stores screen-pixel positions in a fixed-height canvas and uses fixed visual table sizes. These need a room-coordinate transform, rather than simply placing an image behind existing pixels.
- `components/admin/SeatingTools.tsx` supplies accessible list assignment, table edits and reviewed suggestions; retain these controls.
- `lib/data/seating.ts` and the SQL functions already enforce wedding/event ownership, atomic group moves, attendance eligibility and capacity. Both visual modes must call those same guarded mutations.
- Seating reports join guest and event IDs and must continue using the approved assignment set.
- Private Supabase Storage and authenticated file routes already exist for vendor documents. Use a separate venue asset record/path and event ownership checks; a floor plan is not a vendor document.
- Current seating publication is live: subsequent saved assignments are visible to guests while enabled. Introducing layout alternatives requires explicit draft/published semantics so experiments cannot silently change guest-visible seating.

## Data design to settle before implementation

Add an event-scoped venue plan with asset path, source dimensions, unit scale, reference-image transform and verified/draft status. Add versioned layouts with stable object IDs, coordinates in metres, width/depth/height, rotation, object kind and locked state. Store room boundaries and fixed obstacles separately from furniture.

Keep seating-table identity independent of a draft's visual placement. Define whether an alternative changes only room positions or also guest assignments; do not silently create a second live assignment set. Publication should atomically validate and select the approved version. Check a layout revision on writes to detect simultaneous planner edits.

Preserve existing table positions as a legacy layout. Calibrating the first venue plan should preview the conversion and retain a recovery copy. New schema belongs in a new migration after 0019; already-applied migrations must remain unchanged.

## Acceptance criteria

1. The same table remains at the same real-world position across screen sizes, zoom levels and 2D/3D views.
2. Moving a table keeps its guests; changing an assignment updates all views and reports for the reception only.
3. Existing SQL capacity/eligibility checks still reject stale or conflicting changes.
4. Replacing a reference image does not silently rescale or displace an approved layout.
5. Draft edits do not change published guest seating; publish/restore are explicit and transactional.
6. All guest assignments remain usable without dragging or 3D rendering.
7. Missing/corrupt assets and failed saves have useful recovery states.
8. Venue-confirmed dimensions and inferred concept geometry are visibly distinguishable.

## Next inputs

Confirm the booked reception area and available floor plan/dimensions/photos. Review the working interactive prototype before choosing the production scope. The practical implementation sequence is calibrated floor plan → dependable room editing → shared interactive 3D view.

## Prototype implemented — 4 September 2026

A standalone trial is available at `/venue-preview`, linked from admin seating. It uses the terrace's published 28 × 28 × 8 m dimensions, a photographic reference library, shared 2D/3D furniture state, synthetic guest assignments, browser-local drafts and Blender-compatible GLB export. Actual reception room remains unconfirmed. No production seating schema or guest data is changed. See [prototype and source notes](benavento-venue-prototype.md).
