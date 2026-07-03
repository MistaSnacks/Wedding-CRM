import Link from "next/link";
import { defaultScope } from "@/lib/data/scope";
import * as metrics from "@/lib/data/metrics";
import * as activity from "@/lib/data/activity";
import * as comms from "@/lib/data/comms";
import { MetricCards } from "@/components/admin/MetricCards";
import { RecentFeed } from "@/components/admin/RecentFeed";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const scope = defaultScope();
  const [m, recent, needReminder] = await Promise.all([
    metrics.overview(scope),
    activity.recent(scope, 8),
    comms.needsReminder(scope),
  ]);

  // Resolve household names for the feed
  const ids = [...new Set(recent.map((r) => r.household_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data } = await scope.db.from("households").select("id, display_name").in("id", ids);
    for (const h of data ?? []) names[h.id] = h.display_name;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold text-ink">Overview</h1>
          <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
            {m.householdsPending} households still pending
          </p>
        </div>
        <Link
          href="/admin/imports"
          className="rounded-lg border border-[#dddbd0] bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose"
        >
          Export
        </Link>
        <Link
          href="/admin/comms"
          className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
        >
          Send reminders ({needReminder.length})
        </Link>
      </div>

      <MetricCards m={m} />

      <div className="flex items-start gap-4">
        <div className="flex-[1.5] rounded-xl border border-hairline p-5">
          <div className="flex items-center pb-2.5">
            <h2 className="flex-1 text-[14.5px] font-semibold text-ink">Recent RSVPs</h2>
            <Link href="/admin/guests" className="text-[12.5px] font-medium text-olive hover:text-rose">
              View all
            </Link>
          </div>
          <RecentFeed items={recent.map((r) => ({ ...r, householdName: r.household_id ? (names[r.household_id] ?? "—") : "—" }))} />
        </div>

        <div className="flex-1 rounded-xl border border-hairline p-5">
          <div className="flex items-center">
            <h2 className="flex-1 text-[14.5px] font-semibold text-ink">Meal counts</h2>
            <Link href="/admin/meals" className="text-[12.5px] font-medium text-olive hover:text-rose">
              Caterer export
            </Link>
          </div>
          <div className="mt-3.5 flex flex-col gap-3.5">
            {m.mealCounts.map((meal) => {
              const max = Math.max(1, ...m.mealCounts.map((x) => x.count));
              return (
                <div key={meal.name} className="flex items-center gap-3">
                  <span className="w-[82px] flex-shrink-0 text-[13px] font-medium text-ink">{meal.name}</span>
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
              {m.dietaryCount} dietary restrictions · {m.accessibilityCount} accessibility requests
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
