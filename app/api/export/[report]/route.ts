import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { GUEST_REPORTS, buildGuestReport, loadReportData, ReportInputError, type ReportTable } from "@/lib/reports/guest-reports";
import { planningExport, type PlanningReport } from "@/lib/data/planning-exports";
import { catererSummary } from "@/lib/reports/caterer-summary";
import { toCsv } from "@/lib/reports/csv";

/**
 * Echoes the client's one-time download token back as a short-lived cookie.
 *
 * This is the only way the page can honestly know the file arrived: an `<a
 * href>` download fires no load event and leaves no trace in the document, so
 * without a signal from the response itself any "downloaded ✓" would just be a
 * timer guessing. Deliberately not HttpOnly — reading it is the entire point —
 * and it carries no data beyond the opaque token the client just minted, so
 * there is nothing here worth stealing. Format-validated because it lands in a
 * response header.
 */
function downloadReceipt(request: Request): Record<string, string> {
  const token = new URL(request.url).searchParams.get("dl");
  if (!token || !/^[A-Za-z0-9_-]{1,64}$/.test(token)) return {};
  return { "Set-Cookie": `export_download=${token}; Path=/; Max-Age=60; SameSite=Lax` };
}

export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const admin = await requireAdmin();
  const { report } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  const planningReports = ["budget", "payments", "vendors", "tasks", "outstanding-payments", "paid-expenses", "cash-flow", "vendor-cost-summary"];
  if (!GUEST_REPORTS.includes(report as typeof GUEST_REPORTS[number]) && !planningReports.includes(report)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  if (!["csv", "xlsx"].includes(format)) return NextResponse.json({ error: "Choose CSV or Excel" }, { status: 400 });
  const eventId = new URL(request.url).searchParams.get("event");
  const receipt = { ...downloadReceipt(request), "Cache-Control": "private, no-store" };

  let table: ReportTable;
  try {
    if (planningReports.includes(report)) {
      const kind: PlanningReport = report === "outstanding-payments" || report === "paid-expenses" ? "payments" : report as PlanningReport;
      const rows = await planningExport(forWedding(admin.weddingId), kind);
      const filtered = report === "outstanding-payments" ? rows.filter(r => !r["Paid date"]) : report === "paid-expenses" ? rows.filter(r => Boolean(r["Paid date"])) : rows;
      table = { name: report.replace(/-/g, " "), rows: filtered.map(row => ({ ...row, "Generated at": new Date().toISOString() })) };
    } else {
      table = buildGuestReport(await loadReportData(forWedding(admin.weddingId)), report, eventId);
    }
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Export failed", error);
    return NextResponse.json({ error: "The report could not be completed. Please try again." }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx") {
    const ws = XLSX.utils.json_to_sheet(table.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, table.name.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31));
    if (report === "caterer") for (const extra of catererSummary(table)) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(extra.rows),extra.name);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${report}-${stamp}.xlsx"`,
        ...receipt,
      },
    });
  }

  return new NextResponse(toCsv(table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}-${stamp}.csv"`,
      ...receipt,
    },
  });
}
