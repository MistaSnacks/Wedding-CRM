import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as vendors from "@/lib/data/vendors";
import * as budget from "@/lib/data/budget";
import { VendorForm } from "@/components/admin/vendors/VendorForm";
import { isPending, isSecured } from "@/lib/data/vendor-rules";
import { currencyMoney } from "@/lib/data/budget-currency";
export const dynamic = "force-dynamic";
export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ new?: string; q?: string; status?: string }> }) {
  const admin = await requireAdmin(); const scope = forWedding(admin.weddingId); const params = await searchParams;
  const [settings, categories, wedding] = await Promise.all([budget.settings(scope), budget.listCategories(scope), scope.db.from("weddings").select("timezone").eq("id", scope.weddingId).single()]);
  if (wedding.error) throw new Error(wedding.error.message);
  const rows = await vendors.list(scope, new Date(), wedding.data.timezone ?? "America/Los_Angeles");
  const query = (params.q ?? "").trim().toLocaleLowerCase();
  const status = ["considering", "booked", "passed"].includes(params.status ?? "") ? params.status! : "all";
  const groups = [
    { value: "all", label: "All vendors", count: rows.length },
    { value: "considering", label: "Considering", count: rows.filter(v => isPending(v.status)).length },
    { value: "booked", label: "Booked", count: rows.filter(v => isSecured(v.status)).length },
    { value: "passed", label: "Not booked", count: rows.filter(v => v.status === "passed").length },
  ];
  const visible = rows.filter(v => (status === "all" || (status === "considering" ? isPending(v.status) : status === "booked" ? isSecured(v.status) : v.status === "passed"))
    && [v.name, v.role, v.contact_name, v.email, v.company].some(s => s?.toLocaleLowerCase().includes(query)));
  return <div className="flex flex-col gap-5"><div className="flex flex-wrap items-center gap-3"><h1 className="flex-1 text-[22px] font-semibold">Vendors</h1><Link href="/admin/documents" className="text-sm text-olive underline">Documents</Link><Link href="/admin/vendors/tasks" className="text-sm text-olive underline">Tasks & payments</Link><a href="/admin/vendors/export" className="text-sm text-olive underline">Export</a>{admin.role !== "viewer" && <Link href="/admin/vendors?new=1" className="rounded-lg bg-olive-deep px-4 py-2 text-sm text-cream">Add vendor</Link>}</div>
    <p className="text-sm text-muted">Your wedding team, their contact details, and paperwork — all together.</p>
    {params.new === "1" && <VendorForm categories={categories} canEdit={admin.role !== "viewer"} currency={settings.currency} />}
    <div className="flex flex-wrap gap-2" aria-label="Filter vendors by booking status">{groups.map(group => <Link key={group.value} href={`/admin/vendors?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(group.value !== "all" ? { status: group.value } : {}) })}`} aria-current={status === group.value ? "page" : undefined} className={`flex min-h-11 items-center rounded-full px-4 py-2 text-sm ${status === group.value ? "bg-olive-deep text-cream" : "bg-white/70 text-muted hover:bg-sage-band"}`}>{group.label} <span className="ml-2 text-xs">{group.count}</span></Link>)}</div>
    <form className="flex gap-2">{status !== "all" && <input type="hidden" name="status" value={status} />}<label className="flex-1 text-sm">Search vendors<input name="q" defaultValue={params.q} placeholder="Name, role, contact, email…" className="mt-1 w-full rounded-lg border border-hairline p-2" /></label><button className="self-end rounded-lg border border-hairline px-4 py-2 text-sm">Search</button></form>
    <div className="grid gap-3 md:grid-cols-2">{visible.map(v => <Link href={`/admin/vendors/${v.id}`} key={v.id} className="rounded-xl border border-hairline bg-paper/40 p-4 hover:border-olive"><div className="flex gap-3"><h2 className="flex-1 font-semibold">{v.name}</h2><span className="text-xs capitalize text-muted">{v.status}</span></div><p className="mt-1 text-sm text-muted">{v.role ?? "Role not set"} · {v.contact_name ?? v.company ?? "Contact not set"}</p><p className="mt-2 text-sm">Contract {currencyMoney(v.contracted_cents, v.currency)} · {v.linkedItemCount} budget lines</p>{v.status === "booked" && !v.contract_signed_at && <p className="mt-1 text-sm text-rose-deep">Contract signature needed</p>}{v.nextDueDate && <p className={`mt-1 text-xs ${v.hasOverduePayment ? "text-rose-deep" : "text-muted"}`}>Next unpaid installment: {v.nextDueDate}</p>}</Link>)}</div>
    {!visible.length && <p className="rounded-xl border border-hairline p-6 text-sm text-muted">{query || status !== "all" ? <>No vendors match this view. <Link href="/admin/vendors" className="text-olive underline">Show all vendors</Link></> : "Add your first vendor to track contacts, contracts, payments, and tasks."}</p>}
  </div>;
}
