import Link from "next/link";
import { forWedding } from "@/lib/data/scope";
import { requireAdmin } from "@/lib/admin-auth";
import { listReadiness } from "@/lib/data/readiness";
import * as metrics from "@/lib/data/metrics";
import * as activity from "@/lib/data/activity";
import * as comms from "@/lib/data/comms";
import { MetricCards } from "@/components/admin/MetricCards";
import { RecentFeed } from "@/components/admin/RecentFeed";
import { groupAttention } from "@/lib/domain/attention-groups";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const [m, recent, needReminder, attention, started] = await Promise.all([
    metrics.overview(scope),
    activity.recentGuestActivity(scope, 8),
    comms.needsReminder(scope),
    listReadiness(scope),
    scope.db
      .from("households")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", scope.weddingId)
      .eq("rsvp_status", "started")
      .is("archived_at", null),
  ]);
  const todo = groupAttention(attention).filter((g) => !g.technical);
  // "Started" means some answers are in but not all: a guest said yes and has
  // not picked a meal yet. Saying "0 replied" while 24 guests are coming reads
  // as a broken page, so the header names the in-between state.
  const inProgress = started.count ?? 0;
  const notStarted = Math.max(0, m.householdsPending - inProgress);
  // Every dish for every event is a long list of zeros early on. Show what
  // guests picked; the Meals page has the full menu.
  const chosenMeals = m.mealCounts.filter((meal) => meal.count > 0);

  // Resolve household names for the feed
  const ids = [...new Set(recent.map((r) => r.household_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data } = await scope.db.from("households").select("id, display_name").eq("wedding_id", scope.weddingId).in("id", ids);
    for (const h of data ?? []) names[h.id] = h.display_name;
  }

  return (
    <div className="flex flex-col gap-6 max-md:gap-4">
      <div className="flex items-center gap-4 max-md:flex-wrap max-md:gap-2">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold text-ink">Overview</h1>
          <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
            {m.householdsResponded} of {m.householdsInvited} households have finished their reply
            {inProgress > 0 && ` · ${inProgress} started but not finished`}
            {` · ${notStarted} not started`}
          </p>
        </div>
        <Link
          href="/admin/reports"
          className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose"
        >
          Reports
        </Link>
        <Link
          href="/admin/comms"
          className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
        >
          Send a reminder ({needReminder.length})
        </Link>
      </div>

      <MetricCards m={m} />
      <section aria-labelledby="todo-title" className="rounded-xl border border-hairline bg-white/70 p-5">
        <div className="flex items-center gap-3">
          <h2 id="todo-title" className="flex-1 text-[14.5px] font-semibold text-ink">
            To do
          </h2>
          <Link href="/admin/attention" className="text-[12.5px] font-medium text-olive hover:text-rose">
            See everything
          </Link>
        </div>
        {todo.length ? (
          <ul className="mt-2 grid grid-cols-2 gap-x-6 max-md:grid-cols-1">
            {todo.map((group) => (
              <li key={group.kind}>
                <Link
                  href={`/admin/attention#${group.kind}`}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-sage-band"
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${group.urgent ? "bg-rose" : "bg-[#c9cdbd]"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                      {group.title}
                    </span>
                    <span className="block text-[13.5px] font-medium text-ink group-hover:text-olive-deep">
                      {group.summary}
                    </span>
                  </span>
                  <span aria-hidden className="text-muted group-hover:text-olive-deep">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">You are all caught up.</p>
        )}
      </section>

      <div className="flex items-start gap-4 max-md:flex-col">
        <div className="flex-[1.5] rounded-xl border border-hairline p-5 max-md:w-full">
          <div className="flex items-center pb-2.5">
            <h2 className="flex-1 text-[14.5px] font-semibold text-ink">Recent activity</h2>
            <Link href="/admin/guests" className="text-[12.5px] font-medium text-olive hover:text-rose">
              Guest list
            </Link>
          </div>
          <RecentFeed items={recent.map((r) => ({ ...r, householdName: r.household_id ? (names[r.household_id] ?? "—") : "—" }))} />
        </div>

        <div className="flex-1 rounded-xl border border-hairline p-5 max-md:w-full">
          <div className="flex items-center">
            <h2 className="flex-1 text-[14.5px] font-semibold text-ink">Meals chosen so far</h2>
            <Link href="/admin/meals" className="text-[12.5px] font-medium text-olive hover:text-rose">
              See meals
            </Link>
          </div>
          <div className="mt-3.5 flex flex-col gap-3.5">
            {chosenMeals.length === 0 && (
              <p className="text-[13px] text-muted">No guest has picked a meal yet.</p>
            )}
            {chosenMeals.map((meal) => {
              const max = Math.max(1, ...chosenMeals.map((x) => x.count));
              return (
                <div key={meal.name} className="flex items-center gap-3">
                  <span className="w-40 flex-shrink-0 text-[13px] font-medium text-ink">{meal.name}</span>
                  <span className="h-1.5 flex-1 rounded-full bg-[#f0efe3]">
                    <span
                      className="block h-1.5 rounded-full bg-olive transition-[width] duration-700"
                      style={{ width: `${(meal.count / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-7 flex-shrink-0 text-right text-[13px] font-semibold text-ink">{meal.count}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-[10px] bg-blush px-3.5 py-3">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-rose" />
            <span className="text-[12.5px] font-medium text-rose-deep">
              {m.dietaryCount} dietary {m.dietaryCount === 1 ? "note" : "notes"} · {m.accessibilityCount} accessibility{" "}
              {m.accessibilityCount === 1 ? "request" : "requests"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
