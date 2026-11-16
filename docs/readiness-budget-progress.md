# Budget and vendor readiness implementation

Updated 2026-09-04. Changes are local; no production migrations, uploads, data mutations, deployment, or emails were performed.

| Audit item | Implemented result |
| --- | --- |
| F24 | Successful drawer writes refetch notes, quantity, unit price, and receipts. Failed blur writes retain the draft instead of resetting it from unchanged props. |
| F25 | Drawer detail reads use item identity and generation guards; closing or switching items invalidates late responses. Failed loads have an explicit retry. |
| F26 | Vendor list/search, creation, full detail/editing, guarded budget linking/unlinking, contract links, and typed deletion confirmation now exist. Viewer access is read-only with editor checks on writes. |
| F27 | Mixed currencies render separate ledgers and totals; spending limits/category targets stay in the wedding's base currency. No combined spending conclusion or conversion. Currency changes cannot relabel existing payments. Migration rejects legacy item/payment currency mismatches pending review. |
| F28 | New installment entry awaits the outcome, keeps failed drafts, disables in-flight inputs, guards Enter/repeated submission, and uses a stable operation UUID for matching retries. |
| F29 | Clearing the last priced amount surfaces the returned warning through the normal status message. |
| F54, budget portion | Drawer traps Tab/Shift+Tab, focuses its panel, respects Escape consumed by an input, and restores focus to the opener. |
| F60, seed portion | Contextual category-header detection reproduces the corrected real source: 11 categories, 79 items (74 source + 5 reconciliation), forecast 6,297,000 cents. Harp remains an item and Other Vendors becomes a category without hardcoding either name. |
| A10 | Per-event adult/child/infant/all-attendee estimate links show reviewed deltas. Reads paginate and count only live invitations, yes responses, and active households. SQL rechecks count, link, currency, and old estimate atomically; quote/contract fields are preserved. |
| A11 | Contract sync is explicit and compares current vendor/line values under locks, preserving manual prices and rejecting currency changes or ambiguous multiple links. The deposit/balance workflow now writes both installments atomically, handles an exact retry without duplicates, refuses replacement of an existing different schedule, and preserves existing price fields. |

Completed capabilities:

- Vendor contacts, ownership, lifecycle status, pricing, booked/signed dates, contract URL, and private notes are editable without developer intervention.
- Private vendor document upload/download/delete supports PDF, JPEG, PNG, and text up to 3 MB. Storage is private; downloads use short-lived signed URLs after wedding membership checks. Documents must be removed through the storage-aware route before vendor deletion; a restrictive FK and transactional vendor deletion prevent orphan metadata/partial unlinking. Vendor deletion preserves budget lines/payments and removes its planning tasks.
- Planning task creation/edit/completion/deletion, responsible people, due dates, vendor links, outstanding installments, and an all-day calendar download. Calendar IDs are stable and private task notes are excluded.
- CSV/XLSX exports: budget ledger, vendor directory, all payments, outstanding payments, paid expenses, tasks, monthly cash flow, and vendor cost summary. Monetary totals stay separate by currency. Default reports exclude private notes, reference benchmark figures, and reconciliation-only budget lines. Full collections paginate past 1,000 records; calendar payment identity uses payment UUIDs.
- Budget page uses the authenticated admin's wedding scope.

Validation completed:

- TypeScript `npx tsc --noEmit` passed after integration.
- Seven focused suites passed **372 tests**: budget rules, vendor rules, seed parser, currency ledgers, planning rules, export/headcount reads, and actual SQL migration/invariant tests.
- SQL coverage includes stale/foreign headcount refusal, uninvited and archived exclusions, preserving prices, guarded vendor sync, atomic vendor deletion, atomic/replay-safe installment creation, currency constraints, private storage configuration, and public RPC privilege refusal.
- Export/read tests include 1,101 records, private-note/reference exclusion, currency-separated cash flow/vendor totals, and stable calendar IDs.

Release prerequisites and honest limits:

- Apply and verify migration `0016_budget_vendor_readiness.sql` with the coordinated 0015–0019 release migrations. No existing production currency data or storage configuration was inspected here. A legacy cross-currency payment fails the migration with an explicit review message.
- Authenticated browser verification of drawer save/failure/focus flows, vendor attachments, export downloads, and headcount acceptance remains a release smoke check. Library/SQL tests do not substitute for that UI verification.
- Calendar is an explicit download, not a subscription or external calendar integration; refreshed downloads reflect later changes. Tasks/payment reminders do not send messages automatically. Uploaded documents are stored and linked, not OCR-parsed into contracts or payment dates.
- Headcount and contract changes are reviewed proposals; the app does not silently adjust signed contracts, guess allocation across several linked budget lines, convert currencies, or generate deposit percentages without input.
- File upload and vendor creation are not durable background jobs. After an ambiguous network result, the UI directs a refresh before retrying; the installment and task workflows have explicit replay handling.

Independent integration review was sent to the root agent. Root corrected capped seating reads and clarified that publication exposes the live chart; guest/report joins were reviewed for event and wedding scope.
