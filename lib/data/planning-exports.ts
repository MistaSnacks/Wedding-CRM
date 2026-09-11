import { readAll } from "./query";
import type { BudgetItemRow, BudgetPaymentRow, VendorRow } from "@/lib/types";
import type { WeddingScope } from "./scope";
import type { CalendarEntry } from "./planning-rules";
import * as planning from "./planning";

export type PlanningReport = "budget" | "payments" | "vendors" | "tasks" | "cash-flow" | "vendor-cost-summary";
export async function planningExport(scope: WeddingScope, report: PlanningReport): Promise<Record<string, string | number>[]> {
  if (report === "tasks") return (await planning.tasks(scope)).map(t => ({ Task: t.title, "Due date": t.due_date ?? "", "Assigned to": t.assigned_to ?? "", Completed: t.completed_at ? "Yes" : "No" }));
  const [items, vendors, categoryRows, payments] = await Promise.all([
    readAll<BudgetItemRow>(() => scope.db.from("budget_items").select("*").eq("wedding_id", scope.weddingId).order("id")),
    readAll<VendorRow>(() => scope.db.from("vendors").select("*").eq("wedding_id", scope.weddingId).order("id")),
    readAll<{id:string;name:string}>(() => scope.db.from("budget_categories").select("id,name").eq("wedding_id", scope.weddingId).order("id")),
    readAll<BudgetPaymentRow>(() => scope.db.from("budget_payments").select("*").eq("wedding_id", scope.weddingId).order("id")),
  ]);
  const names = new Map(items.map(i => [i.id, i.name])), vendorNames = new Map(vendors.map(v => [v.id, v.name])), categories = new Map(categoryRows.map(c => [c.id, c.name]));
  const amount = (n: number | null) => n === null ? "" : (n / 100).toFixed(2);
  if (report === "cash-flow") {
    const groups = new Map<string, {month:string;currency:string;scheduled:number;paid:number;outstanding:number}>();
    for (const p of payments) {
      const month = p.due_date?.slice(0,7) ?? "Unscheduled", key = `${month}:${p.currency}`;
      const row = groups.get(key) ?? {month,currency:p.currency,scheduled:0,paid:0,outstanding:0};
      row.scheduled += p.amount_cents;
      if (p.paid_at) row.paid += p.amount_cents; else row.outstanding += p.amount_cents;
      groups.set(key,row);
    }
    return [...groups.values()].sort((a,b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)).map(g => ({"Due month":g.month,Currency:g.currency,Scheduled:amount(g.scheduled),Paid:amount(g.paid),Outstanding:amount(g.outstanding)}));
  }
  if (report === "vendor-cost-summary") return vendors.flatMap(v => {
    const linked = items.filter(i => i.vendor_id === v.id && !i.is_reconciliation);
    const related = payments.filter(p => p.vendor_id === v.id || linked.some(i => i.id === p.budget_item_id));
    return [...new Set([v.currency,...linked.map(i => i.currency),...related.map(p => p.currency)])].sort().map(currency => ({ Vendor:v.name,Currency:currency,"Vendor estimate":currency === v.currency ? amount(v.estimated_cents) : "","Vendor quote":currency === v.currency ? amount(v.quoted_cents) : "","Vendor contract":currency === v.currency ? amount(v.contracted_cents) : "","Linked budget forecast":amount(linked.filter(i => i.currency === currency).reduce((n,i) => n+(i.contracted_cents ?? i.quoted_cents ?? i.estimated_cents ?? 0),0)),"Payments scheduled":amount(related.filter(p => p.currency === currency).reduce((n,p) => n+p.amount_cents,0)),Paid:amount(related.filter(p => p.currency === currency && p.paid_at).reduce((n,p) => n+p.amount_cents,0)),Outstanding:amount(related.filter(p => p.currency === currency && !p.paid_at).reduce((n,p) => n+p.amount_cents,0))}));
  });
  if (report === "vendors") return vendors.map(v => ({ Vendor: v.name, Role: v.role ?? "", Status: v.status, Priority: v.priority, "Responsible person": v.assigned_to ?? "", Contact: v.contact_name ?? "", Company: v.company ?? "", Email: v.email ?? "", Phone: v.phone ?? "", Website: v.website ?? "", Currency: v.currency, Estimate: amount(v.estimated_cents), Quote: amount(v.quoted_cents), Contract: amount(v.contracted_cents), "Signed date": v.contract_signed_at ?? "", "Contract link": v.contract_url ?? "" }));
  if (report === "payments") return payments.map(p => ({ "Payment ID": p.id, Payment: p.label, "Budget line": names.get(p.budget_item_id) ?? "", Vendor: vendorNames.get(p.vendor_id ?? "") ?? "", Kind: p.kind, Amount: amount(p.amount_cents), Currency: p.currency, "Due date": p.due_date ?? "", "Paid date": p.paid_at ?? "", Method: p.method ?? "", Reference: p.reference ?? "", Receipt: p.receipt_url ?? "" }));
  return items.filter(i => !i.is_reconciliation).map(i => ({ Line: i.name, Category: categories.get(i.category_id) ?? "", Vendor: vendorNames.get(i.vendor_id ?? "") ?? "", Quantity: i.qty ?? "", "Unit price": amount(i.unit_price_cents), Currency: i.currency, Estimate: amount(i.estimated_cents), Quote: amount(i.quoted_cents), Contract: amount(i.contracted_cents), Paid: amount(payments.filter(p => p.budget_item_id === i.id && p.paid_at && p.currency === i.currency).reduce((n,p) => n+p.amount_cents,0)) }));
}

export async function calendarEntries(scope: WeddingScope): Promise<CalendarEntry[]> {
  const [taskRows, payments] = await Promise.all([planning.tasks(scope), planningExport(scope, "payments")]);
  return [
    ...taskRows.filter(t => !t.completed_at && t.due_date).map(t => ({ id: `task-${t.id}`, title: t.title, date: t.due_date!, description: t.assigned_to ?? undefined })),
    ...payments.filter(p => !p["Paid date"] && p["Due date"]).map(p => ({ id: `payment-${p["Payment ID"]}`, title: `Pay ${p["Budget line"]}: ${p.Payment}`, date: String(p["Due date"]), description: `${p.Amount} ${p.Currency}${p.Vendor ? ` · ${p.Vendor}` : ""}` })),
  ];
}
