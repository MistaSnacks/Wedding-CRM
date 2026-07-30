/**
 * Pure rules for the budget module — every number the budget screens show,
 * computed from plain facts.
 *
 * No I/O, no React, no `Date.now()`, no `Math.random()`. Clocks arrive as a
 * `now: Date` parameter and the venue's zone arrives as a string. This is not
 * style: vitest's `include` is `lib/**`, so a branch written inside a server
 * action or a component is untested forever. `lib/data/budget.ts` stays a thin
 * shell around Supabase and delegates every decision here.
 *
 * Two rules run through the whole file and explain most of its shape.
 *
 * **Nothing stores a total.** There is no `actual_cents` column and no stored
 * payment status. Actual spend is `Σ amount_cents where paid`, and status is
 * derived on read. A stored total is a number that drifts the first time
 * someone edits a line, and drift is what the couple abandoned the spreadsheet
 * over.
 *
 * **`null` is not `0`.** Every `Σ` treats a null as zero, because a missing
 * number contributes nothing to a sum. But `BenchmarkDelta` preserves the null,
 * because "we haven't priced this yet" and "we plan to spend nothing here" are
 * different claims, and collapsing them renders as "$0 — 100% under budget"
 * next to a real reference figure. That reference column is the feature; a
 * false comparison in it is worse than a blank.
 */

import { calendarDayDelta, calendarDayIn } from "@/lib/format/wedding-date";

// ---------------------------------------------------------------------------
// Input facts — structural subsets of the DB rows
// ---------------------------------------------------------------------------

/** One `budget_payments` row, as read. */
export type PaymentFact = {
  id: string;
  item_id: string;
  label: string;
  amount_cents: number;
  /** A Postgres `date`: a calendar day, no instant, no zone. Never `new Date()` it. */
  due_date: string | null;
  paid: boolean;
  paid_on: string | null;
};

/** One `budget_items` row, as read. */
export type ItemFact = {
  id: string;
  category_id: string;
  vendor_id: string | null;
  name: string;
  /** The reference wedding's actual. The signature column; never a forecast fallback. */
  benchmark_cents: number | null;
  estimated_cents: number | null;
  quoted_cents: number | null;
  contracted_cents: number | null;
  currency: string;
  pending_guest_count: boolean;
  sort_order: number;
};

/**
 * One `budget_categories` row, as read.
 *
 * `benchmark_cents` is a **nullable override**, not a stored rollup: the real
 * spreadsheet's category totals do not reconcile with the sum of their rows, so
 * a category may carry its own reference figure. Resolution is
 * `category.benchmark_cents ?? Σ item.benchmark_cents` — see
 * `categoryBenchmarkCents`. `target_cents` is the allocation target written by
 * percentage seeding and is *not* a benchmark and *not* a forecast.
 */
export type CategoryFact = {
  id: string;
  name: string;
  target_cents: number | null;
  benchmark_cents: number | null;
  is_contingency: boolean;
  sort_order: number;
};

// ---------------------------------------------------------------------------
// Derived shapes
// ---------------------------------------------------------------------------

export type PaymentStatus = "paid" | "overdue" | "due_soon" | "upcoming" | "unscheduled";
export type ItemPaymentStatus = "unpaid" | "partial" | "paid" | "overdue";
export type CostStage = "benchmark" | "estimated" | "quoted" | "contracted";
export type BudgetHealth = "under" | "on_track" | "tight" | "over" | "unset";

/**
 * A comparison against the reference wedding.
 *
 * `benchmarkCents` and `actualCents` stay nullable on purpose — see the module
 * doc. `pct` is a fraction (0.9 means 90% over) and is `null` whenever the
 * benchmark is `0` or unknown, so nothing downstream can render `Infinity%`.
 */
export type BenchmarkDelta = {
  benchmarkCents: number | null;
  actualCents: number | null;
  deltaCents: number | null;
  pct: number | null;
  direction: "over" | "under" | "even" | "unknown";
};

export type PaymentView = PaymentFact & {
  status: PaymentStatus;
  /** Signed days from today-at-the-venue. Negative = overdue. Null when unscheduled. */
  daysOut: number | null;
  /** "Due today" | "Due in 3 days" | "4 days overdue" | "Paid Jul 12" | "No due date" */
  label_due: string;
};

export type ItemRollup = {
  item: ItemFact;
  payments: PaymentView[];
  /** Σ of ALL payment rows, paid or not. */
  scheduledCents: number;
  /** Σ of paid payments. This IS "actual spend" — nothing stores it. */
  paidCents: number;
  /** Σ of unpaid payments. */
  outstandingScheduledCents: number;
  /** contracted ?? quoted ?? estimated ?? 0 — the single forecast number. */
  forecastCents: number;
  /** Which column `forecastCents` came from, so the UI can caption it. */
  forecastStage: CostStage | null;
  /** forecast − paid, floored at 0. What is still owed. */
  remainingCents: number;
  /** remaining − outstandingScheduled, floored at 0. Owed with no payment row yet. */
  unscheduledCents: number;
  paymentStatus: ItemPaymentStatus;
  benchmark: BenchmarkDelta;
  hasOverdue: boolean;
};

export type CategoryRollup = {
  category: CategoryFact;
  items: ItemRollup[];
  /** Resolved benchmark with unknowns as 0, for summing. The nullable one is in `benchmark`. */
  benchmarkCents: number;
  estimatedCents: number;
  quotedCents: number;
  contractedCents: number;
  forecastCents: number;
  paidCents: number;
  remainingCents: number;
  outstandingScheduledCents: number;
  unscheduledCents: number;
  /** Category benchmark vs category forecast, nulls preserved. */
  benchmark: BenchmarkDelta;
  /** Overdue *payments* in this category, not overdue items. */
  overdueCount: number;
  overdueCents: number;
  /** Share of the whole wedding's forecast, as a fraction. 0 — never NaN — when the grand total is 0. */
  shareOfForecast: number;
};

export type BudgetTotals = {
  maxSpendCents: number | null;
  benchmarkCents: number;
  estimatedCents: number;
  quotedCents: number;
  contractedCents: number;
  /** "Total Cost". */
  forecastCents: number;
  /** "Total Spent". */
  paidCents: number;
  /** "Total Due" = forecast − paid, floored at 0. */
  dueCents: number;
  outstandingScheduledCents: number;
  unscheduledCents: number;
  /** "Left in budget": maxSpend − forecast. Negative = over. Null when maxSpend is unset. */
  remainingAfterForecastCents: number | null;
  /** maxSpend − paid. Null when maxSpend is unset. */
  remainingAfterPaidCents: number | null;
  benchmark: BenchmarkDelta;
  health: BudgetHealth;
  overdueCount: number;
  overdueCents: number;
  itemCount: number;
  /** True when >1 distinct currency appears — the UI must warn, never convert. */
  mixedCurrency: boolean;
  currencies: string[];
};

export type DepositSplit =
  | { ok: true; deposit: number; balance: number }
  | { ok: false; message: string };

export type AllocationSlice = { name: string; pct: number; isContingency?: boolean };
export type AllocationResult = {
  name: string;
  pct: number;
  targetCents: number;
  isContingency: boolean;
};

/** Thrown by `allocateByPercent` when the plan itself is unusable. */
export class AllocationError extends Error {}

export type BudgetFieldError = {
  field:
    | "name"
    | "benchmark"
    | "estimated"
    | "quoted"
    | "contracted"
    | "quantity"
    | "unitPrice"
    | "label"
    | "amount"
    | "dueDate"
    | "paidOn";
  message: string;
};

export type ItemDraft = {
  name: string;
  benchmarkCents?: number | null;
  estimatedCents?: number | null;
  quotedCents?: number | null;
  contractedCents?: number | null;
  quantity?: number | null;
  unitPriceCents?: number | null;
};

export type ItemValue = {
  name: string;
  benchmarkCents: number | null;
  estimatedCents: number | null;
  quotedCents: number | null;
  contractedCents: number | null;
  quantity: number | null;
  unitPriceCents: number | null;
};

export type ItemValidation =
  | { ok: true; value: ItemValue; warning?: string }
  | { ok: false; errors: BudgetFieldError[] };

export type PaymentDraft = {
  label?: string | null;
  amountCents: number | null;
  dueDate?: string | null;
  paid?: boolean;
  paidOn?: string | null;
  /**
   * Σ `amount_cents` of the item's *other* payment rows — everything except the
   * one being validated. The overspend warning needs the new total, and passing
   * it in keeps this function pure instead of handing it the payment list.
   */
  otherScheduledCents?: number;
};

export type PaymentValue = {
  label: string;
  amountCents: number;
  dueDate: string | null;
  paid: boolean;
  paidOn: string | null;
};

export type PaymentValidation =
  | { ok: true; value: PaymentValue; warning?: string }
  | { ok: false; errors: BudgetFieldError[] };

export type CategoryValidation =
  | { ok: true; value: { name: string } }
  | { ok: false; errors: BudgetFieldError[] };

// ---------------------------------------------------------------------------
// Small private helpers
// ---------------------------------------------------------------------------

/**
 * True when two `YYYY-MM-DD` strings share a year and month.
 *
 * A pure string compare on the first seven characters. Parsing either side into
 * a `Date` to read `getMonth()` would shift the day across a zone boundary and
 * put the 31st into the following month.
 */
function sameCalendarMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * `"2026-07-12"` → `"Jul 12"`, for the "Paid …" chip.
 *
 * Formatted in UTC off an explicit UTC-midnight parse, which is the same trick
 * `formatCalendarDate` uses: a `date` column has no instant, so the only way to
 * render it unchanged everywhere is to pin both ends of the conversion.
 */
function shortCalendarDay(date: string): string | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

/**
 * True when `value` is a real `YYYY-MM-DD` calendar day.
 *
 * The round-trip is not paranoia: `Date.parse("2026-02-30T00:00:00Z")` does
 * **not** return `NaN`, it silently rolls over to March 2nd. A "not a number"
 * check alone would accept the 30th of February, store it as the 2nd of March,
 * and the couple would find a vendor payment dated four days later than they
 * typed with nothing to explain it. Formatting the parsed instant back and
 * comparing catches every overflow.
 */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

/** Null and undefined contribute nothing to a sum. */
function n(value: number | null | undefined): number {
  return value ?? 0;
}

/** Ascending by `sort_order`, then by `id`. */
function bySortOrderThenId<T extends { sort_order: number; id: string }>(a: T, b: T): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Cost stage and benchmark
// ---------------------------------------------------------------------------

/**
 * The one number that represents what this line will cost: the first non-null
 * of contracted, quoted, estimated — in that order, most-committed first.
 *
 * **`benchmark_cents` is deliberately not a fallback.** The reference wedding's
 * actual must never masquerade as the couple's own forecast; that would make
 * the comparison column compare a number with itself and report every unpriced
 * line as exactly on budget.
 *
 * A stored `0` is a real answer and wins over a later non-null column, because
 * "we negotiated this to nothing" is a decision. All three null gives
 * `{ cents: 0, stage: null }`, and the null stage is what tells callers the
 * couple has entered no number at all.
 */
export function effectiveCostCents(item: ItemFact): { cents: number; stage: CostStage | null } {
  if (item.contracted_cents !== null) return { cents: item.contracted_cents, stage: "contracted" };
  if (item.quoted_cents !== null) return { cents: item.quoted_cents, stage: "quoted" };
  if (item.estimated_cents !== null) return { cents: item.estimated_cents, stage: "estimated" };
  return { cents: 0, stage: null };
}

/**
 * The reference comparison, with both unknowns preserved.
 *
 * `null` on either side yields `direction: "unknown"` and a null delta, so the
 * UI renders an em dash. The alternative — coercing to `0` — produces
 * "100% under budget" for every line nobody has priced yet, which is the exact
 * false confidence this column exists to prevent.
 *
 * `pct` is null when the benchmark is `0`, because the couple spending $500
 * where the reference wedding spent nothing is not "infinity percent over" — it
 * is a category that did not exist last time. `deltaCents` still carries the
 * $500 and `direction` still says `"over"`, so nothing is lost.
 */
export function benchmarkDelta(
  benchmarkCents: number | null,
  actualCents: number | null,
): BenchmarkDelta {
  if (benchmarkCents === null || actualCents === null) {
    return {
      benchmarkCents,
      actualCents,
      deltaCents: null,
      pct: null,
      direction: "unknown",
    };
  }

  const deltaCents = actualCents - benchmarkCents;
  return {
    benchmarkCents,
    actualCents,
    deltaCents,
    pct: benchmarkCents === 0 ? null : deltaCents / benchmarkCents,
    direction: deltaCents > 0 ? "over" : deltaCents < 0 ? "under" : "even",
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Whether a payment is paid, overdue, due soon, upcoming or unscheduled.
 *
 * Measured with the **signed** `calendarDayDelta` against the day it currently
 * is *at the venue*. `daysUntilCalendarDate` floors at zero, so yesterday and
 * today are indistinguishable through it and every payment would read as "due
 * today" forever. `new Date(due_date)` is worse still: it makes the day a UTC
 * midnight instant, and since Vercel runs UTC the resulting off-by-one only
 * appears in production, where a payment due this morning in Guadalajara turns
 * red overnight while the couple is asleep.
 *
 * `0..14` is "due soon" — a fortnight is the window in which a wedding payment
 * is something you act on rather than something you note.
 */
export function paymentStatusOf(payment: PaymentFact, now: Date, timeZone: string): PaymentStatus {
  if (payment.paid) return "paid";
  if (payment.due_date === null) return "unscheduled";

  const delta = calendarDayDelta(payment.due_date, now, timeZone);
  if (delta < 0) return "overdue";
  if (delta <= 14) return "due_soon";
  return "upcoming";
}

/**
 * The human sentence under a payment amount.
 *
 * Singular/plural is spelled out rather than pluralised with an `s` template,
 * because "1 days overdue" is the kind of detail that makes a couple distrust
 * every other number on the page.
 */
export function dueLabel(payment: PaymentFact, now: Date, timeZone: string): string {
  if (payment.paid) {
    const on = payment.paid_on === null ? null : shortCalendarDay(payment.paid_on);
    return on === null ? "Paid" : `Paid ${on}`;
  }
  if (payment.due_date === null) return "No due date";

  const delta = calendarDayDelta(payment.due_date, now, timeZone);
  if (delta === 0) return "Due today";
  if (delta === 1) return "Due tomorrow";
  if (delta > 1) return `Due in ${delta} days`;
  if (delta === -1) return "1 day overdue";
  return `${-delta} days overdue`;
}

/** A payment plus everything derived from the venue's calendar. */
export function paymentView(payment: PaymentFact, now: Date, timeZone: string): PaymentView {
  return {
    ...payment,
    status: paymentStatusOf(payment, now, timeZone),
    daysOut: payment.due_date === null ? null : calendarDayDelta(payment.due_date, now, timeZone),
    label_due: dueLabel(payment, now, timeZone),
  };
}

/** Oldest due date first, then largest amount — the order a person chases them in. */
function byDueDateThenAmountDesc(a: PaymentFact, b: PaymentFact): number {
  const left = a.due_date ?? "";
  const right = b.due_date ?? "";
  if (left !== right) return left < right ? -1 : 1;
  if (a.amount_cents !== b.amount_cents) return b.amount_cents - a.amount_cents;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Unpaid payments falling due within the next `windowDays`, soonest first.
 *
 * **Overdue payments are excluded on purpose.** They belong to
 * `overduePayments`, which the UI renders in a separate and louder block; an
 * "upcoming" list that quietly contains three things already late reads as
 * calm when it should read as urgent.
 *
 * Both ends of the window are inclusive: `delta === 0` (today) and
 * `delta === windowDays` are in, `windowDays + 1` is out.
 */
export function upcomingPayments(
  payments: PaymentFact[],
  now: Date,
  timeZone: string,
  windowDays: number,
): PaymentView[] {
  return payments
    .filter((p) => {
      if (p.paid || p.due_date === null) return false;
      const delta = calendarDayDelta(p.due_date, now, timeZone);
      return delta >= 0 && delta <= windowDays;
    })
    .sort(byDueDateThenAmountDesc)
    .map((p) => paymentView(p, now, timeZone));
}

/** Unpaid payments whose day has already passed at the venue, oldest first. */
export function overduePayments(
  payments: PaymentFact[],
  now: Date,
  timeZone: string,
): PaymentView[] {
  return payments
    .filter((p) => !p.paid && p.due_date !== null && calendarDayDelta(p.due_date, now, timeZone) < 0)
    .sort(byDueDateThenAmountDesc)
    .map((p) => paymentView(p, now, timeZone));
}

/**
 * What is still owed inside the current calendar month at the venue.
 *
 * Includes days already past within that month: a payment due the 3rd and still
 * unpaid on the 29th is very much "due this month". The month boundary is
 * `calendarDayIn(now, timeZone)`, so at 02:00 UTC on August 1st — still the
 * evening of July 31st in Guadalajara — a July due date is correctly counted,
 * and the card does not reset a day early.
 */
export function paymentsDueThisMonth(
  payments: PaymentFact[],
  now: Date,
  timeZone: string,
): { count: number; cents: number } {
  const today = calendarDayIn(now, timeZone);
  const due = payments.filter(
    (p) => !p.paid && p.due_date !== null && sameCalendarMonth(p.due_date, today),
  );
  return {
    count: due.length,
    cents: due.reduce((sum, p) => sum + p.amount_cents, 0),
  };
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

/**
 * Everything one budget line owes, has paid, and still has unscheduled.
 *
 * `payments` is filtered to this item, so passing the whole wedding's payment
 * list is safe and passing exactly this item's group is a no-op.
 *
 * The three "still owed" numbers answer different questions and the UI shows
 * all three: `remainingCents` is what is left to pay, `outstandingScheduledCents`
 * is how much of that already has a dated payment row, and `unscheduledCents`
 * is the gap — money owed with nothing on the calendar yet, which is the number
 * that catches a forgotten final balance.
 *
 * `remainingCents` is floored at zero: overpaying a line is normal (a tip, a
 * change order), and rendering "−$400 remaining" invites the couple to think
 * the app is broken rather than that they paid extra.
 */
export function rollUpItem(
  item: ItemFact,
  payments: PaymentFact[],
  now: Date,
  timeZone: string,
): ItemRollup {
  const mine = payments.filter((p) => p.item_id === item.id);
  const views = mine.map((p) => paymentView(p, now, timeZone));

  const scheduledCents = mine.reduce((sum, p) => sum + p.amount_cents, 0);
  const paidCents = mine.filter((p) => p.paid).reduce((sum, p) => sum + p.amount_cents, 0);
  const outstandingScheduledCents = scheduledCents - paidCents;

  const { cents: forecastCents, stage: forecastStage } = effectiveCostCents(item);
  const remainingCents = Math.max(0, forecastCents - paidCents);
  const unscheduledCents = Math.max(0, remainingCents - outstandingScheduledCents);
  const hasOverdue = views.some((v) => v.status === "overdue");

  return {
    item,
    payments: views,
    scheduledCents,
    paidCents,
    outstandingScheduledCents,
    forecastCents,
    forecastStage,
    remainingCents,
    unscheduledCents,
    paymentStatus: itemPaymentStatus({
      paidCents,
      scheduledCents,
      forecastCents,
      hasOverdue,
    }),
    // The forecast side is null when no cost column is filled in at all, so an
    // unpriced line reads as "no comparison yet" rather than "100% under".
    benchmark: benchmarkDelta(item.benchmark_cents, forecastStage === null ? null : forecastCents),
    hasOverdue,
  };
}

/**
 * `unpaid | partial | paid | overdue`, always derived, never stored.
 *
 * **Overdue outranks partial.** An item with a paid deposit and a missed final
 * balance is not "partially paid, all fine" — the late payment is the only
 * thing about it worth surfacing, and burying it under a neutral word is how a
 * vendor deadline gets missed.
 */
export function itemPaymentStatus(input: {
  paidCents: number;
  scheduledCents: number;
  forecastCents: number;
  hasOverdue: boolean;
}): ItemPaymentStatus {
  const { paidCents, scheduledCents, forecastCents, hasOverdue } = input;
  if (paidCents === 0 && scheduledCents === 0) return "unpaid";
  if (hasOverdue) return "overdue";
  if (forecastCents > 0 && paidCents >= forecastCents) return "paid";
  if (paidCents > 0) return "partial";
  return "unpaid";
}

/**
 * The category's own reference figure: its override when set, otherwise the sum
 * of its items'.
 *
 * Returns `null` — not `0` — when the override is null *and* no item carries a
 * benchmark, because the honest answer is "we have no reference for this", and
 * a zero here would report every such category as wildly over budget. An
 * override of `0` is respected as a real zero.
 */
export function categoryBenchmarkCents(
  category: CategoryFact,
  items: ItemRollup[],
): number | null {
  if (category.benchmark_cents !== null) return category.benchmark_cents;
  const known = items.filter((i) => i.item.benchmark_cents !== null);
  if (known.length === 0) return null;
  return known.reduce((sum, i) => sum + n(i.item.benchmark_cents), 0);
}

/**
 * The category's forecast: the sum of its items', falling back to
 * `target_cents` **only** when the category has no items at all.
 *
 * Never the two added together. `target_cents` is the allocation the couple set
 * aside for a category before pricing anything in it; once real lines exist,
 * the lines are the forecast and the target becomes something to compare
 * against. Adding them double-counts the whole budget the moment seeding runs.
 */
export function categoryForecastCents(category: CategoryFact, items: ItemRollup[]): number {
  if (items.length === 0) return n(category.target_cents);
  return items.reduce((sum, i) => sum + i.forecastCents, 0);
}

/**
 * One category's totals. `grandForecastCents` is passed in rather than derived
 * because the share-of-budget bar needs the whole wedding, which a single
 * category cannot see.
 */
export function rollUpCategory(
  category: CategoryFact,
  items: ItemRollup[],
  grandForecastCents: number,
): CategoryRollup {
  const forecastCents = categoryForecastCents(category, items);
  const paidCents = items.reduce((sum, i) => sum + i.paidCents, 0);
  const benchmarkOrNull = categoryBenchmarkCents(category, items);

  // Null when nobody has priced anything here — same reasoning as rollUpItem.
  const pricedForecast =
    items.length === 0
      ? category.target_cents
      : items.some((i) => i.forecastStage !== null)
        ? forecastCents
        : null;

  const overduePaymentsInCategory = items.flatMap((i) =>
    i.payments.filter((p) => p.status === "overdue"),
  );

  return {
    category,
    items,
    benchmarkCents: n(benchmarkOrNull),
    estimatedCents: items.reduce((sum, i) => sum + n(i.item.estimated_cents), 0),
    quotedCents: items.reduce((sum, i) => sum + n(i.item.quoted_cents), 0),
    contractedCents: items.reduce((sum, i) => sum + n(i.item.contracted_cents), 0),
    forecastCents,
    paidCents,
    remainingCents: items.reduce((sum, i) => sum + i.remainingCents, 0),
    outstandingScheduledCents: items.reduce((sum, i) => sum + i.outstandingScheduledCents, 0),
    unscheduledCents: items.reduce((sum, i) => sum + i.unscheduledCents, 0),
    benchmark: benchmarkDelta(benchmarkOrNull, pricedForecast),
    overdueCount: overduePaymentsInCategory.length,
    overdueCents: overduePaymentsInCategory.reduce((sum, p) => sum + p.amount_cents, 0),
    shareOfForecast: grandForecastCents === 0 ? 0 : forecastCents / grandForecastCents,
  };
}

/**
 * The whole wedding's money, from the category rollups.
 *
 * `dueCents` is floored at zero for the same reason `ItemRollup.remainingCents`
 * is: a wedding total that reads "−$1,200 due" because one line was overpaid is
 * a support question, not information.
 *
 * `mixedCurrency` exists because **nothing here converts.** There is no FX rate
 * in this app and guessing one would silently misstate the total. When two
 * currencies appear the sums are still the naive addition of the numbers as
 * entered, and the UI must say so above them.
 */
export function rollUpBudget(
  categories: CategoryRollup[],
  maxSpendCents: number | null,
): BudgetTotals {
  const sum = (pick: (c: CategoryRollup) => number) =>
    categories.reduce((total, c) => total + pick(c), 0);

  const forecastCents = sum((c) => c.forecastCents);
  const paidCents = sum((c) => c.paidCents);

  // Unknown only when *every* category is unknown; one known reference is
  // enough to make the comparison meaningful.
  const anyBenchmark = categories.some(
    (c) => categoryBenchmarkCents(c.category, c.items) !== null,
  );
  const benchmarkCents = sum((c) => c.benchmarkCents);
  const anyPriced = categories.some((c) => c.benchmark.actualCents !== null);

  const currencies = [
    ...new Set(
      categories.flatMap((c) => c.items.map((i) => i.item.currency)).filter((c) => c.length > 0),
    ),
  ].sort();

  return {
    maxSpendCents,
    benchmarkCents,
    estimatedCents: sum((c) => c.estimatedCents),
    quotedCents: sum((c) => c.quotedCents),
    contractedCents: sum((c) => c.contractedCents),
    forecastCents,
    paidCents,
    dueCents: Math.max(0, forecastCents - paidCents),
    outstandingScheduledCents: sum((c) => c.outstandingScheduledCents),
    unscheduledCents: sum((c) => c.unscheduledCents),
    remainingAfterForecastCents: maxSpendCents === null ? null : maxSpendCents - forecastCents,
    remainingAfterPaidCents: maxSpendCents === null ? null : maxSpendCents - paidCents,
    benchmark: benchmarkDelta(
      anyBenchmark ? benchmarkCents : null,
      anyPriced ? forecastCents : null,
    ),
    health: budgetHealth({ forecastCents, paidCents }, maxSpendCents),
    overdueCount: sum((c) => c.overdueCount),
    overdueCents: sum((c) => c.overdueCents),
    itemCount: categories.reduce((total, c) => total + c.items.length, 0),
    mixedCurrency: currencies.length > 1,
    currencies,
  };
}

/**
 * Categories → items → payments, from four flat arrays.
 *
 * The shell reads each table with its own scoped `.eq("wedding_id", …)` query
 * rather than a nested PostgREST embed, so assembly happens here. Rows whose
 * parent is missing are **dropped rather than thrown on**: a page that renders
 * nine categories is a better answer to one orphaned row than a 500, and the
 * orphan cannot be reached in the UI anyway.
 *
 * Ordering is `sort_order` then `id`. The id tiebreak keeps the order stable
 * across page loads when two concurrent creates land on the same `sort_order` —
 * without it a category quietly swaps place with its neighbour on refresh, and
 * the couple assumes they misclicked something.
 */
export function assembleTree(
  categories: CategoryFact[],
  items: ItemFact[],
  payments: PaymentFact[],
  now: Date,
  timeZone: string,
): CategoryRollup[] {
  const sortedCategories = [...categories].sort(bySortOrderThenId);
  const categoryIds = new Set(sortedCategories.map((c) => c.id));
  const itemIds = new Set(items.map((i) => i.id));

  const livePayments = payments.filter((p) => itemIds.has(p.item_id));
  const paymentsByItem = new Map<string, PaymentFact[]>();
  for (const payment of livePayments) {
    const bucket = paymentsByItem.get(payment.item_id);
    if (bucket) bucket.push(payment);
    else paymentsByItem.set(payment.item_id, [payment]);
  }

  const itemsByCategory = new Map<string, ItemFact[]>();
  for (const item of items) {
    if (!categoryIds.has(item.category_id)) continue;
    const bucket = itemsByCategory.get(item.category_id);
    if (bucket) bucket.push(item);
    else itemsByCategory.set(item.category_id, [item]);
  }

  const rollupsByCategory = new Map<string, ItemRollup[]>();
  for (const category of sortedCategories) {
    const mine = [...(itemsByCategory.get(category.id) ?? [])].sort(bySortOrderThenId);
    rollupsByCategory.set(
      category.id,
      mine.map((item) => rollUpItem(item, paymentsByItem.get(item.id) ?? [], now, timeZone)),
    );
  }

  // Two passes: every category's share needs the grand forecast, which is only
  // known once all of them are rolled up.
  const grandForecastCents = sortedCategories.reduce(
    (total, category) =>
      total + categoryForecastCents(category, rollupsByCategory.get(category.id) ?? []),
    0,
  );

  return sortedCategories.map((category) =>
    rollUpCategory(category, rollupsByCategory.get(category.id) ?? [], grandForecastCents),
  );
}

// ---------------------------------------------------------------------------
// Budget health, deposits, allocation
// ---------------------------------------------------------------------------

/**
 * How the forecast sits against the ceiling she typed.
 *
 * Thresholds are multiplications, never divisions, so a `maxSpendCents` of `0`
 * cannot produce `Infinity` or `NaN` — it simply makes any forecast above zero
 * `"over"`, which is the truthful reading of a zero budget.
 *
 * `"unset"` is its own state rather than an optimistic `"under"`: no ceiling
 * means the question has not been answered yet, and a green badge would imply
 * it had been.
 */
export function budgetHealth(
  totals: Pick<BudgetTotals, "forecastCents" | "paidCents">,
  maxSpendCents: number | null,
): BudgetHealth {
  if (maxSpendCents === null) return "unset";
  if (totals.forecastCents > maxSpendCents) return "over";
  if (totals.forecastCents > maxSpendCents * 0.9) return "tight";
  if (totals.forecastCents > maxSpendCents * 0.5) return "on_track";
  return "under";
}

/**
 * Total and deposit in, deposit and remaining balance out.
 *
 * **The app does the subtraction, always.** Making someone work out the balance
 * on the vendor's invoice and type it back in is exactly the arithmetic that
 * sends a couple back to the spreadsheet, and it is where the spreadsheet's
 * errors came from. Integer cents throughout, so `deposit + balance === total`
 * exactly rather than to within a rounding error.
 *
 * A deposit equal to the total gives `balance: 0`, and the caller creates one
 * payment — not one plus a zero-dollar row nobody can explain.
 */
export function splitDeposit(totalCents: number, depositCents: number): DepositSplit {
  if (!Number.isFinite(totalCents) || !Number.isFinite(depositCents)) {
    return { ok: false, message: "That doesn't look like an amount." };
  }
  if (depositCents < 0 || totalCents < 0) {
    return { ok: false, message: "Amounts can't be negative." };
  }
  if (depositCents > totalCents) {
    return { ok: false, message: "The deposit is more than the total. Check the numbers." };
  }
  return { ok: true, deposit: depositCents, balance: totalCents - depositCents };
}

/**
 * The starting allocation: the CSV's real category proportions, rounded to
 * numbers a person can reason about, with the contingency the research says
 * every wedding budget needs and most tools omit.
 */
export const DEFAULT_ALLOCATION: AllocationSlice[] = [
  { name: "Venue", pct: 0.25 },
  { name: "Food and Beverage", pct: 0.27 },
  { name: "Music + Photography", pct: 0.14 },
  { name: "Attire + Beauty", pct: 0.09 },
  { name: "Flowers + Decor", pct: 0.08 },
  { name: "Gifts", pct: 0.03 },
  { name: "Printing", pct: 0.01 },
  { name: "Hotels", pct: 0.05 },
  { name: "Contingency", pct: 0.08, isContingency: true },
];

/**
 * Split a total across a percentage plan by **largest-remainder apportionment**,
 * so `Σ targetCents === totalCents` exactly.
 *
 * Naive `Math.round(total * pct)` leaves a few stray cents, and seeded
 * categories that add up to $60,169.98 against the $60,170 she typed is the
 * first thing she notices and the last thing she trusts afterwards. Floor every
 * slice, then hand the leftover cents out one at a time to the largest
 * fractional parts.
 *
 * A plan with no contingency slice is **rejected**, not silently accepted: the
 * mandatory buffer is a research finding, and enforcing it here rather than in
 * the form means no future caller can skip it.
 */
export function allocateByPercent(
  totalCents: number,
  plan: AllocationSlice[],
): AllocationResult[] {
  if (!Number.isFinite(totalCents) || !Number.isInteger(totalCents)) {
    throw new AllocationError("A budget total has to be a whole number of cents.");
  }
  if (totalCents < 0) {
    throw new AllocationError("Amounts can't be negative.");
  }
  if (plan.length === 0) {
    throw new AllocationError("An allocation needs at least one category.");
  }
  if (plan.some((slice) => !Number.isFinite(slice.pct) || slice.pct < 0)) {
    throw new AllocationError("Every share has to be zero or more.");
  }

  const total = plan.reduce((sum, slice) => sum + slice.pct, 0);
  if (Math.abs(total - 1) > 0.0001) {
    throw new AllocationError("These percentages need to add up to 100%.");
  }
  if (!plan.some((slice) => slice.isContingency === true)) {
    throw new AllocationError("Set aside a contingency — every wedding needs one.");
  }

  const exact = plan.map((slice) => totalCents * slice.pct);
  const floors = exact.map((value) => Math.floor(value));
  const allocated = floors.reduce((sum, value) => sum + value, 0);

  // Hand out (or claw back) the leftover cents, largest fractional part first.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => (b.fraction !== a.fraction ? b.fraction - a.fraction : a.index - b.index));

  let leftover = totalCents - allocated;
  for (let i = 0; leftover > 0 && i < order.length; i += 1) {
    floors[order[i].index] += 1;
    leftover -= 1;
  }
  for (let i = order.length - 1; leftover < 0 && i >= 0; i -= 1) {
    floors[order[i].index] -= 1;
    leftover += 1;
  }

  return plan.map((slice, index) => ({
    name: slice.name,
    pct: slice.pct,
    targetCents: floors[index],
    isContingency: slice.isContingency === true,
  }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCategory(draft: { name: string }): CategoryValidation {
  const name = draft.name.trim();
  if (name.length === 0) {
    return { ok: false, errors: [{ field: "name", message: "Give this category a name." }] };
  }
  return { ok: true, value: { name } };
}

/**
 * Only the name is required — a line she has not priced yet is normal, and
 * blocking on it would push the pricing back into the spreadsheet.
 *
 * Negative costs are rejected because none of these four columns can be one; a
 * refund is a payment, not a negative estimate. The zero-cost case returns
 * `ok: true` with a **warning**, because it is legitimate and only worth saying
 * out loud that the line contributes nothing to the total yet.
 */
export function validateItem(draft: ItemDraft): ItemValidation {
  const errors: BudgetFieldError[] = [];

  const name = draft.name.trim();
  if (name.length === 0) {
    errors.push({ field: "name", message: "Give this line a name." });
  }

  const money: Array<[BudgetFieldError["field"], number | null | undefined]> = [
    ["benchmark", draft.benchmarkCents],
    ["estimated", draft.estimatedCents],
    ["quoted", draft.quotedCents],
    ["contracted", draft.contractedCents],
    ["unitPrice", draft.unitPriceCents],
  ];
  for (const [field, value] of money) {
    if (value !== null && value !== undefined && value < 0) {
      errors.push({ field, message: "Amounts can't be negative." });
    }
  }

  const quantity = draft.quantity ?? null;
  if (quantity !== null && (!Number.isInteger(quantity) || quantity <= 0)) {
    errors.push({ field: "quantity", message: "Quantity has to be a whole number, at least one." });
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: ItemValue = {
    name,
    benchmarkCents: draft.benchmarkCents ?? null,
    estimatedCents: draft.estimatedCents ?? null,
    quotedCents: draft.quotedCents ?? null,
    contractedCents: draft.contractedCents ?? null,
    quantity,
    unitPriceCents: draft.unitPriceCents ?? null,
  };

  const unpriced =
    value.estimatedCents === null && value.quotedCents === null && value.contractedCents === null;

  return unpriced
    ? { ok: true, value, warning: "No cost recorded yet — this line won't count toward your total." }
    : { ok: true, value };
}

/**
 * A payment needs an amount and a real due date; everything else is optional.
 *
 * Scheduling **more** than the line's recorded cost is a **warning, not a
 * block**. Overpaying happens — a change order, a tip, a price that moved after
 * the estimate — and an app that refuses the entry is an app she stops using
 * for that vendor, which means the ledger no longer matches reality.
 *
 * The `paid`/`paid_on` pair is normalised rather than rejected: unpaid clears
 * the date, so a re-opened payment cannot carry a stale one, and paid with no
 * date is left null for the caller to stamp with today *at the venue* (this
 * module never reads a clock).
 */
export function validatePayment(
  draft: PaymentDraft,
  itemForecastCents: number | null,
): PaymentValidation {
  const errors: BudgetFieldError[] = [];

  const amountCents = draft.amountCents;
  if (amountCents === null || !Number.isFinite(amountCents) || amountCents <= 0) {
    errors.push({ field: "amount", message: "A payment needs an amount." });
  }

  const dueDate = (draft.dueDate ?? "").trim() === "" ? null : (draft.dueDate as string).trim();
  if (dueDate !== null && !isCalendarDate(dueDate)) {
    errors.push({ field: "dueDate", message: "That due date is not a real date." });
  }

  const paid = draft.paid === true;
  const rawPaidOn = (draft.paidOn ?? "").trim() === "" ? null : (draft.paidOn as string).trim();
  if (rawPaidOn !== null && !isCalendarDate(rawPaidOn)) {
    errors.push({ field: "paidOn", message: "That paid date is not a real date." });
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: PaymentValue = {
    label: (draft.label ?? "").trim() === "" ? "Payment" : (draft.label as string).trim(),
    amountCents: amountCents as number,
    dueDate,
    paid,
    // An unpaid payment can never keep a paid-on date.
    paidOn: paid ? rawPaidOn : null,
  };

  const newTotal = (draft.otherScheduledCents ?? 0) + value.amountCents;
  if (itemForecastCents !== null && newTotal > itemForecastCents) {
    return {
      ok: true,
      value,
      warning: "These payments add up to more than the cost you recorded.",
    };
  }

  return { ok: true, value };
}
