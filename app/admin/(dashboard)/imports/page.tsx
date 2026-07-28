import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { loadImportContext } from "@/lib/data/imports";
import { ImportWizard } from "@/components/admin/ImportWizard";
import { ExportCenter, type ExportReport } from "@/components/admin/ExportCenter";
import { ReviewInbox, type AppliedItem, type InboxItem } from "@/components/admin/ReviewInbox";
import * as submissions from "@/lib/data/submissions";
import { classify, scoreCandidates } from "@/lib/sync/match";
import { parseSubmission } from "@/lib/sync/sheet";
import { configuredReader, loadCandidatePool } from "@/lib/sync/run";

export const dynamic = "force-dynamic";

const REPORTS: ExportReport[] = [
  { key: "guest-list", label: "Full guest list", group: "Guest lists", description: "Everyone, with RSVPs, meals, dietary notes, and tables" },
  { key: "households", label: "Household list", group: "Guest lists", description: "One row per household — contacts, party size, invite code" },
  { key: "addresses", label: "Mailing addresses", group: "Guest lists", description: "One row per household, ready for envelopes or a mail house" },
  { key: "rsvp-status", label: "RSVP progress", group: "RSVPs", description: "How many in each household have answered" },
  { key: "attending", label: "Attending guests", group: "RSVPs", description: "Everyone who said yes, with their meal choice" },
  { key: "declined", label: "Declined guests", group: "RSVPs", description: "Everyone who said no" },
  { key: "pending", label: "Awaiting reply", group: "RSVPs", description: "Invited guests who haven't answered yet" },
  { key: "caterer", label: "Caterer report", group: "For your vendors", description: "Attending guests with meals, kids' meals, and dietary needs" },
  { key: "meals", label: "Meal counts", group: "For your vendors", description: "Totals for each dish" },
  { key: "dietary", label: "Dietary restrictions", group: "For your vendors", description: "Guests with dietary notes or allergies, and their tables" },
  { key: "accessibility", label: "Accessibility requests", group: "For your vendors", description: "Guests who asked for accommodations" },
  { key: "seating", label: "Seating chart", group: "For your vendors", description: "Who sits at which table, per event" },
];

export default async function ImportsPage() {
  // Page-level gating is the layout's requireAdmin: this route also hosts the
  // whole Export center, which viewers are entitled to (see the export route's
  // own requireAdmin gate). Only the write surface below is editor-gated.
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const context = await loadImportContext(scope);
  const canImport = admin.role !== "viewer";

  // The review inbox: score each waiting response against the guest list here,
  // server-side, so the browser never sees the whole directory.
  const [pending, applied, pool] = await Promise.all([
    submissions.listByStatus(scope, "pending"),
    submissions.listApplied(scope),
    loadCandidatePool(scope),
  ]);

  const inboxItems: InboxItem[] = pending.map((row) => {
    const s = parseSubmission(row.raw);
    const decision = classify(s, scoreCandidates(s, pool), pool);
    return {
      id: row.id,
      name: `${s.first} ${s.last}`.trim(),
      email: s.email,
      phone: s.phone,
      address: s.address,
      notes: s.notes,
      receivedAt: s.receivedAt,
      optOut: s.optOut,
      multiPerson: decision.bucket === "review" ? decision.multiPerson : false,
      candidates:
        decision.bucket === "review"
          ? decision.candidates.map((c) => ({
              householdId: c.householdId,
              householdName: c.householdName,
              guestName: c.guestName,
              score: c.score,
              reasons: c.reasons,
            }))
          : [],
    };
  });

  const householdNames = new Map(pool.map((c) => [c.householdId, c.householdName]));
  const appliedItems: AppliedItem[] = applied.map((row) => {
    const s = parseSubmission(row.raw);
    return {
      id: row.id,
      name: `${s.first} ${s.last}`.trim() || s.email,
      householdName: (row.household_id && householdNames.get(row.household_id)) || "a household",
      fields: Object.keys(row.applied ?? {}),
      status: row.status === "created" ? "created" : "matched",
    };
  });

  const connected = configuredReader() !== null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">Imports &amp; Exports</h1>
        <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
          Bring in your guest list from a CSV, or export anything for vendors.
        </p>
      </div>

      {/* Real enforcement is requireEditor() inside the server actions; this
          only hides a surface a viewer could not use anyway. */}
      {canImport && <ImportWizard events={context.events} mealOptions={context.mealOptions} />}

      {(inboxItems.length > 0 || appliedItems.length > 0) && (
        <ReviewInbox
          items={inboxItems}
          applied={appliedItems}
          connected={connected}
          canEdit={canImport}
        />
      )}

      <div className="rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Export center</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Pick a report and it downloads straight to your computer.
        </p>
        <ExportCenter reports={REPORTS} />
        <div className="mt-4 flex gap-2">
          <Link
            href="/admin/print/escort-cards"
            className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose"
          >
            Print escort cards
          </Link>
          <Link
            href="/admin/print/place-cards"
            className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose"
          >
            Print place cards
          </Link>
        </div>
      </div>
    </div>
  );
}
