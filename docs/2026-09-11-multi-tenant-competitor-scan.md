# Additional competitors and multi-tenant priorities

Research date: September 11, 2026. Scope: additional couple-facing and professional wedding/event products beyond Zola, The Knot, Aisle Planner, and the previously reviewed 3D tools.

**Method:** public product pages and official help documentation; no authenticated competitor testing. Feature descriptions are vendor claims, not verified performance or usability. This is a targeted scan, not an exhaustive market census. No paid accounts, outreach, or product trials were initiated.

The user asked for additional multi-tenant opportunities. Recommendations below are incorporated into the [multi-tenant roadmap](multi-tenant-roadmap.md). Couple CRM remains first; **3D remains the last feature phase**.

## Additional comparison set

| Product and audience | Documented capability relevant to us | Roadmap implication |
| --- | --- | --- |
| [That's The One](https://www.thatstheone.com/planners/wedding-features), professional wedding planners | Connected RSVP/seating, vendor records, payment tracking, multiple currencies, reusable templates, timelines, and vendor-specific exports. | Treat it as a close workflow comparator. Connected planning is already a competitive category; test our complete tasks against it. |
| [Joy](https://withjoy.com/), couples and guests | Wedding websites, guest lists, RSVP, registry, and hotel room blocks. Its [destination-wedding guide](https://withjoy.com/help/en/articles/15388665-planning-a-destination-wedding-with-joy) describes guest accommodation pages and booking links. | Travel information belongs in the core guest journey. Operational arrival/shuttle tracking is our proposed extension, not an established exclusive capability. |
| [Say I do](https://sayi.do/features), couples | Multilingual RSVP, custom questions, multiple events with different invitees, guest contact collection, checklists, custom domains, and QR access. | Languages, invitation-specific events, and easy contact collection are competitive expectations. Do not call them unique. |
| [Appy Couple](https://www.appycouple.com/features/), couples and guests | Family RSVPs, invitation-specific event visibility, travel content, guest updates, registry links, collaborators, and downloadable guest-app content for offline use. | Extend the guest journey beyond submitting an RSVP. Accessible mobile pages and dated offline handoffs deserve explicit scope. |
| [Planning.Wedding](https://planning.wedding/), couples and planners | Advertises free tools, low-friction entry, collaboration, budgets, timelines, seating, and printable event materials. | “All in one” and serving couples plus planners are not sufficient differentiation; onboarding and everyday usefulness matter. |
| [Timeline Genius](https://support.timelinegenius.com/en/collections/1557089-sharing), planners | Documents tailored vendor timelines, collaboration, and timeline sharing. | A wedding-day run sheet is distinct from a to-do list or payment calendar. Give it explicit roadmap scope. |
| [RSVPify](https://rsvpify.com/secondary-events/), event organizers | Per-event guest lists/check-in and tailored registration flows. [Its help page](https://help.rsvpify.com/en/articles/4853455-secondary-events) describes a primary/secondary event structure. | Include flexible event invitations and review whether lightweight arrival/check-in solves a real need; do not force our independent events into a primary-event hierarchy. |
| [Weduler](https://www.weduler.com/pricing/), couples | Advertises helper/co-planner access, a document vault, gift/thank-you tracking, and post-wedding tasks. | Preserve gift tracking and wedding closeout as later candidates. Feature availability by plan is not a reason to copy every feature. |

## Recommended additions

### A. Self-service setup and a personalized guest home — core phase

Create a wedding without developer intervention: date/timezone, language choices, currency, event schedule, guest import, and partner/planner invitation. Offer a small set of editable website themes, a stable wedding URL, registry links, and guest-view preview before publishing. Custom domains can follow the working default URL.

After RSVP, guests should return to their relevant schedule, maps, dress codes, travel information, response-editing options, and published seat information. Preserve household/event eligibility across pages, exports, and messages. A guest invited only to a welcome event must not need a reception invitation.

### B. Travel and accommodation coordination — core expansion

Keep hotel recommendations and the couple's room-block links alongside optional guest-reported arrival/departure details, lodging, and shuttle needs. Produce pickup/transport lists and flag incomplete details. Distinguish recommended accommodation from a guest's reported booking; do not infer reservations from clicks. Begin with coordination and links rather than operating a hotel booking service.

### C. Wedding-day timeline and limited sharing — shared-workflow phase

Add timed activities, durations, locations, responsible contacts, and vendor assignments. Surface conflicts and show consequences of proposed time shifts. Share only the relevant run sheet with each vendor or helper, with explicit permissions and revocation. A florist should not need access to guest contact details or the whole budget to see setup instructions.

Provide dated/revision-labelled downloadable handoffs for poor connectivity. They must disclose that later edits require a new download. Live acknowledgements and offline editing/sync are separate scope decisions.

### D. Wedding ownership and lifecycle — launch foundation

These are product/architecture recommendations, not claims that competitors lack them:

- Wedding-scoped roles, invitations, explicit ownership transfer, and a wedding selector for members involved in more than one wedding.
- Isolation covering records, files, exports, background jobs, emails, and caches, including when a planner serves several clients.
- Import preview, duplicate reconciliation, complete data export, recoverable changes, archiving, and an explicit deletion/retention policy.
- If paid tiers launch, clear entitlements and subscription state; define what happens to editing, exports, guest access, and scheduled messages after cancellation or downgrade.
- Couple ownership and access must survive a planner leaving; define planner-owned versus couple-owned wedding handoff.

## Later candidates, not immediate build commitments

- Gift/thank-you tracking linked to households and post-wedding closeout: final balances, outstanding tasks, export, and archive.
- Lightweight guest arrival/check-in if pilots demonstrate a need; keep separate from commercial ticketing/badging.
- Deeper calendar synchronization, approved communication integrations, planner branding, and reusable professional assets after the core workflow is reliable.

Retain registry links early; do not add registry fulfillment, a hotel marketplace, native apps, general-purpose AI chat, or a large vendor marketplace solely because a competitor has them. Evaluate each against user demand and operating cost. All selected additions must precede the final 3D phase.

## Corrections to competitive assumptions

- Multiple event invitations and multilingual RSVP are offered elsewhere. Historical “no consumer app does this” claims require fresh verification before reuse.
- Appy Couple explicitly documents invitation-specific event visibility; broad statements that competitors show all guests every event are unsupported.
- That's The One overlaps substantially with the proposed integrated planner workflow. A market opportunity must be demonstrated through usability, adoption, regional fit, or measured task outcomes.
- A limited public page cannot establish absence of a feature. No percentage parity score, unique-feature claim, or adoption/market-share estimate follows from this scan.

## Next validation when implementation begins

Use representative couple and planner accounts to benchmark onboarding, an RSVP/headcount change, contract intake, a vendor comparison, travel coordination, and vendor-specific handoff. Record task time, duplicate entry, errors, assistance needed, and successful completion. Prioritize observed pain before expanding the feature list.
