import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as planning from "@/lib/data/planning";
import { planningExport } from "@/lib/data/planning-exports";
import { calendarDayIn } from "@/lib/format/wedding-date";
import { PlanningTasks } from "@/components/admin/vendors/PlanningTasks";
export const dynamic = "force-dynamic";
export default async function TasksPage() {
  const admin = await requireAdmin(); const scope = forWedding(admin.weddingId);
  const [tasks, vendors, wedding, payments] = await Promise.all([planning.tasks(scope), scope.db.from("vendors").select("id,name").eq("wedding_id", scope.weddingId).order("name"), scope.db.from("weddings").select("timezone").eq("id", scope.weddingId).single(), planningExport(scope, "payments")]);
  if (vendors.error || wedding.error) throw new Error(vendors.error?.message ?? wedding.error?.message);
  const today = calendarDayIn(new Date(), wedding.data.timezone ?? "America/Los_Angeles");
  const outstanding = payments.filter(p => !p["Paid date"]).sort((a,b) => String(a["Due date"] || "9999").localeCompare(String(b["Due date"] || "9999")));
  return <div className="flex flex-col gap-6"><Link href="/admin/vendors" className="text-sm text-olive underline">Vendors</Link><div className="flex flex-wrap items-center gap-3"><h1 className="flex-1 text-[22px] font-semibold">Tasks & payments</h1><a href="/admin/vendors/calendar" className="text-sm text-olive underline">Download calendar</a><a href="/admin/vendors/export?report=payments" className="text-sm text-olive underline">Export payments</a></div><p className="text-sm text-muted">The calendar includes open tasks and unpaid installments with due dates. Import it again after changes; this is a dated download.</p>
    <section className="rounded-xl border border-hairline p-5"><h2 className="font-semibold">Outstanding payments</h2>{outstanding.map(p => <div key={p["Payment ID"]} className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-hairline pt-3 text-sm"><Link href="/admin/budget" className="font-medium text-olive underline">{p["Budget line"]} · {p.Payment}</Link><span>{p.Amount} {p.Currency}</span><span className={p["Due date"] && String(p["Due date"]) < today ? "font-medium text-rose-deep" : "text-muted"}>{p["Due date"] ? `${String(p["Due date"]) < today ? "Overdue · " : "Due "}${p["Due date"]}` : "Needs a due date"}</span></div>)}{!outstanding.length && <p className="mt-2 text-sm text-muted">No unpaid installments.</p>}</section>
    <PlanningTasks tasks={tasks} vendors={vendors.data ?? []} canEdit={admin.role !== "viewer"} today={today} />
  </div>;
}
