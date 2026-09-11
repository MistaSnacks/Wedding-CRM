import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { planningExport } from "@/lib/data/planning-exports";
import { toCsv } from "@/lib/reports/csv";
import { unstable_rethrow } from "next/navigation";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  const report = new URL(request.url).searchParams.get("report") ?? "vendors";
  if (report !== "vendors" && report !== "payments" && report !== "tasks") return Response.json({ message: "Choose vendors, payments, or tasks." }, { status: 400 });
  try {
    const rows = await planningExport(forWedding(admin.weddingId), report);
    return new Response(toCsv(rows), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ message: "The export couldn’t be completed. Please try again." }, { status: 503 });
  }
}
