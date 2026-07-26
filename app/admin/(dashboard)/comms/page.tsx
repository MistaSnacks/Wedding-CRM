import { defaultScope } from "@/lib/data/scope";
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
};

export default async function CommsPage() {
  const scope = defaultScope();
  const needReminder = await comms.needsReminder(scope);

  const { data: history } = await scope.db
    .from("communications")
    .select("id, type, channel, subject, sent_at, communication_recipients(status)")
    .eq("wedding_id", scope.weddingId)
    .order("sent_at", { ascending: false })
    .limit(20);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">Communications</h1>
        <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
          {needReminder.length} households could use a reminder (no RSVP, none sent in 7 days)
        </p>
      </div>

      <CampaignComposer />

      <div className="rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">History</h2>
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
