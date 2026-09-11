# Vendors and documents usability — September 11, 2026

## Why Vendors returned 404

The live deployment `dpl_GGp4okDd9zNCSQqgb6sbHc3JhF23` was built from commit `eade727`. That commit had vendor data helpers and links from the budget, but no vendor pages. The vendor routes existed only as untracked local files. The live `/admin/vendors` returned HTTP 404; the local route correctly redirected anonymous visitors to sign in.

The release is prepared from that production commit with only the vendor/document routes, their components, supporting helpers, navigation links, and required planning schema source. Other pending guest, RSVP, communications, budget, and automation changes are excluded. Migration 0016 was already applied to the live database on September 4; this release does not run migrations or enable schedules.

## What competitors do

| Product | Verified behavior | Application here |
| --- | --- | --- |
| [Zola Marketplace](https://www.zola.com/faq/how-do-i-use-zolas-marketplace) | Couples favorite vendors, send inquiries, and mark vendors booked. [Inquiries](https://www.zola.com/faq/where-can-i-see-my-inquiries-from-vendors) have a separate home. | Make booking progress visible through All vendors, Considering, Booked, and Not booked filters. |
| [The Knot Vendor Manager](https://www.theknot.com/content/keep-track-wedding-vendors) | Organizes a shortlist by category, supports quote comparison, and records booked vendors. Its [checklist contact details](https://helpcenter.theknot.com/hc/en-us/articles/360043128171-How-do-I-add-a-personal-contact-to-a-vendor-related-to-do-in-the-Checklist) keep a contact name, phone, and email beside a vendor task. | Keep contacts, paperwork, and follow-ups near each vendor; show essential fields first. |
| [Aisle Planner vendor files](https://help.aisleplanner.com/en/articles/2126693-uploading-contracts-and-other-files-into-a-project) | Stores files in the project’s vendor contact record, supports drag-and-drop and renaming, keeps distinct versions, and offers preview/download/delete actions. | Keep vendor context while adding a shared Documents page, suggested editable names and types, multiple-file selection, and separate Open/Download actions. |

These findings come from the products’ public documentation, not authenticated account testing. Zola’s reviewed material describes discovery and booking; it does not establish whether Zola has a comparable document library.

## Juliet’s workflow

1. Open Vendors and add a name, service, and any known contact details. Pricing and contract fields can be expanded later.
2. Open Documents, choose the vendor once, and choose or drop several files. From a vendor page, that vendor is already selected.
3. Review suggested names and types, then upload. Each file has its own result; successful files are preserved when another fails. An uncertain network result asks for a refresh before re-adding that file.
4. Find files by name, vendor, or type. Open a file in a new tab or download a copy. Deletion requires an explicit confirmation.

Files remain private to wedding members. Editor checks, wedding-scoped queries, content checks, and short-lived signed URLs remain in force. Supported uploads are PDF, JPG, PNG, and plain text, up to 3 MB each. Filenames suggest categories; file contents are not parsed into prices, payments, or signed-contract status.

## Verification

- Isolated release: 43 test files / 772 tests passed, with a successful production build on the deployed Next.js version (16.2.10).
- Workspace: 154 focused document, vendor, planning, and database integration tests passed.
- Authenticated local production-build checks: Vendors, add-vendor view, booking filter, Documents, tasks, calendar, vendor/payment CSV exports, Budget, and RSVP all returned 200. Invalid vendor links returned the recovery page.
- Safari: reviewed sample document layout, upload form, and category filtering. Corrected native select sizing. Native file-picker automation did not complete; upload-route behavior was checked with isolated tests rather than uploading test records into the wedding.
