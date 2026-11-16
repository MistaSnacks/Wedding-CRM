import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { loadReportData } from "@/lib/reports/guest-reports";
import { flattenReportRows, reportEvents } from "@/lib/reports/report-view";
import { REPORTS } from "@/lib/reports/catalog";
import { ExportCenter } from "@/components/admin/ExportCenter";
import { ReportBuilder } from "@/components/admin/reports/ReportBuilder";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  // Read-only, so viewers are welcome: the layout's requireAdmin is the gate,
  // the same as for the export route these numbers mirror.
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const [data, { data: wedding }] = await Promise.all([
    loadReportData(scope),
    scope.db.from("weddings").select("couple_names, timezone").eq("id", scope.weddingId).single(),
  ]);

  // Flattened here, on the server: the browser gets names, answers, meals and
  // tables only — never admin notes, invite codes or access tokens.
  const rows = flattenReportRows(data, { timeZone: wedding?.timezone ?? "America/Los_Angeles" });
  const events = reportEvents(data);

  return (
    <div className="flex flex-col gap-5">
      <div className="no-print">
        <h1 className="text-2xl font-semibold text-ink">Reports</h1>
        <p className="mt-1 max-w-2xl text-[13.5px] text-[#6b7167]">
          See who is coming, what they will eat and where they sit. Then download or print exactly what is on your screen.
        </p>
      </div>

      <ReportBuilder rows={rows} events={events} coupleNames={wedding?.couple_names ?? "Our wedding"} />

      <details className="no-print rounded-2xl border border-hairline bg-white/70 p-5 max-md:p-4">
        <summary className="cursor-pointer text-[15px] font-semibold text-ink">
          All standard downloads
          <span className="ml-2 text-[12.5px] font-normal text-muted">Ready-made files for budget, vendors, addresses and guests</span>
        </summary>
        <div className="mt-4">
          <ExportCenter reports={REPORTS} events={events.map((e) => ({ id: e.id, name: e.name }))} />
          <div className="mt-4 flex flex-wrap gap-2">
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
      </details>
    </div>
  );
}
