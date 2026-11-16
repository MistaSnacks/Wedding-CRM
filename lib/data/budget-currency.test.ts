import { describe, expect, it } from "vitest";
import { splitBudgetByCurrency, currencyMoney } from "./budget-currency";
import { assembleTree, rollUpBudget, type ItemFact } from "./budget-rules";
import type { BudgetTree } from "./budget";
describe("separate currency ledgers", () => {
  it("does not add pesos to dollars or duplicate category targets across ledgers", () => {
    const now = new Date("2026-09-04T12:00:00Z");
    const base: ItemFact = { id: "usd", category_id: "food", vendor_id: null, name: "Dinner", benchmark_cents: null, estimated_cents: 10000, quoted_cents: null, contracted_cents: null, currency: "USD", pending_guest_count: false, sort_order: 0 };
    const categories = assembleTree([{ id: "food", name: "Food", target_cents: 30000, benchmark_cents: 15000, is_contingency: false, sort_order: 0 }], [base, { ...base, id: "mxn", name: "Drinks", currency: "MXN", estimated_cents: 200000 }], [{ id: "payment", item_id: "mxn", label: "Deposit", amount_cents: 50000, due_date: null, paid: true, paid_on: "2026-09-01" }], now, "America/Mexico_City");
    const tree: BudgetTree = { categories, totals: rollUpBudget(categories, 100000), vendorsById: {}, overdue: [], upcoming: [], timeZone: "America/Mexico_City", benchmarkLabel: "Reference", currency: "USD" };
    const split = splitBudgetByCurrency(tree, now);
    const usd = split.find(t => t.currency === "USD")!, mxn = split.find(t => t.currency === "MXN")!;
    expect(usd.totals.forecastCents).toBe(10000); expect(usd.totals.paidCents).toBe(0);
    expect(mxn.totals.forecastCents).toBe(200000); expect(mxn.totals.paidCents).toBe(50000);
    expect(mxn.totals.maxSpendCents).toBeNull(); expect(mxn.categories[0].category.target_cents).toBeNull();
    expect(mxn.categories[0].category.benchmark_cents).toBeNull(); expect(usd.totals.maxSpendCents).toBe(100000);
    expect(currencyMoney(10000, "MXN")).toContain("MXN");
  });
});
