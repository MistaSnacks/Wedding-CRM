import Link from "next/link";
import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { loadImportContext } from "@/lib/data/imports";
import { ImportWizard } from "@/components/admin/ImportWizard";
import { ExportCenter } from "@/components/admin/ExportCenter";
import { REPORTS } from "@/lib/reports/catalog";
import { ReviewInbox, type AppliedItem, type InboxItem } from "@/components/admin/ReviewInbox";
import * as submissions from "@/lib/data/submissions";
import { classify, scoreCandidates } from "@/lib/sync/match";
import { parseSubmission } from "@/lib/sync/sheet";
import { configuredReader, loadCandidatePool } from "@/lib/sync/run";

export const dynamic = "force-dynamic";

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
  const [pending, applied, pool, syncHealth] = await Promise.all([
    submissions.listByStatus(scope, "pending"),
    submissions.listApplied(scope),
    loadCandidatePool(scope),
    submissions.latestRun(scope),
  ]);

  const inboxItems: InboxItem[] = pending.map((row) => {
    const s = parseSubmission(row.raw);
    const decision = classify(s, scoreCandidates(s, pool), pool);
    return {
      id: row.id,
      version: createHash("sha256").update(JSON.stringify(row.raw)).digest("hex"),
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
          : decision.bucket === "auto_email" ? [{ householdId: decision.householdId, householdName: pool.find(c=>c.householdId===decision.householdId)?.householdName ?? "Household", guestName: `${s.first} ${s.last}`, score: 1, reasons:[decision.reason] }] : [],
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
      {canImport && <ImportWizard weddingId={admin.weddingId} events={context.events} mealOptions={context.mealOptions} />}

      {(
        <ReviewInbox
          items={inboxItems}
          applied={appliedItems}
          connected={connected}
          canEdit={canImport}
          health={syncHealth}
        />
      )}

      <div className="rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Export center</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Pick a report and it downloads straight to your computer.
        </p>
        <p className="mt-2 text-[13px] text-ink">
          Want to look before you download?{" "}
          <Link href="/admin/reports" className="font-medium text-olive-deep underline underline-offset-2 hover:text-rose">
            See reports on screen →
          </Link>
        </p>
        <ExportCenter reports={REPORTS} events={context.events} />
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
