import { defaultScope } from "@/lib/data/scope";
import * as comms from "@/lib/data/comms";
import { sendCampaign } from "./actions";

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

      <form action={sendCampaign} className="flex flex-col gap-3 rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Compose</h2>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold tracking-wide text-[#6b7167]">
            TYPE
            <select name="type" className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2.5 text-[13.5px] font-normal">
              <option value="reminder">RSVP reminder</option>
              <option value="invitation">Invitation (magic link + code)</option>
              <option value="save_the_date">Save the date</option>
              <option value="thank_you">Thank you</option>
              <option value="custom">Custom message</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold tracking-wide text-[#6b7167]">
            AUDIENCE
            <select name="audience" className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2.5 text-[13.5px] font-normal">
              <option value="not_responded">Hasn&apos;t responded</option>
              <option value="all">Everyone</option>
              <option value="attending">Attending</option>
              <option value="declined">Declined</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold tracking-wide text-[#6b7167]">
            CHANNEL
            <select name="channel" className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2.5 text-[13.5px] font-normal">
              <option value="email">Email (Resend)</option>
              <option value="manual">Log only (paper / offline send)</option>
            </select>
          </label>
        </div>
        <input
          name="subject"
          placeholder="Subject (custom messages — templates localize automatically)"
          className="rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive"
        />
        <textarea
          name="body"
          rows={3}
          placeholder="Body (custom messages only)"
          className="rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive"
        />
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-muted">
            Templates send in each household&apos;s language (EN/ES/VI) with their magic link. Delivery tracked via webhooks.
          </p>
          <button className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none">
            Send campaign
          </button>
        </div>
      </form>

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
