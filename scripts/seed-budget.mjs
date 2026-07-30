#!/usr/bin/env node
// Seed the real wedding budget from the client's spreadsheet.
//
// The parsing, the money arithmetic, the category-vs-item discrimination and
// every reconciliation decision live in lib/csv/budget.ts, where vitest can see
// them. This file is a shell: read the CSV, build the plan, print it, and — only
// when told to — write it. Re-implementing any of the arithmetic here is how the
// $321 error in the source sheet got there in the first place.
//
// Usage:
//   node scripts/seed-budget.mjs <csv>                  dry run: parse, report, write nothing
//   node scripts/seed-budget.mjs <csv> --sql            print the idempotent SQL (apply via the Supabase MCP)
//   node scripts/seed-budget.mjs <csv> --apply          write it with the service-role client
//   node scripts/seed-budget.mjs <csv> --verify         re-check the live rows against the plan
//   node scripts/seed-budget.mjs <csv> --reset --apply  replace the seeded rows (destructive; see below)
//   node scripts/seed-budget.mjs <csv> --reset --apply --force
//
// Idempotency: categories are matched on their stable `slug` and items on
// (category, lower(trim(name))), and both inserts skip what already exists. A
// second run therefore inserts nothing and says so — no --reset required, and
// nothing already in the database is overwritten. --reset exists only for the
// case the client sends a revised sheet, and refuses to destroy payments or
// vendor links without --force.
//
// Guardrails honoured here: additive by default, every statement scoped by
// wedding_id, no truncate, no DDL, no email, and no clock — the script never
// calls new Date(); `now()` is evaluated by Postgres.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createJiti } from "jiti";

const WEDDING_ID = "11111111-1111-1111-1111-111111111111";
const CURRENCY = "USD";

// ---------------------------------------------------------------- environment
// Copied from scripts/dev-login.mjs. No --env-file: no other script here uses it.
const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {
  console.error("Could not read .env.local next to the project root.");
  process.exit(1);
}

// --------------------------------------------------------------------- inputs
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const CSV = args.find((a) => !a.startsWith("--"));
const MODE = {
  sql: flag("sql"),
  apply: flag("apply"),
  verify: flag("verify"),
  reset: flag("reset"),
  force: flag("force"),
};

if (!CSV) {
  console.error('Usage: node scripts/seed-budget.mjs "<path to the budget CSV>" [--sql|--apply|--verify]');
  process.exit(1);
}

// --sql reads the live categories too: which fixes it emits depends on what is
// already stored, and emitting a blind update would be exactly the silent
// clobber this script exists to avoid.
const needsDb = MODE.apply || MODE.verify || MODE.sql;
if (needsDb && (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = needsDb
  ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// -------------------------------------------------------------- the pure plan
// jiti (2.7.0, already in the lockfile as a Next transitive dep) loads the
// TypeScript module with the repo's "@" alias, so there is exactly one copy of
// this logic and the tests cover the copy that runs.
const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("..", import.meta.url).pathname },
});
const { buildBudgetSeedPlan } = await jiti.import("../lib/csv/budget.ts");
// The same formatter the app renders with, so a figure in this report and the
// same figure on the budget page can never be formatted two different ways.
const { formatMoney: money } = await jiti.import("../lib/format/money.ts");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

async function benchmarkLabel() {
  if (!db) return undefined;
  const { data, error } = await db
    .from("weddings")
    .select("budget_benchmark_label")
    .eq("id", WEDDING_ID)
    .single();
  if (error) fail(`Could not read the benchmark label: ${error.message}`);
  return data.budget_benchmark_label ?? undefined;
}

const plan = buildBudgetSeedPlan(readFileSync(CSV, "utf8"), {
  benchmarkLabel: await benchmarkLabel(),
});

// The contingency category is the one row in the taxonomy the spreadsheet does
// not contain: every planner surveyed recommends holding back 5–10%, and the
// category has to exist for the idea to be visible. It is deliberately seeded
// with no money — picking a figure would be configuring on the client's behalf.
const CONTINGENCY_SLUG = "contingency";
const CONTINGENCY_NOTE =
  `Every planner surveyed recommends holding back 5–10%. On a ${money(plan.totals.estimatedCents)} forecast ` +
  `that is ${money(Math.round(plan.totals.estimatedCents * 0.0005) * 100)}–${money(Math.round(plan.totals.estimatedCents * 0.001) * 100)}. ` +
  `Nothing set aside yet.`;

// ------------------------------------------------------- category reconciling
/**
 * Match the sheet's categories against the rows already in the database.
 *
 * Categories were seeded by migration 0012, so the normal outcome is "reused
 * eleven, added none". Anything else is reported rather than resolved:
 *
 * - a category in the sheet with no row → inserted (additive, keeps its slug);
 * - a row with no category in the sheet → left exactly as it is, and named in
 *   the report, because deleting a category out of a live budget is not a
 *   decision a seed script gets to make;
 * - a stored override that disagrees with the sheet by more than a dollar →
 *   reported, never overwritten: a human may have edited it deliberately;
 * - a stored override within a dollar of its own rows → aligned to the rows,
 *   because that dollar is the sheet's whole-dollar display rounding, and
 *   leaving it makes the category total on screen disagree with the item rows
 *   directly beneath it. The printed figure is preserved in the notes.
 */
function reconcileCategories(existing) {
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const reused = [];
  const added = [];
  const overrideFixes = [];
  const mismatches = [];
  const noteFills = [];

  for (const category of plan.categories) {
    const row = bySlug.get(category.slug);
    if (!row) {
      added.push({ slug: category.slug, name: category.name });
      continue;
    }
    reused.push({ slug: category.slug, name: row.name, itemsToSeed: category.items.length });

    const drift = category.benchmarkCents - (row.benchmark_cents ?? category.benchmarkCents);
    if (drift !== 0 && Math.abs(drift) <= 100) {
      overrideFixes.push({
        slug: category.slug,
        column: "benchmark_cents",
        from: row.benchmark_cents,
        to: category.benchmarkCents,
        reason:
          `The stored category benchmark ${money(row.benchmark_cents)} is the sheet's printed header; its own rows add to ` +
          `${money(category.benchmarkCents)}. Within a dollar, so this is the sheet's whole-dollar display rounding — ` +
          `aligning the override with the rows so the category total and the grand total agree.`,
      });
    } else if (drift !== 0) {
      mismatches.push({
        slug: category.slug,
        column: "benchmark_cents",
        stored: row.benchmark_cents,
        fromSheet: category.benchmarkCents,
        note: "Left alone. More than a dollar apart — a human decision, not rounding.",
      });
    }

    const targetDrift = category.estimatedCents - (row.target_cents ?? category.estimatedCents);
    if (targetDrift !== 0) {
      mismatches.push({
        slug: category.slug,
        column: "target_cents",
        stored: row.target_cents,
        fromSheet: category.estimatedCents,
        note: "Left alone. target_cents is the top-down allocation and is only read when a category has no items.",
      });
    }
  }

  const unmapped = existing
    .filter((c) => !plan.categories.some((p) => p.slug === c.slug))
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      targetCents: c.target_cents,
      benchmarkCents: c.benchmark_cents,
      isContingency: c.is_contingency,
      note:
        c.slug === CONTINGENCY_SLUG
          ? "Deliberate: the contingency category is not in the spreadsheet. Seeded with zero items and no figure."
          : "Not in the spreadsheet. Left untouched — deleting a category from a live budget is the client's call, not this script's.",
    }));

  const contingency = bySlug.get(CONTINGENCY_SLUG);
  if (contingency && !contingency.notes) {
    noteFills.push({ slug: CONTINGENCY_SLUG, notes: CONTINGENCY_NOTE });
  }

  return { reused, added, unmapped, overrideFixes, mismatches, noteFills };
}

// --------------------------------------------------------------- the payloads
const categoryPayload = () =>
  plan.categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    sort_order: c.sortOrder,
    benchmark_cents: c.headerBenchmarkCents,
    target_cents: c.headerEstimatedCents,
  }));

const itemPayload = () =>
  plan.categories.flatMap((c) =>
    c.items.map((i) => ({
      slug: c.slug,
      name: i.name,
      qty: i.qty,
      unit_price_cents: i.unitPriceCents,
      benchmark_cents: i.benchmarkCents,
      estimated_cents: i.estimatedCents,
      notes: i.notes,
      is_reconciliation: i.isReconciliation,
      sort_order: i.sortOrder,
    })),
  );

const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const json = (value) => `${lit(JSON.stringify(value))}::jsonb`;

/**
 * The same writes as --apply, as SQL, so they can be applied through the
 * Supabase MCP (the house rule: the MCP, never the CLI, whose shared credential
 * drifts between accounts).
 *
 * Every statement is idempotent on its own: the inserts skip rows that exist,
 * and the updates are guarded on the value they expect to replace, so a second
 * application is a no-op rather than a clobber.
 */
function toSql(fixes) {
  const statements = [];

  statements.push(
    `insert into budget_categories (wedding_id, slug, name, sort_order, benchmark_cents, target_cents, is_contingency)
select ${lit(WEDDING_ID)}, p.slug, p.name, p.sort_order, p.benchmark_cents, p.target_cents, false
from jsonb_to_recordset(${json(categoryPayload())})
  as p(slug text, name text, sort_order int, benchmark_cents bigint, target_cents bigint)
on conflict (wedding_id, slug) do nothing;`,
  );

  for (const fix of fixes.overrideFixes) {
    statements.push(
      `update budget_categories
   set ${fix.column} = ${fix.to},
       notes = coalesce(notes || ' ', '') || ${lit(`Spreadsheet header printed ${money(fix.from)}; its own rows add to ${money(fix.to)}. Aligned to the rows.`)},
       updated_at = now()
 where wedding_id = ${lit(WEDDING_ID)} and slug = ${lit(fix.slug)} and ${fix.column} = ${fix.from};`,
    );
  }

  for (const fill of fixes.noteFills) {
    statements.push(
      `update budget_categories set notes = ${lit(fill.notes)}, updated_at = now()
 where wedding_id = ${lit(WEDDING_ID)} and slug = ${lit(fill.slug)} and notes is null;`,
    );
  }

  statements.push(
    `insert into budget_items (
  wedding_id, category_id, name, qty, unit_price_cents, benchmark_cents,
  estimated_cents, currency, is_reconciliation, notes, sort_order)
select ${lit(WEDDING_ID)}, c.id, p.name, p.qty, p.unit_price_cents, p.benchmark_cents,
       p.estimated_cents, ${lit(CURRENCY)}, p.is_reconciliation, p.notes, p.sort_order
from jsonb_to_recordset(${json(itemPayload())})
  as p(slug text, name text, qty text, unit_price_cents bigint, benchmark_cents bigint,
       estimated_cents bigint, notes text, is_reconciliation boolean, sort_order int)
join budget_categories c on c.wedding_id = ${lit(WEDDING_ID)} and c.slug = p.slug
where not exists (
  select 1 from budget_items i
   where i.wedding_id = ${lit(WEDDING_ID)}
     and i.category_id = c.id
     and lower(btrim(i.name)) = lower(btrim(p.name))
);`,
  );

  statements.push(
    `insert into activity_log (wedding_id, actor_type, action, payload)
select ${lit(WEDDING_ID)}, 'system', 'budget.seeded', ${json(summary("apply"))}
 where not exists (
   select 1 from activity_log where wedding_id = ${lit(WEDDING_ID)} and action = 'budget.seeded'
 );`,
  );

  return statements;
}

// ------------------------------------------------------------------ reporting
function summary(mode) {
  return {
    mode,
    categories: plan.totals.categoryCount,
    items: plan.totals.itemCount,
    reconciliationItems: plan.totals.reconciliationItemCount,
    payments: 0,
    benchmarkCents: plan.totals.benchmarkCents,
    estimatedCents: plan.totals.estimatedCents,
    benchmark: money(plan.totals.benchmarkCents),
    forecast: money(plan.totals.estimatedCents),
    printedGrandTotal: {
      benchmark: money(plan.printedGrandTotal.benchmarkCents),
      forecast: money(plan.printedGrandTotal.estimatedCents),
    },
  };
}

function report(mode, extra) {
  return {
    ...summary(mode),
    csv: CSV,
    categoryTotals: plan.categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      items: c.items.length,
      benchmark: money(c.benchmarkCents),
      forecast: money(c.estimatedCents),
      benchmarkCents: c.benchmarkCents,
      estimatedCents: c.estimatedCents,
      printedHeader: {
        benchmark: money(c.headerBenchmarkCents),
        forecast: money(c.headerEstimatedCents),
      },
    })),
    variances: plan.variances.map((v) => ({
      code: v.code,
      column: v.column,
      printed: money(v.printedCents),
      categoryRows: money(v.headerCents),
      seededItems: money(v.computedCents),
      differenceCents: v.differenceCents,
      explanation: v.explanation,
    })),
    anomalies: plan.anomalies.map((a) => ({
      code: a.code,
      line: a.line,
      category: a.category,
      item: a.item,
      message: a.message,
      resolution: a.resolution,
    })),
    ...extra,
  };
}

// ----------------------------------------------------------------- db helpers
async function counts() {
  const one = async (table, extra = (q) => q) => {
    const { count, error } = await extra(
      db.from(table).select("id", { count: "exact", head: true }).eq("wedding_id", WEDDING_ID),
    );
    if (error) fail(`count(${table}): ${error.message}`);
    return count ?? 0;
  };
  return {
    categories: await one("budget_categories"),
    items: await one("budget_items"),
    reconciliationItems: await one("budget_items", (q) => q.eq("is_reconciliation", true)),
    payments: await one("budget_payments"),
    vendors: await one("vendors"),
  };
}

async function readCategories() {
  const { data, error } = await db
    .from("budget_categories")
    .select("id, slug, name, sort_order, target_cents, benchmark_cents, is_contingency, notes")
    .eq("wedding_id", WEDDING_ID)
    .order("sort_order");
  if (error) fail(`read categories: ${error.message}`);
  return data ?? [];
}

/** Post-write assertions. Every one of these is a number the client can check. */
async function verify() {
  const { data, error } = await db
    .from("budget_items")
    .select("category_id, name, benchmark_cents, estimated_cents, is_reconciliation")
    .eq("wedding_id", WEDDING_ID);
  if (error) fail(`verify: ${error.message}`);
  const categories = await readCategories();
  const byId = new Map(categories.map((c) => [c.id, c]));

  const problems = [];
  const seen = new Map();
  for (const row of data ?? []) {
    const slug = byId.get(row.category_id)?.slug ?? "?";
    const bucket = seen.get(slug) ?? { benchmark: 0, estimated: 0, items: 0 };
    bucket.benchmark += Number(row.benchmark_cents ?? 0);
    bucket.estimated += Number(row.estimated_cents ?? 0);
    bucket.items += 1;
    seen.set(slug, bucket);
  }

  for (const category of plan.categories) {
    const actual = seen.get(category.slug) ?? { benchmark: 0, estimated: 0, items: 0 };
    if (actual.items !== category.items.length) {
      problems.push(`${category.slug}: ${actual.items} items in the database, ${category.items.length} in the plan`);
    }
    if (actual.benchmark !== category.benchmarkCents) {
      problems.push(`${category.slug}: benchmark ${actual.benchmark} in the database, ${category.benchmarkCents} in the plan`);
    }
    if (actual.estimated !== category.estimatedCents) {
      problems.push(`${category.slug}: forecast ${actual.estimated} in the database, ${category.estimatedCents} in the plan`);
    }
  }

  const totals = (data ?? []).reduce(
    (t, r) => ({
      benchmark: t.benchmark + Number(r.benchmark_cents ?? 0),
      estimated: t.estimated + Number(r.estimated_cents ?? 0),
      reconciliation: t.reconciliation + (r.is_reconciliation ? 1 : 0),
    }),
    { benchmark: 0, estimated: 0, reconciliation: 0 },
  );
  if (totals.benchmark !== plan.totals.benchmarkCents) {
    problems.push(`benchmark grand total ${totals.benchmark} ≠ ${plan.totals.benchmarkCents}`);
  }
  if (totals.estimated !== plan.totals.estimatedCents) {
    problems.push(`forecast grand total ${totals.estimated} ≠ ${plan.totals.estimatedCents}`);
  }
  if (totals.reconciliation !== plan.totals.reconciliationItemCount) {
    problems.push(`${totals.reconciliation} reconciliation rows, expected ${plan.totals.reconciliationItemCount}`);
  }

  return {
    ok: problems.length === 0,
    problems,
    live: {
      itemCount: (data ?? []).length,
      benchmarkCents: totals.benchmark,
      estimatedCents: totals.estimated,
      benchmark: money(totals.benchmark),
      forecast: money(totals.estimated),
    },
  };
}

// ----------------------------------------------------------------- the modes
if (MODE.verify && !MODE.apply) {
  const result = await verify();
  console.log(JSON.stringify(report("verify", { verification: result, counts: await counts() }), null, 1));
  process.exit(result.ok ? 0 : 1);
}

if (MODE.sql) {
  const statements = toSql(reconcileCategories(await readCategories()));
  console.log(statements.join("\n\n"));
  process.exit(0);
}

if (!MODE.apply) {
  // Dry run is the default, matching scripts/std-check.mjs: confirmation before
  // configuration. Nothing is written and no database is contacted.
  console.log(JSON.stringify(report("dry-run", { wrote: false }), null, 1));
  process.exit(0);
}

// ------------------------------------------------------------------- --apply
const before = await counts();
const existingCategories = await readCategories();
const fixes = reconcileCategories(existingCategories);

if (MODE.reset) {
  if ((before.payments > 0 || before.vendors > 0) && !MODE.force) {
    fail(
      `--reset would destroy ${before.payments} payments and unlink ${before.vendors} vendors — these are not in the CSV and cannot be rebuilt. Re-run with --force to delete them anyway.`,
    );
  }
  for (const table of ["budget_payments", "budget_items"]) {
    const { error } = await db.from(table).delete().eq("wedding_id", WEDDING_ID);
    if (error) fail(`reset ${table}: ${error.message}`);
  }
}

const insertedCategories = [];
for (const category of fixes.added) {
  const source = plan.categories.find((c) => c.slug === category.slug);
  const { error } = await db.from("budget_categories").insert({
    wedding_id: WEDDING_ID,
    slug: source.slug,
    name: source.name,
    sort_order: source.sortOrder,
    benchmark_cents: source.headerBenchmarkCents,
    target_cents: source.headerEstimatedCents,
  });
  if (error) fail(`insert category ${source.slug}: ${error.message}`);
  insertedCategories.push(source.slug);
}

for (const fix of fixes.overrideFixes) {
  const row = existingCategories.find((c) => c.slug === fix.slug);
  const { error } = await db
    .from("budget_categories")
    .update({
      [fix.column]: fix.to,
      notes: `${row.notes ? `${row.notes} ` : ""}Spreadsheet header printed ${money(fix.from)}; its own rows add to ${money(fix.to)}. Aligned to the rows.`,
    })
    .eq("wedding_id", WEDDING_ID)
    .eq("slug", fix.slug)
    .eq(fix.column, fix.from);
  if (error) fail(`fix ${fix.slug}.${fix.column}: ${error.message}`);
}

for (const fill of fixes.noteFills) {
  const { error } = await db
    .from("budget_categories")
    .update({ notes: fill.notes })
    .eq("wedding_id", WEDDING_ID)
    .eq("slug", fill.slug)
    .is("notes", null);
  if (error) fail(`note ${fill.slug}: ${error.message}`);
}

// Re-read after any insert so every item resolves to a real category id.
const categoriesNow = await readCategories();
const idBySlug = new Map(categoriesNow.map((c) => [c.slug, c.id]));

const { data: liveItems, error: liveError } = await db
  .from("budget_items")
  .select("category_id, name")
  .eq("wedding_id", WEDDING_ID);
if (liveError) fail(`read items: ${liveError.message}`);
const already = new Set(
  (liveItems ?? []).map((i) => `${i.category_id}::${i.name.trim().toLowerCase()}`),
);

const toInsert = [];
const skipped = [];
for (const category of plan.categories) {
  const categoryId = idBySlug.get(category.slug);
  if (!categoryId) fail(`category ${category.slug} is missing after the insert step`);
  for (const item of category.items) {
    const key = `${categoryId}::${item.name.trim().toLowerCase()}`;
    if (already.has(key)) {
      skipped.push(`${category.name} / ${item.name}`);
      continue;
    }
    toInsert.push({
      wedding_id: WEDDING_ID,
      category_id: categoryId,
      name: item.name,
      qty: item.qty,
      unit_price_cents: item.unitPriceCents,
      benchmark_cents: item.benchmarkCents,
      estimated_cents: item.estimatedCents,
      currency: CURRENCY,
      is_reconciliation: item.isReconciliation,
      notes: item.notes,
      sort_order: item.sortOrder,
    });
  }
}

if (toInsert.length > 0) {
  const { error } = await db.from("budget_items").insert(toInsert);
  if (error) fail(`insert items: ${error.message}`);
}

// The seed is a real event in the couple's history and belongs on the feed.
const { data: logged, error: logError } = await db
  .from("activity_log")
  .select("id")
  .eq("wedding_id", WEDDING_ID)
  .eq("action", "budget.seeded")
  .limit(1);
if (logError) fail(`read activity_log: ${logError.message}`);
if ((logged ?? []).length === 0) {
  const { error } = await db.from("activity_log").insert({
    wedding_id: WEDDING_ID,
    actor_type: "system",
    action: "budget.seeded",
    payload: summary("apply"),
  });
  if (error) fail(`activity_log: ${error.message}`);
}

const after = await counts();
const verification = await verify();

console.log(
  JSON.stringify(
    report("apply", {
      wrote: true,
      inserted: { categories: insertedCategories.length, items: toInsert.length, payments: 0 },
      skippedAsAlreadyPresent: skipped.length,
      idempotent:
        skipped.length > 0 && toInsert.length === 0
          ? `Budget already seeded (${after.categories} categories, ${after.items} items). Nothing inserted; nothing duplicated.`
          : null,
      countsBefore: before,
      countsAfter: after,
      categoryReconciliation: fixes,
      verification,
    }),
    null,
    1,
  ),
);
process.exit(verification.ok ? 0 : 1);
