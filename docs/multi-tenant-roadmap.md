# Multi-tenant wedding CRM roadmap

Updated: September 11, 2026.

**Product decision:** serve both couples and wedding planners, with the couple's wedding CRM as the first priority. The workflows below are accepted roadmap items, not a record of completed implementation or an instruction to begin building them immediately.

**Sequencing decision: 3D venue functionality is the very last feature phase.** Complete the core CRM, connected workflows, and planner capabilities before expanding or integrating the existing 3D prototype. Venue model production, catalog acquisition, Blender automation, photorealistic previews, and paid model requests belong to that final phase. They are not launch requirements.

## Product promise

Know what changed, what it affects, and what to do next.

Help couples and their planners make decisions with fewer repeated entries, missed consequences, and conflicting versions. Existing competitors already connect some workflows; integration alone is not a proven unique feature. Validate advantages through complete tasks with real users rather than feature counts.

## 1. Core wedding CRM and collaboration foundations

Finish and verify the connected essentials: guests and households, event invitations and RSVPs, vendors and documents, budget and payments, seating, tasks, and communication. Make mobile use dependable. Let the couple invite their planner into the same wedding with appropriate permissions and wedding-scoped data access.

Audit what is deployed, what exists only locally, and what remains proposed before estimating new work. Existing helpers or tests do not establish a complete user-facing workflow.

Address routine friction alongside the work below:

- Rename and reclassify uploaded documents without re-uploading them.
- Compare shortlisted vendors by service, including quote amount/currency, inclusions, exclusions, and notes. Do not compare unlike packages as equivalent.
- Show the next action for each vendor: awaiting quote, contract, deposit, or follow-up.
- Keep contacts, source paperwork, budget entries, payment deadlines, and tasks connected.

### Multi-tenant launch requirements

- Self-service wedding setup: date/timezone, event schedule, language choices, currency, guest import, and partner/planner invitation. Provide a few editable website themes, a stable wedding URL, registry links, and guest-view preview before publishing. Custom domains can follow the default URL.
- Establish wedding ownership, invitation/revocation, role boundaries, explicit ownership transfer, and a wedding selector where a member belongs to multiple weddings. A couple must retain access when a planner leaves.
- Verify isolation across wedding records, files, exports, background jobs, outgoing communication, and caches. Planner membership in several weddings must not leak information between them.
- Provide previewed imports with duplicate reconciliation, complete exports, recoverable changes, and explicit archive/deletion policies.
- Before launching paid plans, define entitlements, billing lifecycle, and what cancellation/downgrade means for editing, guest access, exports, and scheduled messages. Pricing itself remains undecided.

### Guest experience beyond RSVP

- A personalized guest home with only invited events, venue maps, dress codes, response editing, relevant travel details, and published seat information. Guests should not need an app installation to use essential functions.
- Support household/group responses, appropriate follow-up questions, contact collection, and consistent language across guest pages and messages. Keep event eligibility independent: welcome-event-only guests must be supported.
- Add optional guest-reported lodging, arrival/departure, and shuttle needs, with useful pickup lists and missing-information follow-up. Preserve the couple's hotel/room-block links. A recommendation or link click is not proof of a reservation.

These additions are informed by the [September 11 competitor scan](2026-09-11-multi-tenant-competitor-scan.md). Several have partial foundations in the repository; inventory and verify them before adding duplicate implementations. They accompany core CRM development without displacing the first signature workflow below.

## 2. RSVP changes show seating and catering consequences

First signature workflow: when a household changes its RSVP, identify affected seats, missing meal choices, headcount-dependent costs, and previously exported reports that need refreshing.

Example: four guests accept; the couple sees which need seats or meal choices and any proposed catering cost adjustment. A displayed amount must come from the actual agreement and eligible headcount, not a guessed per-person rate.

Acceptance direction:

- Use the same event attendance and household records throughout; preserve unrelated events and existing assignments.
- Respect fixed prices, minimum guarantees, tiers, child pricing, taxes/fees, and currency where those terms are captured. Flag incomplete pricing rather than inventing a precise change.
- Show proposed changes and their basis before applying financial or seating decisions. Preserve manual overrides and detect changes made since review.
- Make stale exports identifiable by the event data/revision used to generate them; refreshing an export does not mean a vendor has received it.
- Produce consistent guest, seating, meal, and caterer reports after the accepted changes.

The initial experience must work with ordinary seating lists and 2D layouts; it has no 3D dependency.

## 3. Documents become reviewed budget entries and deadlines

Upload a vendor contract or quote, review extracted terms, and confirm proposed budget entries, installments, and tasks.

Acceptance direction:

- Suggest total price, currency, deposit, balance due date, and relevant deadlines such as final headcount.
- Show the source page/text and uncertainty for each extracted value. Leave missing or ambiguous terms unresolved for review.
- Confirm selected proposals before writing; never silently overwrite a manually entered price or payment schedule.
- Detect duplicate uploads and revised contracts so processing them does not create duplicate charges or tasks.
- Keep source document/revision references on accepted entries and retain the decision history.
- Distinguish a recorded signed date from electronic signing, and payment tracking from processing a payment.

## 4. A short action list based on the actual wedding

Bring relevant consequences from the previous workflows into a prioritized list with a reason, owner, due date, and a direct next step.

Example: “Your caterer needs the final count Friday. Six guests haven't replied. Review a reminder.”

Acceptance direction:

- Use actual deadlines, outstanding payments, unanswered invitations, missing meal choices, and unresolved seating issues.
- Explain why an item appears and resolve it when the underlying condition changes.
- Avoid duplicate or stale reminders; recheck attendance, payment, and task state before delivery.
- Let users review recipients and message content, or use an explicitly enabled automation policy. Suggested actions do not themselves authorize sending messages.
- Provide a useful empty state when nothing needs attention, rather than a generic checklist of already completed work.

## 5. Shared couple/planner decisions and handoff

A planner proposes a vendor, budget, document, or seating change. The couple reviews the affected details and cost, approves or requests changes, and the wedding team sees the same decision.

Acceptance direction:

- Give proposals clear ownership and states such as proposed, changes requested, approved, and superseded.
- Attach discussion and approval history to the relevant record/document version.
- Show a before/after comparison and reject approvals based on outdated data.
- Keep proposed layouts and assignments separate from published guest seating until explicitly accepted/published.
- Preserve who decided what and when; a new document upload does not automatically approve its contents.
- Generate a current handoff with contacts, deadlines, agreed layout, guest/meal details, and appropriately scoped documents.

### Wedding-day timeline and vendor handoff

- Add a run sheet with times, durations, locations, responsible contacts, and vendor assignments; a task due date or payment calendar is not a run sheet.
- Flag timing conflicts and preview the consequences of time changes before applying them. Preserve explicitly fixed times and manual exceptions.
- Give each vendor/helper access only to their relevant timeline, instructions, contacts, and approved files. Include explicit view/edit permissions and revocation; do not require full wedding membership just to receive a limited handoff.
- Offer dated/revision-labelled printable or downloadable handoffs for weak connectivity. Clearly show that subsequent changes require refreshing the download; do not imply an offline copy stays live.
- Keep preparing, sharing, recipient access, and acknowledgement distinct. Generating a packet does not mean the recipient has received or approved it.

### Later wedding-lifecycle candidates

Evaluate gift/thank-you tracking tied to households, final balances and outstanding tasks, and post-wedding export/archive. Lightweight arrival/check-in is another pilot-dependent candidate. These are lower-priority extensions, not required before testing the core CRM; if selected, place them before the final 3D phase.

## 6. Professional planner layer

After the couple CRM and shared workflows are dependable, expand to managing multiple weddings, reusable templates, client onboarding, proposals, and invoicing. Define business-level versus wedding-level access before sharing data across projects. Validate the scope with planners; these professional tools must not complicate the couple's ordinary workflow.

A basic wedding selector and safe collaborator access belong to the launch foundations; portfolio dashboards, reusable business assets, and sales operations belong here. Use That's The One and Timeline Genius alongside Aisle Planner when evaluating professional workflows. Consider deeper calendar/communication integrations and planner branding only where validated demand justifies them.

## 7. Last: 3D venues

Only after the preceding phases, revisit production 3D seating integration, realistic venue walkthroughs, and a reusable venue catalog. The existing Benavento preview remains a prototype/reference, not a reason to pull this phase forward.

The final-phase placement is decided. Geography, quality target, pricing, catalog strategy, and whether each proposed venue feature justifies its cost remain open. See [venue research and sources](multi-tenant-venue-research.md) and [venue seating integration notes](venue-seating-feature-plan.md).

## How to demonstrate improvement over competitors

Benchmark the same representative wedding tasks with couples and planners:

1. Add a vendor contract and payment schedule.
2. Handle an RSVP change after seating is arranged.
3. Compare two catering quotes with different inclusions.
4. Give a planner an accurate final handoff.
5. Create and publish a new wedding, import guests, and invite a planner without developer assistance.
6. Coordinate arrivals/shuttle needs and share a vendor-specific run sheet without exposing unrelated private data.

Measure completion time, repeated data entry, missed consequences, errors, and help required. Record comparable starting data and task scope. Set targets during implementation planning; no performance advantage or numerical parity score has been established yet.

## Related records

- [Additional competitor scan and recommended priorities](2026-09-11-multi-tenant-competitor-scan.md) — Joy, Say I do, Appy Couple, That's The One, Planning.Wedding, Timeline Genius, RSVPify, and Weduler; public documentation, not authenticated testing.
- [Vendor/document workflow references and release verification](2026-09-11-vendors-documents-ux.md)
- [Earlier seating roadmap](seating-roadmap.md) — historical feature proposals; this document governs current multi-tenant sequencing.
- [Deferred venue research](multi-tenant-venue-research.md) — competitor evidence, demand reports, and catalog economics.

Competitor reference points: [Zola seating](https://www.zola.com/wedding-planning/seating-chart), [The Knot vendor organization](https://www.theknot.com/content/keep-track-wedding-vendors), and [Aisle Planner vendor documents/collaboration](https://help.aisleplanner.com/en/articles/2126693-uploading-contracts-and-other-files-into-a-project). These informed the September 11 discussion; recheck current behavior before making comparative marketing claims.
