import { describe, expect, test } from "vitest";
import {
  DEFAULT_ALLOCATION,
  allocateByPercent,
  assembleTree,
  benchmarkDelta,
  budgetHealth,
  categoryBenchmarkCents,
  categoryForecastCents,
  dueLabel,
  effectiveCostCents,
  itemPaymentStatus,
  overduePayments,
  paymentStatusOf,
  paymentView,
  paymentsDueThisMonth,
  rollUpBudget,
  rollUpCategory,
  rollUpItem,
  splitDeposit,
  upcomingPayments,
  validateCategory,
  validateItem,
  validatePayment,
  type CategoryFact,
  type ItemFact,
  type PaymentFact,
} from "./budget-rules";

// ---------------------------------------------------------------------------
// Fixtures. Every factory defaults to "nothing entered yet" (nulls, not zeros),
// because that is what a real row looks like months before the wedding.
// ---------------------------------------------------------------------------

const VENUE = "America/Mexico_City"; // Guadalajara: UTC−6, no DST since 2022.

let seq = 0;
const uid = (prefix: string) => `${prefix}${(seq += 1)}`;

function payment(over: Partial<PaymentFact> = {}): PaymentFact {
  return {
    id: uid("p"),
    item_id: "i1",
    label: "Payment",
    amount_cents: 100_000,
    due_date: null,
    paid: false,
    paid_on: null,
    ...over,
  };
}

function item(over: Partial<ItemFact> = {}): ItemFact {
  return {
    id: uid("i"),
    category_id: "c1",
    vendor_id: null,
    name: "A line",
    benchmark_cents: null,
    estimated_cents: null,
    quoted_cents: null,
    contracted_cents: null,
    currency: "USD",
    pending_guest_count: false,
    sort_order: 0,
    ...over,
  };
}

function category(over: Partial<CategoryFact> = {}): CategoryFact {
  return {
    id: uid("c"),
    name: "A category",
    target_cents: null,
    benchmark_cents: null,
    is_contingency: false,
    sort_order: 0,
    ...over,
  };
}

/** Roll one item up with its payments, at a fixed clock. */
function rollOne(i: ItemFact, ps: PaymentFact[], now: Date, tz = VENUE) {
  return rollUpItem(i, ps.map((p) => ({ ...p, item_id: i.id })), now, tz);
}

// ===========================================================================
// THE TIMEZONE CASE. Written first, and it failed against a `new Date(due_date)`
// implementation before this module was written.
//
// Vercel runs UTC and the venue is in Guadalajara, so for six hours every night
// the server's calendar is a day ahead of the couple's. A payment due that
// morning turns red while they are asleep, and the bug is invisible locally on
// any machine west of Greenwich. `calendarDayDelta` is signed and counts
// between calendar days at the venue; `daysUntilCalendarDate` floors at zero
// and literally cannot express "overdue".
// ===========================================================================

describe("due dates are read at the venue, not on the server clock", () => {
  const dueToday = payment({ due_date: "2026-07-29", amount_cents: 500_000 });
  // 05:00Z on the 30th is 23:00 on the 29th in Guadalajara.
  const now = new Date("2026-07-30T05:00:00Z");

  test("a payment due today in Guadalajara is not overdue while UTC is already tomorrow", () => {
    expect(paymentStatusOf(dueToday, now, VENUE)).toBe("due_soon");
    expect(dueLabel(dueToday, now, VENUE)).toBe("Due today");
  });

  test("the same instant in UTC is overdue, proving the zone is honoured and not ignored", () => {
    expect(paymentStatusOf(dueToday, now, "UTC")).toBe("overdue");
    expect(dueLabel(dueToday, now, "UTC")).toBe("1 day overdue");
  });

  test("daysOut is 0 at the venue and -1 in UTC for one and the same instant", () => {
    expect(paymentView(dueToday, now, VENUE).daysOut).toBe(0);
    expect(paymentView(dueToday, now, "UTC").daysOut).toBe(-1);
  });

  test("a payment due today at the venue is not counted as overdue", () => {
    expect(overduePayments([dueToday], now, VENUE)).toHaveLength(0);
    expect(overduePayments([dueToday], now, "UTC")).toHaveLength(1);
  });

  test("an item is not flagged overdue while the venue is still on the due day", () => {
    const line = item({ contracted_cents: 500_000 });
    expect(rollOne(line, [dueToday], now).hasOverdue).toBe(false);
    expect(rollOne(line, [dueToday], now, "UTC").hasOverdue).toBe(true);
  });
});

// ===========================================================================
// Cost stages
// ===========================================================================

describe("effectiveCostCents — the reference wedding never becomes the forecast", () => {
  test("contracted wins over quoted and estimated", () => {
    expect(
      effectiveCostCents(
        item({ contracted_cents: 300, quoted_cents: 200, estimated_cents: 100 }),
      ),
    ).toEqual({ cents: 300, stage: "contracted" });
  });

  test("quoted wins over estimated", () => {
    expect(effectiveCostCents(item({ quoted_cents: 200, estimated_cents: 100 }))).toEqual({
      cents: 200,
      stage: "quoted",
    });
  });

  test("estimated is used when it is all there is", () => {
    expect(effectiveCostCents(item({ estimated_cents: 100 }))).toEqual({
      cents: 100,
      stage: "estimated",
    });
  });

  test("all three null gives zero cents and a null stage", () => {
    expect(effectiveCostCents(item())).toEqual({ cents: 0, stage: null });
  });

  test("a benchmark alone still yields 0 — the reference number is never the forecast", () => {
    expect(effectiveCostCents(item({ benchmark_cents: 999_999 }))).toEqual({
      cents: 0,
      stage: null,
    });
  });

  test("a contracted zero is a real answer and beats a later non-null column", () => {
    expect(effectiveCostCents(item({ contracted_cents: 0, estimated_cents: 500_000 }))).toEqual({
      cents: 0,
      stage: "contracted",
    });
  });
});

// ===========================================================================
// Benchmark deltas — where null and zero must never be confused
// ===========================================================================

describe("benchmarkDelta — null means unknown, zero means nothing was spent", () => {
  test("a null benchmark is unknown, not zero", () => {
    const d = benchmarkDelta(null, 500_000);
    expect(d.direction).toBe("unknown");
    expect(d.deltaCents).toBeNull();
    expect(d.pct).toBeNull();
  });

  test("a null actual is unknown too", () => {
    const d = benchmarkDelta(500_000, null);
    expect(d.direction).toBe("unknown");
    expect(d.deltaCents).toBeNull();
  });

  test("a zero benchmark with a positive actual is over, with no Infinity", () => {
    const d = benchmarkDelta(0, 50_000);
    expect(d.direction).toBe("over");
    expect(d.deltaCents).toBe(50_000);
    expect(d.pct).toBeNull();
    expect(Number.isFinite(d.pct as number)).toBe(false);
  });

  test("a zero benchmark and a zero actual is even, still with no division", () => {
    const d = benchmarkDelta(0, 0);
    expect(d.direction).toBe("even");
    expect(d.deltaCents).toBe(0);
    expect(d.pct).toBeNull();
  });

  test("spending more than the reference is over, with a positive fraction", () => {
    const d = benchmarkDelta(1_000_000, 1_900_000);
    expect(d.direction).toBe("over");
    expect(d.deltaCents).toBe(900_000);
    expect(d.pct).toBeCloseTo(0.9, 10);
  });

  test("spending less than the reference is under, with a negative fraction", () => {
    const d = benchmarkDelta(1_000_000, 750_000);
    expect(d.direction).toBe("under");
    expect(d.deltaCents).toBe(-250_000);
    expect(d.pct).toBeCloseTo(-0.25, 10);
  });

  test("matching the reference exactly is even", () => {
    const d = benchmarkDelta(1_000_000, 1_000_000);
    expect(d.direction).toBe("even");
    expect(d.deltaCents).toBe(0);
    expect(d.pct).toBe(0);
  });

  test("both sides are carried through so the UI can show what was compared", () => {
    const d = benchmarkDelta(400, 700);
    expect(d.benchmarkCents).toBe(400);
    expect(d.actualCents).toBe(700);
  });
});

// ===========================================================================
// Payment status and the human due label
// ===========================================================================

describe("paymentStatusOf", () => {
  const now = new Date("2026-07-29T12:00:00Z"); // 06:00 on the 29th at the venue.

  test("a paid payment is paid, whatever its due date says", () => {
    expect(paymentStatusOf(payment({ paid: true, due_date: "2020-01-01" }), now, VENUE)).toBe(
      "paid",
    );
  });

  test("no due date is unscheduled, never overdue", () => {
    expect(paymentStatusOf(payment({ due_date: null }), now, VENUE)).toBe("unscheduled");
  });

  test("yesterday is overdue", () => {
    expect(paymentStatusOf(payment({ due_date: "2026-07-28" }), now, VENUE)).toBe("overdue");
  });

  test("today is due soon, not overdue", () => {
    expect(paymentStatusOf(payment({ due_date: "2026-07-29" }), now, VENUE)).toBe("due_soon");
  });

  test("fourteen days out is still due soon", () => {
    expect(paymentStatusOf(payment({ due_date: "2026-08-12" }), now, VENUE)).toBe("due_soon");
  });

  test("fifteen days out is upcoming", () => {
    expect(paymentStatusOf(payment({ due_date: "2026-08-13" }), now, VENUE)).toBe("upcoming");
  });
});

describe("dueLabel — every branch, with the plural spelled out", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  test("due today", () => {
    expect(dueLabel(payment({ due_date: "2026-07-29" }), now, VENUE)).toBe("Due today");
  });

  test("due tomorrow, never 'in 1 days'", () => {
    expect(dueLabel(payment({ due_date: "2026-07-30" }), now, VENUE)).toBe("Due tomorrow");
  });

  test("due in 12 days", () => {
    expect(dueLabel(payment({ due_date: "2026-08-10" }), now, VENUE)).toBe("Due in 12 days");
  });

  test("one day overdue is singular", () => {
    expect(dueLabel(payment({ due_date: "2026-07-28" }), now, VENUE)).toBe("1 day overdue");
  });

  test("six days overdue", () => {
    expect(dueLabel(payment({ due_date: "2026-07-23" }), now, VENUE)).toBe("6 days overdue");
  });

  test("no due date", () => {
    expect(dueLabel(payment({ due_date: null }), now, VENUE)).toBe("No due date");
  });

  test("paid on a known day reads as the short day", () => {
    expect(dueLabel(payment({ paid: true, paid_on: "2026-07-12" }), now, VENUE)).toBe("Paid Jul 12");
  });

  test("the paid-on day is rendered as stored, not shifted by the machine's zone", () => {
    // A naive `new Date("2026-01-01")` renders "Dec 31" anywhere west of UTC.
    expect(dueLabel(payment({ paid: true, paid_on: "2026-01-01" }), now, VENUE)).toBe("Paid Jan 1");
  });

  test("paid with no recorded day just says Paid", () => {
    expect(dueLabel(payment({ paid: true, paid_on: null }), now, VENUE)).toBe("Paid");
  });
});

describe("paymentView", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  test("carries the original row through untouched alongside the derived fields", () => {
    const p = payment({ due_date: "2026-08-01", amount_cents: 250_000, label: "Deposit" });
    const view = paymentView(p, now, VENUE);
    expect(view.id).toBe(p.id);
    expect(view.label).toBe("Deposit");
    expect(view.amount_cents).toBe(250_000);
    expect(view.status).toBe("due_soon");
    expect(view.daysOut).toBe(3);
    expect(view.label_due).toBe("Due in 3 days");
  });

  test("daysOut is null when there is no due date", () => {
    expect(paymentView(payment(), now, VENUE).daysOut).toBeNull();
  });
});

// ===========================================================================
// Item rollups
// ===========================================================================

describe("rollUpItem — nothing stores the actual, it is summed on read", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  const contract = item({ contracted_cents: 1_537_000 });

  test("paidCents counts only paid rows; scheduledCents counts all of them", () => {
    const r = rollOne(contract, [
      payment({ amount_cents: 500_000, paid: true, paid_on: "2026-06-01" }),
      payment({ amount_cents: 1_037_000, due_date: "2027-03-01" }),
    ], now);
    expect(r.paidCents).toBe(500_000);
    expect(r.scheduledCents).toBe(1_537_000);
    expect(r.outstandingScheduledCents).toBe(1_037_000);
  });

  test("a $15,370 contract with a $5,000 paid deposit leaves $10,370 remaining", () => {
    const r = rollOne(contract, [payment({ amount_cents: 500_000, paid: true })], now);
    expect(r.remainingCents).toBe(1_037_000);
  });

  test("a contract with no payment rows at all is entirely unscheduled", () => {
    const r = rollOne(contract, [], now);
    expect(r.unscheduledCents).toBe(1_537_000);
    expect(r.scheduledCents).toBe(0);
  });

  test("unscheduled is only the gap the payment schedule does not cover", () => {
    const r = rollOne(contract, [payment({ amount_cents: 500_000, due_date: "2027-01-01" })], now);
    expect(r.outstandingScheduledCents).toBe(500_000);
    expect(r.unscheduledCents).toBe(1_037_000);
  });

  test("payments beyond the contract floor remaining at zero, never negative", () => {
    const r = rollOne(contract, [payment({ amount_cents: 1_600_000, paid: true })], now);
    expect(r.remainingCents).toBe(0);
    expect(r.unscheduledCents).toBe(0);
  });

  test("payments belonging to another item are ignored", () => {
    const r = rollUpItem(
      contract,
      [payment({ item_id: "somebody-else", amount_cents: 900_000, paid: true })],
      now,
      VENUE,
    );
    expect(r.paidCents).toBe(0);
  });

  test("the forecast stage is reported so the UI can caption the number", () => {
    expect(rollOne(item({ estimated_cents: 4_000 }), [], now).forecastStage).toBe("estimated");
    expect(rollOne(item(), [], now).forecastStage).toBeNull();
  });

  test("an unpriced line compares as unknown, not as '100% under'", () => {
    const r = rollOne(item({ benchmark_cents: 800_000 }), [], now);
    expect(r.forecastCents).toBe(0);
    expect(r.benchmark.direction).toBe("unknown");
    expect(r.benchmark.actualCents).toBeNull();
  });

  test("a priced line compares its forecast against the reference", () => {
    const r = rollOne(item({ benchmark_cents: 800_000, contracted_cents: 1_000_000 }), [], now);
    expect(r.benchmark.direction).toBe("over");
    expect(r.benchmark.deltaCents).toBe(200_000);
  });
});

describe("itemPaymentStatus — overdue outranks partial", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  const contract = item({ contracted_cents: 1_000_000 });

  test("no payments at all is unpaid", () => {
    expect(rollOne(contract, [], now).paymentStatus).toBe("unpaid");
  });

  test("some paid is partial", () => {
    const r = rollOne(contract, [
      payment({ amount_cents: 400_000, paid: true }),
      payment({ amount_cents: 600_000, due_date: "2027-01-01" }),
    ], now);
    expect(r.paymentStatus).toBe("partial");
  });

  test("paid up to the forecast is paid", () => {
    const r = rollOne(contract, [payment({ amount_cents: 1_000_000, paid: true })], now);
    expect(r.paymentStatus).toBe("paid");
  });

  test("overpaid is still paid", () => {
    const r = rollOne(contract, [payment({ amount_cents: 1_200_000, paid: true })], now);
    expect(r.paymentStatus).toBe("paid");
  });

  test("an overdue payment beside a paid one reads overdue, not partial", () => {
    const r = rollOne(contract, [
      payment({ amount_cents: 400_000, paid: true, paid_on: "2026-05-01" }),
      payment({ amount_cents: 600_000, due_date: "2026-07-01" }),
    ], now);
    expect(r.paymentStatus).toBe("overdue");
  });

  test("scheduled but nothing paid yet is unpaid", () => {
    const r = rollOne(contract, [payment({ amount_cents: 1_000_000, due_date: "2027-01-01" })], now);
    expect(r.paymentStatus).toBe("unpaid");
  });

  test("a payment against a line with no recorded cost cannot read as fully paid", () => {
    // forecast is 0, so ">= forecast" would be trivially true without the guard.
    expect(
      itemPaymentStatus({
        paidCents: 50_000,
        scheduledCents: 50_000,
        forecastCents: 0,
        hasOverdue: false,
      }),
    ).toBe("partial");
  });
});

// ===========================================================================
// Category rollups
// ===========================================================================

describe("categoryBenchmarkCents — the override, then the children, then unknown", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  const rolled = (i: ItemFact) => rollOne(i, [], now);

  test("a category override wins over the sum of its items", () => {
    const c = category({ benchmark_cents: 900_000 });
    expect(categoryBenchmarkCents(c, [rolled(item({ benchmark_cents: 100_000 }))])).toBe(900_000);
  });

  test("an override of zero is respected as a real zero, not treated as absent", () => {
    const c = category({ benchmark_cents: 0 });
    expect(categoryBenchmarkCents(c, [rolled(item({ benchmark_cents: 100_000 }))])).toBe(0);
  });

  test("with no override it sums the items that have one", () => {
    const c = category();
    expect(
      categoryBenchmarkCents(c, [
        rolled(item({ benchmark_cents: 100_000 })),
        rolled(item({ benchmark_cents: 250_000 })),
        rolled(item()),
      ]),
    ).toBe(350_000);
  });

  test("no override and no benchmarked items is unknown, not zero", () => {
    expect(categoryBenchmarkCents(category(), [rolled(item())])).toBeNull();
    expect(categoryBenchmarkCents(category(), [])).toBeNull();
  });
});

describe("categoryForecastCents — the target is a fallback, never an addition", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  test("an empty category falls back to its allocation target", () => {
    expect(categoryForecastCents(category({ target_cents: 500_000 }), [])).toBe(500_000);
  });

  test("an empty category with no target is zero", () => {
    expect(categoryForecastCents(category(), [])).toBe(0);
  });

  test("once items exist the target is ignored, never added", () => {
    const items = [
      rollOne(item({ contracted_cents: 300_000 }), [], now),
      rollOne(item({ estimated_cents: 200_000 }), [], now),
    ];
    expect(categoryForecastCents(category({ target_cents: 900_000 }), items)).toBe(500_000);
  });
});

describe("rollUpCategory", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  test("sums each cost stage across its items, treating nulls as zero", () => {
    const items = [
      rollOne(item({ estimated_cents: 100, quoted_cents: 200, contracted_cents: 300 }), [], now),
      rollOne(item({ estimated_cents: 50 }), [], now),
    ];
    const c = rollUpCategory(category(), items, 1_000);
    expect(c.estimatedCents).toBe(150);
    expect(c.quotedCents).toBe(200);
    expect(c.contractedCents).toBe(300);
    expect(c.forecastCents).toBe(350); // 300 (contracted) + 50 (estimated)
  });

  test("shareOfForecast is a fraction of the whole wedding", () => {
    const items = [rollOne(item({ contracted_cents: 250_000 }), [], now)];
    expect(rollUpCategory(category(), items, 1_000_000).shareOfForecast).toBeCloseTo(0.25, 10);
  });

  test("shareOfForecast is 0, never NaN, when the grand forecast is zero", () => {
    const c = rollUpCategory(category(), [rollOne(item(), [], now)], 0);
    expect(c.shareOfForecast).toBe(0);
    expect(Number.isNaN(c.shareOfForecast)).toBe(false);
  });

  test("counts overdue payments and their value across the category", () => {
    const a = item();
    const b = item();
    const items = [
      rollOne(a, [payment({ amount_cents: 40_000, due_date: "2026-07-01" })], now),
      rollOne(b, [
        payment({ amount_cents: 10_000, due_date: "2026-07-02" }),
        payment({ amount_cents: 99_000, due_date: "2027-07-02" }),
      ], now),
    ];
    const c = rollUpCategory(category(), items, 1_000);
    expect(c.overdueCount).toBe(2);
    expect(c.overdueCents).toBe(50_000);
  });

  test("an unknown category benchmark sums as zero but compares as unknown", () => {
    const c = rollUpCategory(category(), [rollOne(item({ contracted_cents: 500 }), [], now)], 500);
    expect(c.benchmarkCents).toBe(0);
    expect(c.benchmark.benchmarkCents).toBeNull();
    expect(c.benchmark.direction).toBe("unknown");
  });

  test("a benchmarked category with nothing priced is unknown rather than 100% under", () => {
    const c = rollUpCategory(
      category({ benchmark_cents: 800_000 }),
      [rollOne(item(), [], now)],
      0,
    );
    expect(c.benchmark.direction).toBe("unknown");
    expect(c.benchmark.actualCents).toBeNull();
  });

  test("an empty category compares its target against the reference", () => {
    const c = rollUpCategory(
      category({ benchmark_cents: 400_000, target_cents: 500_000 }),
      [],
      500_000,
    );
    expect(c.benchmark.actualCents).toBe(500_000);
    expect(c.benchmark.deltaCents).toBe(100_000);
    expect(c.benchmark.direction).toBe("over");
  });
});

// ===========================================================================
// Tree assembly
// ===========================================================================

describe("assembleTree", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  test("nests payments inside items inside categories", () => {
    const c = category({ id: "cat-1" });
    const i = item({ id: "item-1", category_id: "cat-1", contracted_cents: 900 });
    const p = payment({ id: "pay-1", item_id: "item-1", amount_cents: 400, paid: true });

    const tree = assembleTree([c], [i], [p], now, VENUE);
    expect(tree).toHaveLength(1);
    expect(tree[0].items).toHaveLength(1);
    expect(tree[0].items[0].payments).toHaveLength(1);
    expect(tree[0].items[0].paidCents).toBe(400);
    expect(tree[0].paidCents).toBe(400);
  });

  test("an item whose category is missing is dropped rather than crashing the page", () => {
    const c = category({ id: "cat-1" });
    const orphan = item({ id: "item-9", category_id: "cat-gone", contracted_cents: 500_000 });
    const tree = assembleTree([c], [orphan], [], now, VENUE);
    expect(tree).toHaveLength(1);
    expect(tree[0].items).toHaveLength(0);
    expect(rollUpBudget(tree, null).forecastCents).toBe(0);
  });

  test("a payment whose item is missing is dropped", () => {
    const c = category({ id: "cat-1" });
    const i = item({ id: "item-1", category_id: "cat-1" });
    const orphan = payment({ id: "pay-9", item_id: "item-gone", amount_cents: 700, paid: true });
    const tree = assembleTree([c], [i], [orphan], now, VENUE);
    expect(tree[0].items[0].payments).toHaveLength(0);
    expect(tree[0].paidCents).toBe(0);
  });

  test("orders categories and items by sort_order", () => {
    const cats = [
      category({ id: "cat-b", name: "Second", sort_order: 2 }),
      category({ id: "cat-a", name: "First", sort_order: 1 }),
    ];
    const items = [
      item({ id: "item-z", category_id: "cat-a", name: "Later", sort_order: 5 }),
      item({ id: "item-y", category_id: "cat-a", name: "Sooner", sort_order: 1 }),
    ];
    const tree = assembleTree(cats, items, [], now, VENUE);
    expect(tree.map((c) => c.category.name)).toEqual(["First", "Second"]);
    expect(tree[0].items.map((i) => i.item.name)).toEqual(["Sooner", "Later"]);
  });

  test("a shared sort_order falls back to id, so the order is stable across reloads", () => {
    const cats = [
      category({ id: "cat-b", name: "Bee", sort_order: 0 }),
      category({ id: "cat-a", name: "Ay", sort_order: 0 }),
    ];
    const first = assembleTree(cats, [], [], now, VENUE).map((c) => c.category.id);
    const second = assembleTree([...cats].reverse(), [], [], now, VENUE).map((c) => c.category.id);
    expect(first).toEqual(["cat-a", "cat-b"]);
    expect(second).toEqual(first);
  });

  test("does not mutate the arrays it is given", () => {
    const cats = [
      category({ id: "cat-b", sort_order: 2 }),
      category({ id: "cat-a", sort_order: 1 }),
    ];
    assembleTree(cats, [], [], now, VENUE);
    expect(cats.map((c) => c.id)).toEqual(["cat-b", "cat-a"]);
  });

  test("shares of the forecast across all categories add up to one", () => {
    const cats = [category({ id: "cat-1" }), category({ id: "cat-2" })];
    const items = [
      item({ id: "i-1", category_id: "cat-1", contracted_cents: 250_000 }),
      item({ id: "i-2", category_id: "cat-2", contracted_cents: 750_000 }),
    ];
    const tree = assembleTree(cats, items, [], now, VENUE);
    expect(tree[0].shareOfForecast).toBeCloseTo(0.25, 10);
    expect(tree.reduce((s, c) => s + c.shareOfForecast, 0)).toBeCloseTo(1, 10);
  });
});

// ===========================================================================
// Whole-budget totals
// ===========================================================================

describe("rollUpBudget", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  /** One category holding one contracted line, for the arithmetic tests. */
  function treeWith(overrides: Partial<ItemFact>, cat: Partial<CategoryFact> = {}) {
    const c = category({ id: "cat-1", ...cat });
    const i = item({ id: "item-1", category_id: "cat-1", ...overrides });
    return assembleTree([c], [i], [], now, VENUE);
  }

  test("the headline claim: $60,170 forecast against a $40,962 reference is +$19,208, +47%", () => {
    const tree = treeWith(
      { benchmark_cents: 4_096_200, contracted_cents: 6_017_000 },
    );
    const totals = rollUpBudget(tree, null);
    expect(totals.benchmarkCents).toBe(4_096_200);
    expect(totals.forecastCents).toBe(6_017_000);
    expect(totals.benchmark.deltaCents).toBe(1_920_800);
    expect(Math.round((totals.benchmark.pct as number) * 100)).toBe(47);
    expect(totals.benchmark.direction).toBe("over");
  });

  test("total due is forecast minus paid", () => {
    const c = category({ id: "cat-1" });
    const i = item({ id: "item-1", category_id: "cat-1", contracted_cents: 1_000_000 });
    const p = payment({ item_id: "item-1", amount_cents: 300_000, paid: true });
    const totals = rollUpBudget(assembleTree([c], [i], [p], now, VENUE), null);
    expect(totals.paidCents).toBe(300_000);
    expect(totals.dueCents).toBe(700_000);
  });

  test("total due is floored at zero when a line was overpaid", () => {
    const c = category({ id: "cat-1" });
    const i = item({ id: "item-1", category_id: "cat-1", contracted_cents: 100_000 });
    const p = payment({ item_id: "item-1", amount_cents: 150_000, paid: true });
    const totals = rollUpBudget(assembleTree([c], [i], [p], now, VENUE), null);
    expect(totals.dueCents).toBe(0);
  });

  test("left in budget is negative when the forecast exceeds the ceiling", () => {
    const totals = rollUpBudget(treeWith({ contracted_cents: 6_017_000 }), 5_000_000);
    expect(totals.remainingAfterForecastCents).toBe(-1_017_000);
    expect(totals.health).toBe("over");
  });

  test("both 'left in budget' figures are null when no ceiling has been set", () => {
    const totals = rollUpBudget(treeWith({ contracted_cents: 1_000 }), null);
    expect(totals.remainingAfterForecastCents).toBeNull();
    expect(totals.remainingAfterPaidCents).toBeNull();
    expect(totals.health).toBe("unset");
  });

  test("an empty budget is all zeros and never NaN", () => {
    const totals = rollUpBudget([], null);
    expect(totals.forecastCents).toBe(0);
    expect(totals.paidCents).toBe(0);
    expect(totals.dueCents).toBe(0);
    expect(totals.itemCount).toBe(0);
    expect(totals.benchmark.direction).toBe("unknown");
    expect(totals.currencies).toEqual([]);
    expect(totals.mixedCurrency).toBe(false);
  });

  test("a budget with no reference figures anywhere compares as unknown", () => {
    const totals = rollUpBudget(treeWith({ contracted_cents: 500_000 }), null);
    expect(totals.benchmarkCents).toBe(0);
    expect(totals.benchmark.benchmarkCents).toBeNull();
    expect(totals.benchmark.direction).toBe("unknown");
  });

  test("counts items and overdue payments across every category", () => {
    const cats = [category({ id: "cat-1" }), category({ id: "cat-2" })];
    const items = [
      item({ id: "i-1", category_id: "cat-1" }),
      item({ id: "i-2", category_id: "cat-2" }),
    ];
    const pays = [
      payment({ item_id: "i-1", amount_cents: 20_000, due_date: "2026-07-01" }),
      payment({ item_id: "i-2", amount_cents: 30_000, due_date: "2026-07-02" }),
      payment({ item_id: "i-2", amount_cents: 90_000, due_date: "2028-07-02" }),
    ];
    const totals = rollUpBudget(assembleTree(cats, items, pays, now, VENUE), null);
    expect(totals.itemCount).toBe(2);
    expect(totals.overdueCount).toBe(2);
    expect(totals.overdueCents).toBe(50_000);
  });

  test("mixedCurrency is false when everything is in one currency", () => {
    const totals = rollUpBudget(treeWith({ currency: "USD", contracted_cents: 1 }), null);
    expect(totals.mixedCurrency).toBe(false);
    expect(totals.currencies).toEqual(["USD"]);
  });

  test("mixedCurrency is true as soon as a second currency appears, and nothing converts", () => {
    const c = category({ id: "cat-1" });
    const items = [
      item({ id: "i-1", category_id: "cat-1", currency: "USD", contracted_cents: 100 }),
      item({ id: "i-2", category_id: "cat-1", currency: "MXN", contracted_cents: 200 }),
      item({ id: "i-3", category_id: "cat-1", currency: "USD", contracted_cents: 300 }),
    ];
    const totals = rollUpBudget(assembleTree([c], items, [], now, VENUE), null);
    expect(totals.mixedCurrency).toBe(true);
    expect(totals.currencies).toEqual(["MXN", "USD"]); // sorted and de-duplicated
    expect(totals.forecastCents).toBe(600); // naive sum, no FX
  });
});

// ===========================================================================
// Budget health
// ===========================================================================

describe("budgetHealth", () => {
  test("no ceiling is 'unset', not an optimistic 'under'", () => {
    expect(budgetHealth({ forecastCents: 5_000_000, paidCents: 0 }, null)).toBe("unset");
  });

  test("a single cent over the ceiling is over", () => {
    expect(budgetHealth({ forecastCents: 1_000_001, paidCents: 0 }, 1_000_000)).toBe("over");
  });

  test("exactly on the ceiling is tight, not over", () => {
    expect(budgetHealth({ forecastCents: 1_000_000, paidCents: 0 }, 1_000_000)).toBe("tight");
  });

  test("95% of the ceiling is tight", () => {
    expect(budgetHealth({ forecastCents: 950_000, paidCents: 0 }, 1_000_000)).toBe("tight");
  });

  test("60% of the ceiling is on track", () => {
    expect(budgetHealth({ forecastCents: 600_000, paidCents: 0 }, 1_000_000)).toBe("on_track");
  });

  test("20% of the ceiling is under", () => {
    expect(budgetHealth({ forecastCents: 200_000, paidCents: 0 }, 1_000_000)).toBe("under");
  });

  test("a ceiling of zero does not divide by zero", () => {
    expect(budgetHealth({ forecastCents: 1, paidCents: 0 }, 0)).toBe("over");
    expect(budgetHealth({ forecastCents: 0, paidCents: 0 }, 0)).toBe("under");
  });
});

// ===========================================================================
// Deposit auto-split
// ===========================================================================

describe("splitDeposit — the app does the subtraction, never the user", () => {
  test("a $15,370 total with a $5,000 deposit leaves a $10,370 balance", () => {
    expect(splitDeposit(1_537_000, 500_000)).toEqual({
      ok: true,
      deposit: 500_000,
      balance: 1_037_000,
    });
  });

  test("deposit plus balance equals the total exactly, in integer cents", () => {
    const split = splitDeposit(1_537_001, 499_999);
    expect(split.ok).toBe(true);
    if (split.ok) expect(split.deposit + split.balance).toBe(1_537_001);
  });

  test("paying it all up front leaves a zero balance, so the caller writes one payment", () => {
    expect(splitDeposit(1_537_000, 1_537_000)).toEqual({
      ok: true,
      deposit: 1_537_000,
      balance: 0,
    });
  });

  test("no deposit means the whole total is the balance", () => {
    expect(splitDeposit(1_537_000, 0)).toEqual({ ok: true, deposit: 0, balance: 1_537_000 });
  });

  test("a deposit larger than the total is rejected with the exact copy", () => {
    expect(splitDeposit(100_000, 200_000)).toEqual({
      ok: false,
      message: "The deposit is more than the total. Check the numbers.",
    });
  });

  test("a negative deposit is rejected", () => {
    expect(splitDeposit(100_000, -1)).toEqual({
      ok: false,
      message: "Amounts can't be negative.",
    });
  });

  test("a negative total is rejected", () => {
    expect(splitDeposit(-100_000, 0)).toEqual({
      ok: false,
      message: "Amounts can't be negative.",
    });
  });

  test("NaN is rejected rather than producing a NaN balance", () => {
    expect(splitDeposit(Number.NaN, 0).ok).toBe(false);
  });
});

// ===========================================================================
// Percentage allocation
// ===========================================================================

describe("allocateByPercent — largest remainder, so the categories add up", () => {
  test("DEFAULT_ALLOCATION sums to 1 and holds exactly one contingency", () => {
    const total = DEFAULT_ALLOCATION.reduce((s, slice) => s + slice.pct, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(DEFAULT_ALLOCATION.filter((s) => s.isContingency === true)).toHaveLength(1);
    expect(DEFAULT_ALLOCATION).toHaveLength(9);
  });

  test("an awkward total still splits to the exact cent", () => {
    // Naive Math.round(total * pct) sums to 4_133_334 here — one cent too many,
    // and the seeded categories then don't match the budget she typed.
    const result = allocateByPercent(4_133_333, DEFAULT_ALLOCATION);
    expect(result.reduce((s, r) => s + r.targetCents, 0)).toBe(4_133_333);
  });

  test("every allocation is a whole number of cents", () => {
    const result = allocateByPercent(4_133_333, DEFAULT_ALLOCATION);
    expect(result.every((r) => Number.isInteger(r.targetCents))).toBe(true);
  });

  test("a round total splits without needing the remainder pass", () => {
    const result = allocateByPercent(10_000_000, DEFAULT_ALLOCATION);
    expect(result.reduce((s, r) => s + r.targetCents, 0)).toBe(10_000_000);
    expect(result[0]).toEqual({
      name: "Venue",
      pct: 0.25,
      targetCents: 2_500_000,
      isContingency: false,
    });
  });

  test("the contingency slice is flagged in the result", () => {
    const result = allocateByPercent(10_000_000, DEFAULT_ALLOCATION);
    const contingency = result.find((r) => r.isContingency);
    expect(contingency?.name).toBe("Contingency");
    expect(contingency?.targetCents).toBe(800_000);
  });

  test("names and order are preserved", () => {
    const result = allocateByPercent(1_000_000, DEFAULT_ALLOCATION);
    expect(result.map((r) => r.name)).toEqual(DEFAULT_ALLOCATION.map((s) => s.name));
  });

  test("a total of zero allocates zero to everything without dividing", () => {
    const result = allocateByPercent(0, DEFAULT_ALLOCATION);
    expect(result.reduce((s, r) => s + r.targetCents, 0)).toBe(0);
  });

  test("percentages that do not add to 100% are rejected", () => {
    expect(() =>
      allocateByPercent(1_000_000, [
        { name: "Venue", pct: 0.5 },
        { name: "Contingency", pct: 0.2, isContingency: true },
      ]),
    ).toThrow("These percentages need to add up to 100%.");
  });

  test("a plan with no contingency is rejected — the buffer is mandatory", () => {
    expect(() =>
      allocateByPercent(1_000_000, [
        { name: "Venue", pct: 0.6 },
        { name: "Food", pct: 0.4 },
      ]),
    ).toThrow("Set aside a contingency — every wedding needs one.");
  });

  test("an empty plan is rejected", () => {
    expect(() => allocateByPercent(1_000_000, [])).toThrow();
  });

  test("a negative share is rejected", () => {
    expect(() =>
      allocateByPercent(1_000_000, [
        { name: "Venue", pct: 1.2 },
        { name: "Contingency", pct: -0.2, isContingency: true },
      ]),
    ).toThrow("Every share has to be zero or more.");
  });

  test("a negative total is rejected", () => {
    expect(() => allocateByPercent(-1, DEFAULT_ALLOCATION)).toThrow("Amounts can't be negative.");
  });

  test("a fractional cent total is rejected rather than silently floored", () => {
    expect(() => allocateByPercent(100.5, DEFAULT_ALLOCATION)).toThrow();
  });

  test("a tiny total is still distributed exactly, cent by cent", () => {
    const result = allocateByPercent(7, DEFAULT_ALLOCATION);
    expect(result.reduce((s, r) => s + r.targetCents, 0)).toBe(7);
  });
});

// ===========================================================================
// Payment windowing
// ===========================================================================

describe("upcomingPayments — overdue lives somewhere louder", () => {
  const now = new Date("2026-07-29T12:00:00Z"); // 06:00 on the 29th at the venue.

  test("includes today and the last day of the window, excludes the day after", () => {
    const today = payment({ due_date: "2026-07-29" });
    const edge = payment({ due_date: "2026-08-12" }); // exactly 14 days out
    const past = payment({ due_date: "2026-08-13" }); // 15 days out
    const found = upcomingPayments([today, edge, past], now, VENUE, 14).map((p) => p.id);
    expect(found).toEqual([today.id, edge.id]);
  });

  test("excludes paid payments", () => {
    const p = payment({ due_date: "2026-08-01", paid: true, paid_on: "2026-07-01" });
    expect(upcomingPayments([p], now, VENUE, 30)).toHaveLength(0);
  });

  test("excludes overdue payments", () => {
    const p = payment({ due_date: "2026-07-01" });
    expect(upcomingPayments([p], now, VENUE, 30)).toHaveLength(0);
  });

  test("excludes payments with no due date", () => {
    expect(upcomingPayments([payment({ due_date: null })], now, VENUE, 30)).toHaveLength(0);
  });

  test("sorts soonest first, then largest amount", () => {
    const late = payment({ due_date: "2026-08-05", amount_cents: 10_000 });
    const smallSoon = payment({ due_date: "2026-08-01", amount_cents: 10_000 });
    const bigSoon = payment({ due_date: "2026-08-01", amount_cents: 90_000 });
    const found = upcomingPayments([late, smallSoon, bigSoon], now, VENUE, 30).map((p) => p.id);
    expect(found).toEqual([bigSoon.id, smallSoon.id, late.id]);
  });

  test("returns views, so the caller already has the label", () => {
    const found = upcomingPayments([payment({ due_date: "2026-07-30" })], now, VENUE, 30);
    expect(found[0].label_due).toBe("Due tomorrow");
    expect(found[0].status).toBe("due_soon");
  });

  test("a zero-day window still contains what is due today", () => {
    const today = payment({ due_date: "2026-07-29" });
    const tomorrow = payment({ due_date: "2026-07-30" });
    expect(upcomingPayments([today, tomorrow], now, VENUE, 0).map((p) => p.id)).toEqual([today.id]);
  });

  test("does not mutate the array it is given", () => {
    const a = payment({ due_date: "2026-08-05" });
    const b = payment({ due_date: "2026-08-01" });
    const input = [a, b];
    upcomingPayments(input, now, VENUE, 30);
    expect(input.map((p) => p.id)).toEqual([a.id, b.id]);
  });
});

describe("overduePayments", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  test("collects unpaid payments whose day has passed, oldest first", () => {
    const older = payment({ due_date: "2026-06-01" });
    const newer = payment({ due_date: "2026-07-20" });
    const fine = payment({ due_date: "2026-08-20" });
    expect(overduePayments([newer, fine, older], now, VENUE).map((p) => p.id)).toEqual([
      older.id,
      newer.id,
    ]);
  });

  test("a paid payment is never overdue, however late it was", () => {
    const p = payment({ due_date: "2020-01-01", paid: true, paid_on: "2026-01-01" });
    expect(overduePayments([p], now, VENUE)).toHaveLength(0);
  });

  test("a payment with no due date is never overdue", () => {
    expect(overduePayments([payment({ due_date: null })], now, VENUE)).toHaveLength(0);
  });
});

describe("paymentsDueThisMonth", () => {
  test("a payment due the 3rd, still unpaid on the 29th, is due this month", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    const p = payment({ due_date: "2026-07-03", amount_cents: 120_000 });
    expect(paymentsDueThisMonth([p], now, VENUE)).toEqual({ count: 1, cents: 120_000 });
  });

  test("next month's payment is not counted", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    const p = payment({ due_date: "2026-08-01" });
    expect(paymentsDueThisMonth([p], now, VENUE).count).toBe(0);
  });

  test("the same month a year earlier is not counted", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    expect(paymentsDueThisMonth([payment({ due_date: "2025-07-29" })], now, VENUE).count).toBe(0);
  });

  test("paid payments are excluded", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    const p = payment({ due_date: "2026-07-03", paid: true, paid_on: "2026-07-03" });
    expect(paymentsDueThisMonth([p], now, VENUE).count).toBe(0);
  });

  test("the month boundary is the venue's, not the server's", () => {
    // 02:00Z on August 1st is still 20:00 on July 31st in Guadalajara.
    const now = new Date("2026-08-01T02:00:00Z");
    const p = payment({ due_date: "2026-07-31", amount_cents: 80_000 });
    expect(paymentsDueThisMonth([p], now, VENUE)).toEqual({ count: 1, cents: 80_000 });
    expect(paymentsDueThisMonth([p], now, "UTC").count).toBe(0);
  });

  test("sums several payments in the month", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    const ps = [
      payment({ due_date: "2026-07-03", amount_cents: 100 }),
      payment({ due_date: "2026-07-30", amount_cents: 200 }),
      payment({ due_date: "2026-09-30", amount_cents: 400 }),
    ];
    expect(paymentsDueThisMonth(ps, now, VENUE)).toEqual({ count: 2, cents: 300 });
  });

  test("nothing due gives zeros, never NaN", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    expect(paymentsDueThisMonth([], now, VENUE)).toEqual({ count: 0, cents: 0 });
  });
});

// ===========================================================================
// Validation
// ===========================================================================

describe("validateCategory", () => {
  test("a blank name is rejected", () => {
    expect(validateCategory({ name: "   " })).toEqual({
      ok: false,
      errors: [{ field: "name", message: "Give this category a name." }],
    });
  });

  test("a valid name comes back trimmed", () => {
    expect(validateCategory({ name: "  Flowers + Decor " })).toEqual({
      ok: true,
      value: { name: "Flowers + Decor" },
    });
  });
});

describe("validateItem", () => {
  test("only the name is required — an unpriced line is normal months out", () => {
    const result = validateItem({ name: "Late-night tacos" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.estimatedCents).toBeNull();
      expect(result.warning).toBe("No cost recorded yet — this line won't count toward your total.");
    }
  });

  test("a whitespace-only name is rejected", () => {
    const result = validateItem({ name: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toEqual({ field: "name", message: "Give this line a name." });
  });

  test("a priced line carries no warning", () => {
    const result = validateItem({ name: "Venue", contractedCents: 1_537_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBeUndefined();
      expect(result.value.contractedCents).toBe(1_537_000);
    }
  });

  test("a benchmark alone still counts as unpriced", () => {
    const result = validateItem({ name: "Venue", benchmarkCents: 900_000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toBeDefined();
  });

  test("negative costs are rejected, naming every offending field", () => {
    const result = validateItem({ name: "Venue", estimatedCents: -1, quotedCents: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(["estimated", "quoted"]);
  });

  test("a zero cost is allowed — it is a real answer", () => {
    const result = validateItem({ name: "Favours", contractedCents: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contractedCents).toBe(0);
  });

  test("a zero or fractional quantity is rejected", () => {
    expect(validateItem({ name: "Chairs", quantity: 0 }).ok).toBe(false);
    expect(validateItem({ name: "Chairs", quantity: 1.5 }).ok).toBe(false);
    expect(validateItem({ name: "Chairs", quantity: 120 }).ok).toBe(true);
  });

  test("the name is trimmed on the way out", () => {
    const result = validateItem({ name: "  Cake  ", estimatedCents: 1 });
    if (result.ok) expect(result.value.name).toBe("Cake");
  });
});

describe("validatePayment — overspending warns, it never blocks", () => {
  test("a missing amount is rejected", () => {
    const result = validatePayment({ amountCents: null }, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toBe("A payment needs an amount.");
  });

  test("a zero or negative amount is rejected", () => {
    expect(validatePayment({ amountCents: 0 }, null).ok).toBe(false);
    expect(validatePayment({ amountCents: -100 }, null).ok).toBe(false);
  });

  test("the label defaults to 'Payment' when left blank", () => {
    const result = validatePayment({ amountCents: 100, label: "  " }, null);
    if (result.ok) expect(result.value.label).toBe("Payment");
  });

  test("a real label is trimmed and kept", () => {
    const result = validatePayment({ amountCents: 100, label: " Deposit " }, null);
    if (result.ok) expect(result.value.label).toBe("Deposit");
  });

  test("an impossible due date is rejected rather than parsed into something else", () => {
    const result = validatePayment({ amountCents: 100, dueDate: "2026-02-30" }, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].field).toBe("dueDate");
  });

  test("a free-text due date is rejected", () => {
    expect(validatePayment({ amountCents: 100, dueDate: "next Tuesday" }, null).ok).toBe(false);
  });

  test("a blank due date means unscheduled, not invalid", () => {
    const result = validatePayment({ amountCents: 100, dueDate: "  " }, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dueDate).toBeNull();
  });

  test("marking a payment unpaid clears any stale paid-on date", () => {
    const result = validatePayment({ amountCents: 100, paid: false, paidOn: "2026-01-01" }, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.paidOn).toBeNull();
  });

  test("paid with no date is allowed — the caller stamps today at the venue", () => {
    const result = validatePayment({ amountCents: 100, paid: true }, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paid).toBe(true);
      expect(result.value.paidOn).toBeNull();
    }
  });

  test("scheduling more than the recorded cost warns but still saves", () => {
    const result = validatePayment(
      { amountCents: 600_000, otherScheduledCents: 500_000 },
      1_000_000,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBe("These payments add up to more than the cost you recorded.");
      expect(result.value.amountCents).toBe(600_000);
    }
  });

  test("scheduling exactly the recorded cost does not warn", () => {
    const result = validatePayment(
      { amountCents: 500_000, otherScheduledCents: 500_000 },
      1_000_000,
    );
    if (result.ok) expect(result.warning).toBeUndefined();
  });

  test("with no recorded cost there is nothing to overspend against", () => {
    const result = validatePayment({ amountCents: 9_999_999 }, null);
    if (result.ok) expect(result.warning).toBeUndefined();
  });
});

// ===========================================================================
// Regressions from the adversarial review of /admin/budget. Each of these was
// reproduced live in the browser against the couple's real seeded data.
// ===========================================================================

describe("money already paid cannot fall out of the forecast", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  // The normal order of events is that she pays a deposit and only later learns
  // the total, so most lines are unpriced when the first money moves.
  test("an unpriced line forecasts at least what has been paid against it", () => {
    const i = item(); // no estimate, no quote, no contract
    const r = rollOne(i, [payment({ amount_cents: 50_000, paid: true, paid_on: "2026-07-30" })], now);
    expect(r.paidCents).toBe(50_000);
    expect(r.forecastCents).toBe(50_000);
    expect(r.remainingCents).toBe(0);
  });

  test("paying more than the recorded price raises the forecast to what was paid", () => {
    const i = item({ estimated_cents: 30_000 });
    const r = rollOne(i, [payment({ amount_cents: 45_000, paid: true, paid_on: "2026-07-30" })], now);
    expect(r.forecastCents).toBe(45_000);
    expect(r.remainingCents).toBe(0);
  });

  test("an unpaid payment does not inflate the forecast", () => {
    const i = item({ estimated_cents: 30_000 });
    const r = rollOne(i, [payment({ amount_cents: 45_000, paid: false, paid_on: null })], now);
    expect(r.forecastCents).toBe(30_000);
  });

  test("a recorded price still wins while it is larger than what has been paid", () => {
    const i = item({ contracted_cents: 80_000 });
    const r = rollOne(i, [payment({ amount_cents: 20_000, paid: true, paid_on: "2026-07-30" })], now);
    expect(r.forecastCents).toBe(80_000);
    expect(r.remainingCents).toBe(60_000);
  });
});

describe("the grand STILL TO PAY equals the column above it", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  // The footer used to re-derive this as forecast − paid across the whole
  // budget, which nets an overpayment on one line against what is still owed on
  // another. Two disagreeing figures on one screen is what sends someone back
  // to a spreadsheet.
  test("an overpaid line does not cancel out what another line still owes", () => {
    const c = category();
    const overpaid = item({ category_id: c.id, estimated_cents: 10_000 });
    const owing = item({ category_id: c.id, estimated_cents: 100_000 });
    const tree = assembleTree(
      [c],
      [overpaid, owing],
      [payment({ item_id: overpaid.id, amount_cents: 40_000, paid: true, paid_on: "2026-07-30" })],
      now,
      VENUE,
    );
    const totals = rollUpBudget(tree, null);
    const columnSum = tree.reduce((sum, cat) => sum + cat.remainingCents, 0);

    expect(totals.dueCents).toBe(columnSum);
    expect(totals.dueCents).toBe(100_000); // the second line, in full
  });

  test("the footer matches the column across a mixed budget", () => {
    const c1 = category();
    const c2 = category();
    const tree = assembleTree(
      [c1, c2],
      [
        item({ category_id: c1.id, contracted_cents: 200_000 }),
        item({ category_id: c1.id, estimated_cents: 50_000 }),
        item({ category_id: c2.id }),
      ],
      [payment({ item_id: "unmatched", amount_cents: 10_000, paid: true, paid_on: "2026-07-30" })],
      now,
      VENUE,
    );
    const totals = rollUpBudget(tree, null);
    const columnSum = tree.reduce((sum, cat) => sum + cat.remainingCents, 0);
    expect(totals.dueCents).toBe(columnSum);
  });
});
