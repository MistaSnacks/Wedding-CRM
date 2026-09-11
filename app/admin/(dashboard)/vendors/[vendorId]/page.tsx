import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as vendors from "@/lib/data/vendors";
import * as budget from "@/lib/data/budget";
import * as planning from "@/lib/data/planning";
import { VendorDocuments } from "@/components/admin/vendors/VendorDocuments";
import { safeDocumentUrl } from "@/lib/data/planning-rules";
import { VendorForm } from "@/components/admin/vendors/VendorForm";
import { VendorLinks } from "@/components/admin/vendors/VendorLinks";
import { currencyMoney } from "@/lib/data/budget-currency";
import { notFound } from "next/navigation";
import { z } from "zod";
export const dynamic = "force-dynamic";
export default async function VendorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  const admin = await requireAdmin(); const scope = forWedding(admin.weddingId); const { vendorId } = await params;
  if (!z.uuid().safeParse(vendorId).success) notFound();
  const [categories, wedding] = await Promise.all([budget.listCategories(scope), scope.db.from("weddings").select("timezone").eq("id", scope.weddingId).single()]);
  if (wedding.error) throw new Error(wedding.error.message);
  const detail = await vendors.detail(scope, vendorId, new Date(), wedding.data.timezone ?? "America/Los_Angeles").catch(error => {
    if (error instanceof vendors.VendorNotFoundError) notFound();
    throw error;
  });
  const canEdit = admin.role !== "viewer";
  const documents = await planning.documents(scope, vendorId);
  let contractUrl: string | null = null; try { contractUrl = safeDocumentUrl(detail.vendor.contract_url); } catch {}
  return <div className="flex flex-col gap-5"><Link href="/admin/vendors" className="text-sm text-olive underline">All vendors</Link><h1 className="text-[22px] font-semibold">{detail.vendor.name}</h1>
    {contractUrl && <a href={contractUrl} target="_blank" rel="noreferrer" className="text-sm text-olive underline">Open contract</a>}
    <div className="grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]"><VendorForm vendor={detail.vendor} categories={categories} canEdit={canEdit} /><div className="flex flex-col gap-4"><VendorLinks vendorId={vendorId} vendorName={detail.vendor.name} items={detail.items.map(i => ({ id: i.item.id, name: i.item.name }))} options={detail.unlinkedItemOptions} canEdit={canEdit} />
      <section className="rounded-xl border border-hairline p-5"><h2 className="font-semibold">Budget position</h2>{detail.items.map(i => <p className="mt-2 text-sm" key={i.item.id}>{i.item.name}: {currencyMoney(i.forecastStage === null ? null : i.forecastCents, i.item.currency)} forecast · {currencyMoney(i.paidCents, i.item.currency)} paid</p>)}</section>
      <div id="documents" className="scroll-mt-5"><VendorDocuments vendorId={vendorId} documents={documents} canEdit={canEdit} /></div>
      <Link href="/admin/vendors/tasks" className="text-sm text-olive underline">Manage deadlines and follow-ups</Link>
    </div></div>
  </div>;
}
