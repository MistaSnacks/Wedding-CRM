# Multi-tenant venue previews — deferred research

Saved: September 6, 2026. Sources reviewed during the September 5–6 discussion.

**Status updated September 11, 2026: 3D venue functionality is the very last feature phase in the [multi-tenant roadmap](multi-tenant-roadmap.md).** Core wedding CRM, connected workflows, and planner capabilities come first. Catalog scope, pricing, acquisition, and a pilot remain undecided. This record preserves research for that final phase; it does not authorize starting venue production now.

## Idea and current foundation

Offer realistic, interactive venue previews throughout the multi-tenant wedding product, retaining seating assignments, editable tables, 2D/3D views, and sharing. The approaches discussed were prebuilding venues, paid creation on request, or a hybrid.

The existing Benavento prototype demonstrates an editable Blender scene, a browser venue model, seating interactions, and downloadable interactive HTML. It is a photo-informed approximation with some published dimensions, not a surveyed or fully photorealistic replica. Its seating demo uses sample data and browser-local drafts; production RSVP/seating integration remains proposed.

- [Venue prototype](https://rsvp.julietandjuan.com/venue-preview)
- [Standalone interactive HTML](https://rsvp.julietandjuan.com/venue/benavento-interactive.html)
- [Blender workflow and artifacts](blender-venue-workflow.md)
- [Prototype/source notes](benavento-venue-prototype.md)
- [Proposed production seating integration](venue-seating-feature-plan.md)

## Competitive findings and their limits

We have **not proved that competitors lack this feature at scale**, or that our rendering quality exceeds theirs. The earlier [seating roadmap](seating-roadmap.md) distinguished consumer wedding apps from professional planning products and explicitly acknowledged Prismm/Merri for 3D walkthroughs and scaled floor plans. Its older feature claims should be rechecked before future positioning decisions.

| Product | Public evidence reviewed | What we can conclude |
| --- | --- | --- |
| Zola | Guest-linked seating charts, movable tables, floor plans, guest grouping, and exports. | Its reviewed public feature page does not establish a comparable realistic venue walkthrough. Absence from that page is not proof of absence across the product. |
| Prismm | Advertises scanned venues, dynamic 3D event tours, seating assignments, photorealistic table settings, 150,000+ floor plans, and a missing-floor-plan submission workflow. | Substantial functional overlap and catalog scale already exist. The floor-plan count is **not** a count of photorealistic venues or unique buildings. |
| Cvent | Advertises photorealistic walkthroughs, editable layouts, attendee/meal management, collaboration, and registration integration. | Professional event software overlaps with the proposed experience, including data integration. |

Sources:

- [Zola seating chart product page](https://www.zola.com/wedding-planning/seating-chart)
- [Zola seating chart help](https://www.zola.com/faq/360038917171-How-do-I-use-the-Zola-seating-chart-)
- [Prismm event design features](https://www.prismm.com/solutions/event-design-software)
- [Prismm spatial design / Matterport digital twins](https://www.prismm.com/the-platform/spatial-design-technology)
- [Cvent Event Diagramming features](https://www.cvent.com/en/event-marketing-management/cvent-event-design-software)
- [Cvent's April 24, 2025 acquisition of Prismm](https://www.cvent.com/en/press-release/cvent-acquires-spatial-event-design-technology-provider-prismm)
- [Cvent diagramming transition resources](https://community.cvent.com/solution-evolution/cvent-event-diagramming-resources) — describes access to Prismm through Cvent Event Diagramming starting May 13, 2026. Do not treat these as unrelated competitors or assume legacy Prismm packaging remains available.

**Positioning hypothesis:** make realistic venue planning easy and accessible within a couple-facing wedding website and planning workflow. Validate usability, price, regional venue coverage, and the complete workflow through current product demos before claiming an advantage. Vendor marketing claims have not been independently benchmarked.

## Feasibility and catalog strategy

Thousands of venues are feasible as a gradually growing library; producing accurate, realistic models of all of them upfront would require an ongoing content-production operation. A single venue may have several distinct rooms or outdoor spaces.

The reusable parts are the editor, seating logic, furniture library, lighting controls, and sharing. The main per-space work is obtaining adequate references, reconstructing architecture, checking dimensions, refining materials, optimizing for browsers, and handling revisions.

| Approach | Benefit | Cost or uncertainty |
| --- | --- | --- |
| Prebuild a broad catalog | Immediate availability for covered venues | Upfront production and maintenance for spaces that may never be used |
| Create on request | Demand guides spending | Turnaround time, incomplete references, and custom labor can exceed a small fee |
| Hybrid | Popular spaces are ready; requests grow the library | Requires a managed production queue and clear pricing/quality expectations |

Discussion recommendation, **not an approved plan**: start mainly on demand with a small showcase catalog, then expand into a hybrid if measured demand and costs support it. A suggested pilot size of 10–20 venues was illustrative, not a forecast or commitment. Configurable room templates could provide a useful fallback for uncovered venues.

Scraping can help with discovery and reference gathering. Marketing photos do not reliably establish dimensions, hidden corners, columns, or complete editable room geometry. Automated reconstruction works better with deliberate capture:

- [Polycam's interior capture guide](https://learn.poly.cam/hc/en-us/articles/48339214285844-How-to-Capture-High-Fidelity-Interior-Scans-in-Object-Mode) requires overlapping imagery across multiple passes and identifies glass, mirrors, and moving objects as reconstruction problems.
- [Apple RoomPlan](https://developer.apple.com/augmented-reality/roomplan/) uses camera and LiDAR on supported devices to produce room geometry with dimensions in USD/USDZ. This can supply a starting point; detailing and validation would still be needed for our use.

An intake process could request a current floor plan, dimensions, empty-room photos, a guided walkthrough or scan, and the exact event space. Review available materials before promising price or delivery. Record asset provenance, reuse permission, measurement confidence, and the venue's verification status.

## Multi-tenant model if pursued

- Maintain a reusable architectural model **per venue space**, with stable identity and version history for renovations or corrections.
- Keep each wedding's guest data, assignments, and layout drafts private and tenant-scoped.
- Store furniture placements separately from the shared architectural shell; reuse the same layout state in 2D and 3D.
- Preserve the model version used by an approved event layout so an architectural update cannot silently change it.
- Add completed models to the shared library only where the agreed asset permissions allow reuse.
- Retain a usable floor-plan/list interface when 3D is unavailable or unsuitable for a device.

## Demand reports and potential prioritization data

We did **not** find a comprehensive public ranking of verified annual wedding bookings or occupancy for individual venues. Public attention signals are useful proxies and must be labelled as such.

| Source | Useful information | Limits |
| --- | --- | --- |
| [The Knot Worldwide: 2025 Future of Celebrations](https://www.theknotww.com/news/the-knot-worldwide-2025-future-of-celebrations-report) | Named top-venue lists in the US, UK, Spain, and France | Rankings use storefront views on the publisher's platforms, not confirmed bookings. US list uses views since 2024; UK/Spain/France lists use January–June 2025. Platform exposure may affect rank. |
| [Bridebook: UK Wedding Report 2026](https://partners.bridebook.com/uk/wedding-report-2026) | Venue-type demand, forward bookings, and behavior; describes insights from 7,000+ couples | Category/market research, not an individual-venue occupancy leaderboard; UK findings do not automatically generalize to Mexico or the US. |
| [Bodas.com.mx: Mexico Wedding Industry Report 2025](https://www.bodas.com.mx/articulos/organizacion-de-una-boda-datos-y-curiosidades-en-mexico--c10606) | Mexican spending, planning, and venue-discovery behavior | Market context, not venue-by-venue booking totals. Article updated April 22, 2025. |
| [The Knot: 2026 Real Weddings Study announcement](https://www.theknotww.com/news/the-knot-worldwide-unveils-2026-real-weddings-study-5) | US spending and planning context from 10,000+ couples married in 2025 | Survey/platform population; does not establish a ranked venue catalog. |
| [Bodas.com.mx Jalisco directory](https://www.bodas.com.mx/lugares-de-boda/jalisco) | Candidate discovery, venue types, capacity information, and reviews | Directory order, review totals, and advertised capacity are not annual wedding volume. |

The first five US venues named in the Future of Celebrations list were The Opal Haus, Northfield Estate, Renault Winery, Windows on the Lake, and Nanina's in the Park. These are **research candidates based on listing views**, not a selected launch catalog. No bookings were inferred for them and no venue outreach was performed.

## How to choose a first batch

Use annual wedding volume and reachable customers alongside production cost. Occupancy percentage alone can mislead: hypothetically, a venue hosting 30 weddings at full capacity could offer fewer potential users than one hosting 150 weddings with dates still available.

Candidate evaluation fields:

1. Market, venue, and exact space; fit with the intended customer base.
2. Actual user requests for that venue.
3. Search interest, recent wedding-review activity, and listing popularity, with source/date and explicit proxy labels.
4. Annual weddings and upcoming bookings reported by the venue, with reporting period and confidence.
5. Willingness of the venue/planners to recommend the product to their couples.
6. Existing models, scans, floor plans, dimensions, photo coverage, and reuse permissions.
7. Number of distinct spaces, estimated production effort, and expected maintenance.
8. Existing competitor coverage and whether our proposed experience would add value.

A concentrated Guadalajara/Jalisco pilot building from Benavento was suggested because of the existing model and context. **The launch geography remains undecided**; US and Mexico-wide approaches were also raised. No ranked shortlist has been produced.

## Pricing and decision gates

A small fee may work for unlocking an existing model. First-time custom creation must cover reference gathering, modeling, review, revisions, and browser optimization. Venue-funded creation, sponsorship, or a separate creation fee are hypotheses to test; no price or turnaround has been validated.

Before committing to expansion, measure human hours per model, revision effort, asset/compute costs, browser performance, requests converting to paid use, repeat usage across weddings, and venue-driven customer acquisition. Set success thresholds before a pilot and allow the decision to be proceed, narrow the scope, defer, or stop.

When revisiting:

- Recheck competitor features, catalog claims, packaging, and pricing; this research is a dated snapshot.
- Choose the launch market and required quality level: visual concept, dimensionally verified planner, or detailed venue replica.
- Identify accessible source material and willing venue partners.
- Build a small evidence-backed shortlist and measure production economics before promising broad coverage.
- Follow the September 11 decision: 3D is the last feature phase. At that point, decide which venue capabilities justify implementation and which should remain deferred. Saving these notes does not activate implementation work.
