import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { headcountProposals } from "@/lib/data/planning";
import { HeadcountEstimates } from "@/components/admin/budget/HeadcountEstimates";
export const dynamic = "force-dynamic";
export default async function HeadcountPage() {
  const admin = await requireAdmin(); const scope = forWedding(admin.weddingId);
  const [proposals, items, events] = await Promise.all([headcountProposals(scope), scope.db.from("budget_items").select("id,name,currency").eq("wedding_id", scope.weddingId).order("name"), scope.db.from("events").select("id,name").eq("wedding_id", scope.weddingId).order("sort_order")]);
  if (items.error || events.error) throw new Error(items.error?.message ?? events.error?.message);
  return <div className="flex flex-col gap-5"><Link href="/admin/budget" className="text-sm text-olive underline">Budget</Link><h1 className="text-[22px] font-semibold">Headcount-linked estimates</h1><p className="max-w-3xl text-sm text-muted">Attendee counts update from current RSVPs and invitations. Review the proposed amount, then apply it to the estimate. Quotes and signed contract prices stay separate, so changing attendance never overwrites a negotiated amount.</p><HeadcountEstimates proposals={proposals} items={items.data ?? []} events={events.data ?? []} canEdit={admin.role !== "viewer"} /></div>;
}
