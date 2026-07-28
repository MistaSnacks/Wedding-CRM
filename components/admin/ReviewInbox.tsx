"use client";

import { useState, useTransition } from "react";
import {
  createHouseholdFrom,
  ignoreSubmission,
  matchToHousehold,
  syncNow,
  undoSubmission,
  type ActionResult,
} from "@/app/admin/(dashboard)/imports/review-actions";

export type InboxCandidate = {
  householdId: string;
  householdName: string;
  guestName: string;
  score: number;
  reasons: string[];
};

export type InboxItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  receivedAt: string;
  optOut: boolean;
  multiPerson: boolean;
  candidates: InboxCandidate[];
};

export type AppliedItem = {
  id: string;
  name: string;
  householdName: string;
  fields: string[];
  status: "matched" | "created";
};

const FIELD_NAMES: Record<string, string> = {
  email: "an email address",
  phone: "a phone number",
  mailing_address: "an address",
  preferred_locale: "a language preference",
  internal_notes: "a note",
  rsvp_status: "their reply",
};

export function ReviewInbox(props: {
  items: InboxItem[];
  applied: AppliedItem[];
  connected: boolean;
  canEdit: boolean;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setFlash(await fn());
    });

  const visible = props.items.filter((i) => !skipped.has(i.id));

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-hairline p-5 max-md:p-4">
      <div className="flex items-start gap-3 max-md:flex-col">
        <div className="flex-1">
          <h2 className="text-[15px] font-semibold text-ink">Save-the-Date responses</h2>
          <p className="mt-0.5 text-[13px] text-[#6b7167]">
            {visible.length
              ? `${visible.length} response${visible.length === 1 ? "" : "s"} need${visible.length === 1 ? "s" : ""} a decision. One at a time — there's no bulk approve here on purpose.`
              : "Every response has been dealt with."}
          </p>
        </div>
        {props.canEdit && props.connected && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(syncNow)}
            className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:opacity-50"
          >
            {pending ? "Checking…" : "Check for new responses"}
          </button>
        )}
      </div>

      {!props.connected && (
        <p className="rounded-lg bg-blush px-3.5 py-2.5 text-[12.5px] leading-relaxed text-rose-deep">
          Not connected to the Save-the-Date sheet yet, so new responses won&apos;t arrive on their own.
          Anything already here is still yours to review.
        </p>
      )}

      {flash && (
        <p
          className={`rounded-lg px-3.5 py-2.5 text-[12.5px] ${
            flash.ok ? "bg-sage-band text-olive-deep" : "bg-blush text-rose-deep"
          }`}
        >
          {flash.message}
        </p>
      )}

      {visible.map((item) => (
        <article key={item.id} className="flex flex-col gap-3 rounded-xl bg-paper p-4">
          <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold text-ink">
                {item.name || "(no name given)"}
                {item.optOut && (
                  <span className="ml-2 rounded-full bg-blush px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-rose">
                    opted out
                  </span>
                )}
                {item.multiPerson && (
                  <span className="ml-2 rounded-full bg-[#f3edd8] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[#7a6420]">
                    two people
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[12.5px] text-[#4a5147]">
                {[item.email, item.phone].filter(Boolean).join(" · ") || "No contact details given"}
              </p>
              {item.address && (
                <p className="mt-0.5 whitespace-pre-line text-[12.5px] text-[#4a5147]">{item.address}</p>
              )}
              {item.notes && <p className="mt-1 text-[12.5px] italic text-[#6b7167]">“{item.notes}”</p>}
            </div>
            <span className="shrink-0 text-[11.5px] text-muted">{item.receivedAt}</span>
          </div>

          {item.candidates.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]">
                {item.candidates.length === 1 ? "POSSIBLE MATCH" : "POSSIBLE MATCHES"}
              </p>
              {item.candidates.map((c) => (
                <div
                  key={c.householdId + c.guestName}
                  className="flex items-start gap-3 rounded-lg bg-white px-3.5 py-2.5 max-md:flex-col max-md:gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-ink">{c.householdName}</p>
                    <p className="text-[12px] text-[#4a5147]">
                      matched on {c.guestName}
                      {c.reasons.length > 0 && ` — ${c.reasons.join("; ")}`}
                    </p>
                  </div>
                  {props.canEdit && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => matchToHousehold(item.id, c.householdId))}
                      className="shrink-0 rounded-lg bg-olive-deep px-3.5 py-2 text-[12.5px] font-semibold text-cream transition-colors hover:bg-rose disabled:opacity-50 max-md:w-full"
                    >
                      This is them
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : item.name || item.email || item.phone || item.address ? (
            <p className="text-[12.5px] text-muted">
              Nobody on the guest list looks like this person.
            </p>
          ) : (
            <p className="text-[12.5px] text-muted">
              This row was blank in the sheet — there&apos;s nothing to match on.
            </p>
          )}

          {props.canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => createHouseholdFrom(item.id))}
                className="rounded-lg border border-[#dddbd0] px-3.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:opacity-50"
              >
                Add as someone new
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => ignoreSubmission(item.id))}
                className="rounded-lg border border-[#dddbd0] px-3.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:opacity-50"
              >
                Not a guest
              </button>
              <button
                type="button"
                onClick={() => setSkipped((s) => new Set(s).add(item.id))}
                className="rounded-lg px-3.5 py-2 text-[12.5px] font-medium text-muted hover:text-rose"
              >
                Skip for now
              </button>
            </div>
          )}
        </article>
      ))}

      {props.applied.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-[#f1f0ea] pt-4">
          <p className="text-[11.5px] font-semibold tracking-[0.09em] text-[#6b7167]">RECENTLY APPLIED</p>
          {props.applied.map((a) => (
            <div key={a.id} className="flex items-center gap-3 text-[12.5px] max-md:flex-col max-md:items-start max-md:gap-1">
              <span className="min-w-0 flex-1 text-[#4a5147]">
                {a.status === "created" ? (
                  <>Added <strong className="font-semibold text-ink">{a.householdName}</strong> from {a.name}&apos;s response.</>
                ) : a.fields.length ? (
                  <>
                    Added {a.fields.map((f) => FIELD_NAMES[f] ?? f).join(", ")} to{" "}
                    <strong className="font-semibold text-ink">{a.householdName}</strong> from {a.name}&apos;s response.
                  </>
                ) : (
                  <>Matched {a.name} to <strong className="font-semibold text-ink">{a.householdName}</strong> — nothing needed changing.</>
                )}
              </span>
              {props.canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => undoSubmission(a.id))}
                  className="shrink-0 font-medium text-rose hover:underline disabled:opacity-50"
                >
                  Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
