import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { loadImportContext } from "@/lib/data/imports";
import { ImportWizard } from "@/components/admin/ImportWizard";
import { ExportLinks } from "@/components/admin/ExportLinks";

export const dynamic = "force-dynamic";

const REPORTS = [
  { key: "guest-list", label: "Full guest list" },
  { key: "households", label: "Household list" },
  { key: "rsvp-status", label: "RSVP status report" },
  { key: "attending", label: "Attending guests" },
  { key: "declined", label: "Declined guests" },
  { key: "pending", label: "Pending guests" },
  { key: "meals", label: "Meal counts" },
  { key: "dietary", label: "Dietary restrictions" },
  { key: "accessibility", label: "Accessibility requests" },
  { key: "seating", label: "Seating chart" },
  { key: "addresses", label: "Mailing addresses" },
  { key: "caterer", label: "Caterer report" },
];

export default async function ImportsPage() {
  // Page-level gating is the layout's requireAdmin: this route also hosts the
  // whole Export center, which viewers are entitled to (see the export route's
  // own requireAdmin gate). Only the write surface below is editor-gated.
  const admin = await requireAdmin();
  const context = await loadImportContext(forWedding(admin.weddingId));
  const canImport = admin.role !== "viewer";

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

      <div className="rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Export center</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Pick a report and it downloads straight to your computer — CSV, or XLSX for Excel.
        </p>
        <ExportLinks reports={REPORTS} />
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
