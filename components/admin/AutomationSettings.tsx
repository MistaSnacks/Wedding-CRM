"use client";
import { useState, useTransition } from "react";
import {
  saveAutomationSettings,
  resumeDelivery,
  retryFailedDelivery,
} from "@/app/admin/(dashboard)/comms/automation-actions";

export type Settings = {
  reminders_enabled: boolean;
  digest_enabled: boolean;
  payment_reminders_enabled: boolean;
  recipient_email: string | null;
  reminder_start_date: string | null;
  reminder_weekday: number;
  reminder_cap: number;
  digest_cadence: string;
};
export type DeliveryIssue = {
  id: string;
  recipient: string;
  state: string;
  last_error: string | null;
  household_id: string | null;
};
type Health = { state: string; started_at: string; finished_at: string | null; error: string | null } | null;

const LANGUAGE: Record<string, string> = { en: "English", es: "Spanish", vi: "Vietnamese" };
const field =
  "rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13.5px] text-ink outline-none transition-colors focus:border-olive disabled:opacity-60";

/** Whether the background sender is alive, in words a planner can act on. */
function senderStatus(health: Health | undefined): { ok: boolean; text: string } {
  if (!health)
    return {
      ok: false,
      text: "Automatic sending has not started yet. Emails you send still go out, but they may wait until you press “Send waiting emails now”.",
    };
  const stuck = health.state === "running" && Date.now() - new Date(health.started_at).getTime() > 300_000;
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(health.started_at),
  );
  if (health.state === "failed" || stuck)
    return { ok: false, text: `Automatic sending had a problem at its last check (${when}). Tell whoever set up the site.` };
  return { ok: true, text: `Automatic sending is working. Last check: ${when}.` };
}

function Toggle({
  name,
  title,
  children,
  defaultChecked,
}: {
  name: string;
  title: string;
  children: React.ReactNode;
  defaultChecked: boolean;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-white/60 p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#3b4823]" />
        <span className="text-[14px] font-semibold text-ink">{title}</span>
      </label>
      <div className="mt-1.5 pl-[30px] text-[13px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export function AutomationSettings({
  settings,
  issues,
  queued,
  canEdit,
  previews,
  health,
}: {
  health?: Health;
  settings: Settings | null;
  issues: DeliveryIssue[];
  queued: number;
  canEdit: boolean;
  previews: Array<{ locale: string; html: string }>;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ message: string }>) =>
    start(async () => {
      try {
        setMessage((await fn()).message);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "That could not be saved. Try again.");
      }
    });
  const status = senderStatus(health);
  const anyOn = Boolean(settings?.reminders_enabled || settings?.digest_enabled || settings?.payment_reminders_enabled);

  return (
    <>
      <section id="automations" aria-labelledby="auto-title" className="rounded-2xl border border-hairline bg-white/75 p-5 max-md:p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="auto-title" className="text-[14.5px] font-semibold text-ink">
            Emails that send themselves
          </h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
              anyOn ? "bg-sage-band text-olive-deep" : "bg-[#f0efe3] text-muted"
            }`}
          >
            {anyOn ? "On" : "All off"}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
          Optional. Nothing here sends until you tick a box, tick the confirmation at the bottom, and save.
        </p>

        <form action={(fd) => run(() => saveAutomationSettings(fd))} className="mt-4">
          <fieldset disabled={!canEdit || pending} className="flex flex-col gap-3">
            <Toggle name="reminders_enabled" title="Remind guests who have not replied" defaultChecked={settings?.reminders_enabled ?? false}>
              <p>
                Goes once a week to households with an unfinished reply, in their own language, with their personal RSVP
                link. It stops when they reply or when replies close. Addresses that bounced are skipped.
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-ink">
                <label className="flex flex-col gap-1 text-[12.5px] font-medium">
                  First reminder on
                  <input type="date" name="reminder_start_date" defaultValue={settings?.reminder_start_date ?? ""} className={field} />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] font-medium">
                  Then every
                  <select name="reminder_weekday" defaultValue={settings?.reminder_weekday ?? 1} className={`${field} admin-field`}>
                    {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] font-medium">
                  At most this many per household
                  <input type="number" name="reminder_cap" min="1" max="10" defaultValue={settings?.reminder_cap ?? 3} className={`${field} w-24`} />
                </label>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] font-medium text-olive-deep underline-offset-2 hover:underline">
                  See the reminder email guests get
                </summary>
                <p className="mt-2">The button in these previews is a sample and does not open a real RSVP.</p>
                <div className="mt-2 grid gap-3 lg:grid-cols-3">
                  {previews.map((p) => (
                    <figure key={p.locale}>
                      <figcaption className="mb-1 text-[12px] font-semibold text-ink">{LANGUAGE[p.locale] ?? p.locale}</figcaption>
                      <iframe
                        title={`Reminder email in ${LANGUAGE[p.locale] ?? p.locale}`}
                        srcDoc={p.html}
                        sandbox=""
                        className="h-80 w-full rounded-lg border border-hairline bg-white"
                      />
                    </figure>
                  ))}
                </div>
              </details>
            </Toggle>

            <Toggle name="digest_enabled" title="Email me a summary when something changes" defaultChecked={settings?.digest_enabled ?? false}>
              <p>A short private note with new replies, missing meals and what needs you. No guest notes are included.</p>
              <label className="mt-3 flex w-fit flex-col gap-1 text-[12.5px] font-medium text-ink">
                How often
                <select name="digest_cadence" defaultValue={settings?.digest_cadence ?? "daily"} className={`${field} admin-field`}>
                  <option value="daily">Every day there is news</option>
                  <option value="weekly">Mondays only</option>
                </select>
              </label>
            </Toggle>

            <Toggle
              name="payment_reminders_enabled"
              title="Email me before a vendor payment is due"
              defaultChecked={settings?.payment_reminders_enabled ?? false}
            >
              <p>
                One week before, one day before, and once if it becomes overdue. It only reminds you; it never pays
                anything.
              </p>
            </Toggle>

            <label className="flex max-w-md flex-col gap-1 text-[12.5px] font-medium text-ink">
              Send my summaries and payment reminders to
              <input
                type="email"
                name="recipient_email"
                placeholder="you@example.com"
                defaultValue={settings?.recipient_email ?? ""}
                className={field}
              />
            </label>

            <label className="flex items-start gap-2.5 rounded-xl bg-paper p-3 text-[13px] text-ink">
              <input type="checkbox" name="reviewed" className="mt-0.5 h-4 w-4 shrink-0 accent-[#3b4823]" />
              I looked at the previews and the schedule above, and I want the ticked emails to start sending.
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={pending}
                className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-colors hover:bg-olive-deeper disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              {!canEdit && <span className="text-[13px] text-muted">Your access is view-only.</span>}
              {message && (
                <p role="status" className="text-[13px] font-medium text-olive-deep">
                  {message}
                </p>
              )}
            </div>
          </fieldset>
        </form>
      </section>

      <section aria-labelledby="delivery-title" className="rounded-2xl border border-hairline bg-white/75 p-5 max-md:p-4">
        <h2 id="delivery-title" className="text-[14.5px] font-semibold text-ink">
          Delivery
        </h2>
        <p className={`mt-1 flex items-start gap-2 text-[13px] ${status.ok ? "text-muted" : "text-rose-deep"}`}>
          <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${status.ok ? "bg-olive" : "bg-rose"}`} />
          {status.text}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-[13.5px] text-ink">
            {queued === 0
              ? "No emails are waiting to go out."
              : `${queued} ${queued === 1 ? "email is" : "emails are"} waiting to go out.`}
          </p>
          {canEdit && (queued > 0 || !status.ok) && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(resumeDelivery)}
              className="rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-olive hover:text-olive-deep disabled:opacity-50"
            >
              Send waiting emails now
            </button>
          )}
        </div>

        <h3 className="mt-5 text-[13.5px] font-semibold text-ink">Emails that did not arrive</h3>
        {!issues.length && <p className="mt-1 text-[13px] text-muted">None. Every email reached its inbox.</p>}
        <ul className="divide-y divide-hairline">
          {issues.map((i) => (
            <li key={i.id} className="py-3 text-[13px]">
              <p className="font-medium text-ink">
                {i.recipient}
                <span className="ml-2 font-normal text-rose-deep">
                  {i.state === "suppressed" ? "blocked: this address bounced or complained before" : "could not be delivered"}
                </span>
              </p>
              {i.last_error && <p className="mt-0.5 text-muted">{i.last_error}</p>}
              {i.household_id && (
                <a className="mt-1 inline-block font-medium text-olive-deep underline underline-offset-2" href={`/admin/guests/${i.household_id}`}>
                  Fix this household’s email address
                </a>
              )}
              {canEdit && (
                <form action={(fd) => run(() => retryFailedDelivery(fd))} className="mt-2 flex flex-wrap items-center gap-3">
                  <input type="hidden" name="id" value={i.id} />
                  <label className="flex items-start gap-2 text-muted">
                    <input type="checkbox" name="confirmed" required className="mt-0.5 h-4 w-4 shrink-0 accent-[#3b4823]" />
                    The address is right now and this person still wants the email.
                  </label>
                  <button
                    disabled={pending}
                    className="rounded-lg border border-[#dddbd0] bg-white px-3 py-1.5 font-medium text-ink transition-colors hover:border-olive disabled:opacity-50"
                  >
                    Send it again
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
