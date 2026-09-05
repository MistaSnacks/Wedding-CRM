# Benavento venue prototype — 4 September 2026

Try locally: http://localhost:3006/venue-preview. A link also appears above the admin seating canvas.

## What works

- Three.js interactive terrace concept: orbit, zoom, pan, table selection and table dragging.
- Matching SVG floor plan with table dragging, keyboard selection and numeric/nudge controls.
- One shared metre-based layout for both views; 0.25 m position snapping, rotated furniture/chair boundary clamps.
- 80 synthetic guests, individual or four-person household moves, atomic capacity validation, unassignment and undo.
- Browser-local draft persistence, JSON download and GLB download of the current layout.
- Roof visibility control, approximate furniture proximity/dance-floor warnings, lazy-loaded WebGL with a floor-plan alternative.
- References tab containing 204 attributed public image URLs. The original-image archive and standalone gallery are local research assets.

This is a concept using sample data. It does not read or write live guest seating. No database migration is needed. The actual booked room has not been confirmed; the terrace is the working assumption, not a statement about the reception booking.

## Reference collection

204 unique images downloaded: 195 from the venue's current/older websites and nine from the architect's project page. Includes empty terrace interior/exterior photos, event setups, the grand hall and surrounding areas. Exact duplicate files were removed using SHA-256; different crops/variants may remain. Photographs retain their owners' rights; public availability is not a reuse licence.

- [Current spaces and published terrace dimensions](https://benavento.com/espacios-para-eventos/)
- [Current gallery](https://benavento.com/galeria/)
- [General areas](https://benavento.com/areas-generales/)
- [Older venue website](https://www.salondeeventosbenavento.com/instalaciones)
- [AE Arquitectos project, 2022](https://www.aearquitectos.mx/en/projects-1/benavento) — labelled PROYECTO, not verified as-built documentation. The quoted 1,021 m² project area is not the terrace footprint.
- [Venue YouTube channel](https://www.youtube.com/channel/UCu9bGZmZkTc8lXb7c_Zrz7A)

Local files: `research/benavento/manifest.json` records original URLs, source pages, file hashes and dimensions; `research/benavento/gallery.html` browses the locally archived originals. `images/` is gitignored. The app references public original URLs, which can become unavailable; a licensed production gallery should use approved, controlled assets.

No measured floor plan, downloadable venue mesh, Matterport tour or directly downloadable video was located in the sources inspected. This is not proof that the venue has none.

## Verified versus inferred

Verified from the venue's public page: Terraza Panorámica platform 28 × 28 m (784 m²), internal height 8 m. The model follows these overall measurements.

Inferred from photos: steel support locations, glass band heights, roof construction/proportions, floor pattern, lake orientation and landscaping placement. Furniture, chair sizes and dance-floor placement are example planning choices. The generated geometry is not a surveyed plan or a photogrammetric reconstruction. Doorways, ramps, exits, fixed service areas and circulation requirements must be supplied and checked before a production seating layout can be approved.

## Blender handoff

The model is authored procedurally in `lib/venue/scene.ts`. A starter export is at `public/venue/benavento-terrace-concept.glb` (approximately 7.7 MB after the fidelity update); the app also exports the current furniture layout. Import GLB into Blender via File → Import → glTF 2.0. The shell carries source/measurement metadata, and furniture is grouped with table IDs and sample occupancy metadata. No real guest data is included.

Blender is appropriate for refining architectural geometry, materials, lighting and producing still renders. Three.js provides interaction in the application. Keep a future detailed shell separate from application-owned furniture so table movement and guest assignment continue to work independently. Export geometry in metres and preserve the agreed origin and axes; glTF is Y-up, Blender handles conversion.

Blender is not installed in this workspace. No `.blend` file or photorealistic Blender render was produced. The GLB was exported and reloaded through GLTFLoader, verifying that all 16 table groups survived.

Regenerate the starter model with `node --experimental-strip-types scripts/export-venue-concept.mjs` (Node 22+). Recollect public references with `python3 scripts/collect-venue-references.py`; the app's curated JSON and gallery are a snapshot, so refresh them explicitly after recollection.

## Validation and next step

Production build and TypeScript passed. Five venue tests cover group moves/capacity, malformed stored layouts, bounds and stable model identifiers/coordinates. GLB export/reload passed. The local preview route returned HTTP 200. No enabled browser was available to the computer-use tool, so visual appearance and pointer/touch behavior still need a browser review.

Confirm the booked room and obtain the measured plan. Then replace inferred shell geometry, add actual obstacles/entrances and connect event-scoped draft layouts to the existing seating workflow. The current live seating uses screen-pixel positions; it needs an explicit conversion/migration design before these metre coordinates can become authoritative. See `venue-seating-feature-plan.md` for the production data model and phased rollout.

## Drag-and-drop iteration

The inspector now includes searchable guest and household cards. Drag a card by its grip onto a table in either view. Valid targets highlight green; over-capacity targets highlight red and reject the entire move. Turn off “Only show unassigned” to move an already-seated guest. Both drag-and-drop and the existing assignment button use the same atomic assignment function, undo history and browser-local save.

Pointer events support mouse, pen and touch input. The grip reserves touch gestures for dragging while the card list remains scrollable elsewhere; on narrow screens the venue stays visible while scrolling the inspector. Escape, pointer cancellation and window blur cancel guest drags. Selecting a card and using the table selector plus “Seat at” provides a keyboard alternative. Browser interaction remains unverified because no browser is enabled in the available computer-use tool. Six venue tests and the production build pass.

## Higher-fidelity follow-up

After reviewing the seating interactions, refine the architectural shell in Blender using the collected empty-room photographs and a venue-confirmed measured plan. Prioritize correct columns, entrances and floor extents before materials, glazing, roof details, lighting and more realistic furniture. Keep the detailed shell separate from stable application table IDs and metre-based furniture transforms. A more realistic visual model should preserve the working seating interactions and saved layout. The current concept is intentionally provisional until the booked room and measurements are confirmed.


## Three.js visual fidelity update

The procedural scene now includes draped tablecloth folds, curved champagne-metal chair frames, upholstered seats, porcelain place settings, sage napkins, stemware and low floral arrangements. The shell has glazing mullions, column plates, roof trusses, honed stone slab variation, parquet edging, rippled lake geometry and arching palm fronds. These are visual refinements to the concept, not newly verified venue measurements.

The interactive view offers Golden hour and Daylight settings, filtered directional shadows, filmic tone mapping and environment reflections. Decorative meshes are batched by material and indexed to reduce duplicate vertices. Moving/rotating a table reuses its geometry; occupancy changes rebuild only the affected tables. Selection and drop feedback only change tabletop color.

Eight venue tests and the production build pass. Tests verify finite geometry, a mesh budget below 220, successful raycasting of all tables, stable table transforms, selective furniture rebuilding and assignment integrity. The updated 7.7 MB GLB was exported and reloaded with all 16 table groups intact. The local route returns HTTP 200. Visual rendering and device performance remain unverified because no browser is enabled in the computer-use tool.

## Simplified for non-technical users — 5 September 2026

The preview was reworked so a couple can use it without instructions. What changed:

- Two plain modes in the side panel: **Seat guests** (tap a table, see who is there, press "Seat here" or "Seat all 4 here", drag a name, or tap a name then tap a table) and **Arrange tables** (drag, rename, Round/Long, seat stepper, turn, nudge, add and remove with an inline confirmation). Tables cannot be dragged by accident in seat mode.
- Sample guests now have real-looking names in twenty families of four, and the list is grouped by family with "Need a seat" as the default filter.
- Guests can be added to the sample list by name and optional family; added guests can be removed. The browser draft now stores `{ tables, guests }`; older tables-only drafts still open.
- A summary strip shows tables, seats and how many guests still need a seat. Status messages name people and tables ("Ana Ramírez is now at Table 3", "Table 3 is full").
- Metre coordinates, JSON download and Blender GLB export moved under "For the design team". Research references became a "Venue photos" view.
- Verified by driving headless Chrome through Playwright (installed in a scratch directory, not the project): seat, family seat, full-table error, tap-to-place, remove, add guest, add/rename/reshape/turn/drag/remove a table, undo, reload persistence, start over, and a 390 px mobile layout. No console errors.

### First-visit walkthrough

On first open the page shows six short anchored tooltips (terrace, views, selected table, guest list, Arrange tables, Undo/Start over) with Next, Skip and a step counter. It is not modal; the page stays usable underneath. A "Show me around" button in the header replays it. The seen flag is `benavento-terrace-tour-v1` in localStorage. Implementation: `components/venue/Tour.tsx` positions each tip against a `data-tour` anchor and skips anchors that are not on screen (for example the guest list while in Arrange mode).
