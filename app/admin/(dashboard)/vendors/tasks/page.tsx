import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as planning from "@/lib/data/planning";
import { planningExport } from "@/lib/data/planning-exports";
import { calendarDayDelta, calendarDayIn, formatCalendarDate } from "@/lib/format/wedding-date";
import { PlanningTasks } from "@/components/admin/vendors/PlanningTasks";
export const dynamic = "force-dynamic";
export default async function TasksPage() {
  const admin = await requireAdmin(); const scope = forWedding(admin.weddingId);
  const [tasks, vendors, wedding, payments] = await Promise.all([planning.tasks(scope), scope.db.from("vendors").select("id,name").eq("wedding_id", scope.weddingId).order("name"), scope.db.from("weddings").select("timezone").eq("id", scope.weddingId).single(), planningExport(scope, "payments")]);
  if (vendors.error || wedding.error) throw new Error(vendors.error?.message ?? wedding.error?.message);
  const zone = wedding.data.timezone ?? "America/Los_Angeles";
  const today = calendarDayIn(new Date(), zone);
  const outstanding = payments.filter(p => !p["Paid date"]).sort((a,b) => String(a["Due date"] || "9999").localeCompare(String(b["Due date"] || "9999")));
  const money = (amount: unknown, currency: unknown) => {
    const n = Number(amount);
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "USD") }).format(n);
    } catch {
      return `${amount} ${currency}`;
    }
  };
  const dueLabel = (due: string) => {
    const days = calendarDayDelta(due, new Date(), zone);
    const when = formatCalendarDate(due) ?? due;
    if (days < 0) return `Overdue since ${when}`;
    if (days === 0) return `Due today, ${when}`;
    if (days <= 14) return `Due ${when} · in ${days} ${days === 1 ? "day" : "days"}`;
    return `Due ${when}`;
  };
  return <div className="flex flex-col gap-6">
    <div>
      <Link href="/admin/vendors" className="text-[13px] text-olive underline-offset-2 hover:underline">← Vendors</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[22px] font-semibold text-ink">Payments & tasks</h1>
        <a href="/admin/vendors/calendar" className="rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-olive hover:text-olive-deep">Add due dates to my calendar</a>
        <a href="/admin/vendors/export?report=payments" className="rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-olive hover:text-olive-deep">Download payments</a>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">What you still owe, soonest first, and your own to-do notes. The calendar file is a snapshot: download it again after you change a date.</p>
    </div>
    <section aria-labelledby="owed-title" className="rounded-2xl border border-hairline bg-white/75 p-5 max-md:p-4">
      <h2 id="owed-title" className="text-[14.5px] font-semibold text-ink">Still to pay <span className="font-normal text-muted">· {outstanding.length}</span></h2>
      {outstanding.length > 0 && <ul className="mt-2 divide-y divide-hairline">
        {outstanding.map(p => {
          const due = p["Due date"] ? String(p["Due date"]) : "";
          const late = Boolean(due) && due < today;
          return <li key={p["Payment ID"]} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-3">
            <Link href="/admin/budget" className="min-w-0 flex-1 basis-56 text-[13.5px] font-medium text-ink underline decoration-[#cfd3c4] underline-offset-2 hover:text-olive-deep">{p["Budget line"]}<span className="font-normal text-muted"> · payment {p.Payment}</span></Link>
            <span className="text-[13.5px] font-semibold tabular-nums text-ink">{money(p.Amount, p.Currency)}</span>
            <span className={`basis-64 text-[13px] max-md:basis-full ${late ? "font-medium text-rose-deep" : "text-muted"}`}>{due ? dueLabel(due) : "No due date yet"}</span>
          </li>;
        })}
      </ul>}
      {!outstanding.length && <p className="mt-2 text-[13.5px] text-muted">Nothing left to pay. Every payment is marked paid.</p>}
    </section>
    <PlanningTasks tasks={tasks} vendors={vendors.data ?? []} canEdit={admin.role !== "viewer"} today={today} />
  </div>;
}
