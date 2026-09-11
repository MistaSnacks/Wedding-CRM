import type { BudgetTree } from "./budget";
import { assembleTree, rollUpBudget, overduePayments, upcomingPayments } from "./budget-rules";

/** Separate ledgers. Category targets and overrides belong only to the wedding's base currency. */
export function splitBudgetByCurrency(tree: BudgetTree, now: Date): BudgetTree[] {
  const currencies = [...new Set([tree.currency, ...tree.categories.flatMap(c => c.items.map(i => i.item.currency))])].sort();
  return currencies.map(currency => {
    const base = currency === tree.currency;
    const items = tree.categories.flatMap(c => c.items).filter(i => i.item.currency === currency);
    const categories = tree.categories.filter(c => base || items.some(i => i.item.category_id === c.category.id))
      .map(c => ({ ...c.category, target_cents: base ? c.category.target_cents : null, benchmark_cents: base ? c.category.benchmark_cents : null }));
    const payments = items.flatMap(i => i.payments);
    const rollups = assembleTree(categories, items.map(i => i.item), payments, now, tree.timeZone);
    return { ...tree, currency, categories: rollups,
      totals: rollUpBudget(rollups, base ? tree.totals.maxSpendCents : null),
      overdue: overduePayments(payments, now, tree.timeZone),
      upcoming: upcomingPayments(payments, now, tree.timeZone, 30) };
  });
}

export function currencyMoney(cents: number | null, currency: string): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
}
