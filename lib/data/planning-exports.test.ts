import { describe, expect, it } from "vitest";
import { planningExport, calendarEntries } from "./planning-exports";
import { headcountProposals } from "./planning";
import type { WeddingScope } from "./scope";

type Row = Record<string, unknown>;
/** A PostgREST-shaped read fixture with real range pagination and scoped filters. */
function scopeFor(tables: Record<string, Row[]>): WeddingScope {
  return { weddingId: "w", db: { from(table: string) {
    let rows = tables[table] ?? [];
    const query = {
      select() { return query; }, order() { return query; },
      eq(key: string, value: unknown) { rows = rows.filter(r => r[key] === value); return query; },
      is(key: string, value: unknown) { rows = rows.filter(r => (r[key] ?? null) === value); return query; },
      range(from: number, to: number) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); },
    };
    return query;
  } } as unknown as WeddingScope["db"] };
}
const item = {id:"i",wedding_id:"w",name:"Dinner",category_id:"c",vendor_id:"v",currency:"USD",estimated_cents:10000,quoted_cents:null,contracted_cents:null,unit_price_cents:null,benchmark_cents:999999,notes:"PRIVATE",qty:null};
const vendor = {id:"v",wedding_id:"w",name:"Caterer",currency:"USD",estimated_cents:10000,quoted_cents:null,contracted_cents:null,notes:"PRIVATE"};
const payment = {id:"p",wedding_id:"w",budget_item_id:"i",vendor_id:"v",label:"Deposit",amount_cents:2000,currency:"USD",due_date:"2026-10-01",paid_at:null,notes:"PRIVATE"};
describe("planning report privacy, currencies, and complete collections", () => {
  it("exports over 1,000 budget lines without reference figures, reconciliation rows, or private notes", async () => {
    const scope = scopeFor({ budget_items:[...Array.from({length:1101},(_,i) => ({...item,id:String(i)})),{...item,id:"recon",is_reconciliation:true}],vendors:[vendor] });
    const rows = await planningExport(scope,"budget");
    expect(rows).toHaveLength(1101);
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|999999|benchmark|recon/);
  });
  it("keeps cash flow and vendor costs separate by currency, and calendar IDs unique", async () => {
    const scope = scopeFor({budget_items:[item],vendors:[vendor],budget_payments:[payment,{...payment,id:"p2",currency:"MXN",amount_cents:50000,paid_at:"2026-09-01"},{...payment,id:"p3",due_date:null}],planning_tasks:[]});
    const cash = await planningExport(scope,"cash-flow");
    expect(cash).toContainEqual({"Due month":"2026-10",Currency:"USD",Scheduled:"20.00",Paid:"0.00",Outstanding:"20.00"});
    expect(cash).toContainEqual({"Due month":"2026-10",Currency:"MXN",Scheduled:"500.00",Paid:"500.00",Outstanding:"0.00"});
    const summary = await planningExport(scope,"vendor-cost-summary");
    expect(summary).toHaveLength(2); expect(summary.find(r=>r.Currency === "MXN")?.["Vendor contract"]).toBe("");
    for (const report of ["budget","payments","vendors","tasks"] as const) expect(JSON.stringify(await planningExport(scope,report))).not.toContain("PRIVATE");
    const entries = await calendarEntries(scope); expect(entries).toHaveLength(1); expect(entries[0].id).toBe("payment-p");
  });
  it("counts every live attendee beyond the REST row cap and excludes archived households", async () => {
    const guests = Array.from({length:1101},(_,n) => ({id:`g${n}`,wedding_id:"w",household_id:`h${n}`,age_type:"adult"}));
    const scope = scopeFor({budget_items:[item],budget_headcount_links:[{wedding_id:"w",item_id:"i",event_id:"e",age_scope:"adult",unit_price_cents:100}],events:[{id:"e",wedding_id:"w",name:"Dinner"}],guests,households:guests.map((g,n)=>({id:g.household_id,wedding_id:"w",archived_at:n===1100?"2026-09-01":null})),household_event_invites:guests.map(g=>({wedding_id:"w",household_id:g.household_id,event_id:"e"})),guest_event_responses:guests.map(g=>({wedding_id:"w",guest_id:g.id,event_id:"e",attending:"yes"}))});
    expect(await headcountProposals(scope)).toMatchObject([{count:1100,proposedCents:110000}]);
  });
});
