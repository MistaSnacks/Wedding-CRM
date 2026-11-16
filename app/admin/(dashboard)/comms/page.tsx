import { forWedding } from "@/lib/data/scope";
import { requireAdmin } from "@/lib/admin-auth";
import { AutomationSettings } from "@/components/admin/AutomationSettings";
import { reminderHtml } from "@/lib/email/send";
import { weddingFactsFor } from "@/lib/data/wedding-public";
import * as comms from "@/lib/data/comms";
import { CampaignComposer } from "@/components/admin/CampaignComposer";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  queued: "text-muted",
  sent: "text-[#7a6420]",
  delivered: "text-olive",
  opened: "text-olive-deep",
  bounced: "text-rose",
  failed: "text-rose",
  skipped: "text-muted",
  suppressed: "text-rose",
};

export default async function CommsPage() {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const needReminder = await comms.needsReminder(scope);

  const { data: history, error: historyError } = await scope.db
    .from("communications")
    .select("id, type, channel, subject, sent_at, communication_recipients(status)")
    .eq("wedding_id", scope.weddingId)
    .order("sent_at", { ascending: false })
    .limit(20);

  if(historyError)throw new Error(historyError.message);
  const [settings, issues, queued, automationRun, wedding] = await Promise.all([
    scope.db.from("automation_settings").select("*").eq("wedding_id",scope.weddingId).maybeSingle(),
    scope.db.from("email_outbox").select("id,recipient,state,last_error,household_id").eq("wedding_id",scope.weddingId).in("state",["failed","suppressed"]).is("resolved_at",null).order("created_at",{ascending:false}).limit(50),
    scope.db.from("email_outbox").select("id",{count:"exact",head:true}).eq("wedding_id",scope.weddingId).in("state",["pending","processing"]),
    scope.db.from("automation_runs").select("state,started_at,finished_at,error").eq("wedding_id",scope.weddingId).order("started_at",{ascending:false}).limit(1).maybeSingle(),
    // The previews show the real wedding day and reply-by date, not merge fields.
    weddingFactsFor(scope),
  ]);
  for(const r of [settings,issues,queued,automationRun])if(r.error)throw new Error(r.error.message);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">Emails to guests</h1>
        <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
          {needReminder.length} {needReminder.length === 1 ? "household has" : "households have"} not finished replying and got no email in the last 7 days
        </p>
      </div>

      {admin.role !== "viewer" && <CampaignComposer />}
      <AutomationSettings health={automationRun.data} settings={settings.data} issues={issues.data??[]} queued={queued.count??0} canEdit={admin.role!=="viewer"} previews={["en","es","vi"].map(locale=>({locale,html:reminderHtml({accessToken:"preview",locale,wedding}).html}))}/>

      <div className="rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Sent so far</h2>
        <div className="mt-2 flex flex-col">
          {(history ?? []).map((c) => {
            const recipients = (c.communication_recipients ?? []) as Array<{ status: string }>;
            const counts = recipients.reduce<Record<string, number>>((acc, r) => {
              acc[r.status] = (acc[r.status] ?? 0) + 1;
              return acc;
            }, {});
            return (
              <div key={c.id} className="flex items-center gap-4 border-t border-[#f1f0ea] py-3 first:border-0">
                <span className="w-40 text-[13px] font-semibold text-ink capitalize">{c.type.replace(/_/g, " ")}</span>
                <span className="w-20 text-[12px] text-muted">{c.channel}</span>
                <span className="flex-1 truncate text-[12.5px] text-[#4a5147]">{c.subject ?? "—"}</span>
                <span className="flex gap-2.5 text-[12px]">
                  {Object.entries(counts).map(([status, n]) => (
                    <span key={status} className={`font-medium ${STATUS_COLORS[status]}`}>
                      {n} {status}
                    </span>
                  ))}
                </span>
                <span className="w-24 text-right text-[12px] text-muted">
                  {c.sent_at ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(c.sent_at)) : ""}
                </span>
              </div>
            );
          })}
          {!history?.length && <p className="py-3 text-[13px] text-muted">Nothing sent yet.</p>}
        </div>
      </div>
    </div>
  );
}
