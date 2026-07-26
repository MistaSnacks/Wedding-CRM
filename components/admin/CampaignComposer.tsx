"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  reviewCampaign,
  sendCampaign,
  sendTestToMe,
  type CampaignReview,
} from "@/app/admin/(dashboard)/comms/actions";

const LOCALE_NAMES: Record<string, string> = { en: "English", es: "Spanish", vi: "Vietnamese" };

const inputCls =
  "rounded-lg border border-[#dddbd0] bg-white px-3 py-2.5 text-[13.5px] font-normal outline-none focus:border-olive";

export function CampaignComposer() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [review, setReview] = useState<CampaignReview | null>(null);
  const [previewLocale, setPreviewLocale] = useState("en");
  const [sent, setSent] = useState<number | null>(null);
  const [testSent, setTestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllSkipped, setShowAllSkipped] = useState(false);
  const [pending, startTransition] = useTransition();
  const [channel, setChannel] = useState<"email" | "manual">("email");

  // Any edit while a review is open makes the review stale.
  const invalidate = () => {
    setReview(null);
    setSent(null);
    setTestSent(false);
    setError(null);
    setShowAllSkipped(false);
  };

  const withForm = (fn: (fd: FormData) => Promise<void>) => () => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    if (review) fd.set("review_token", review.token);
    setError(null);
    startTransition(async () => {
      try {
        await fn(fd);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
        setReview(null);
      }
    });
  };

  const doReview = withForm(async (fd) => {
    const r = await reviewCampaign(fd);
    setReview(r);
    setPreviewLocale(r.previews[0]?.locale ?? "en");
  });

  const doTest = withForm(async (fd) => {
    await sendTestToMe(fd);
    setTestSent(true);
  });

  const doSend = withForm(async (fd) => {
    const count = review?.count ?? 0;
    await sendCampaign(fd);
    setSent(count);
    setReview(null);
    router.refresh();
  });

  const doLogOnly = withForm(async (fd) => {
    await sendCampaign(fd);
    setSent(0);
    router.refresh();
  });

  const activePreview = review?.previews.find((p) => p.locale === previewLocale) ?? review?.previews[0];
  const skippedShown = review && (showAllSkipped ? review.skippedNames : review.skippedNames.slice(0, 5));

  return (
    <form ref={formRef} onChange={invalidate} className="flex flex-col gap-3 rounded-xl border border-hairline p-5">
      <h2 className="text-[14.5px] font-semibold text-ink">Compose</h2>
      <div className="flex gap-2 max-md:flex-col">
        <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold tracking-wide text-[#6b7167]">
          TYPE
          <select name="type" className={inputCls}>
            <option value="reminder">RSVP reminder</option>
            <option value="invitation">Invitation (magic link + code)</option>
            <option value="save_the_date">Save the date</option>
            <option value="thank_you">Thank you</option>
            <option value="custom">Custom message</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold tracking-wide text-[#6b7167]">
          AUDIENCE
          <select name="audience" className={inputCls}>
            <option value="not_responded">Hasn&apos;t responded</option>
            <option value="all">Everyone</option>
            <option value="attending">Attending</option>
            <option value="declined">Declined</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold tracking-wide text-[#6b7167]">
          CHANNEL
          <select name="channel" className={inputCls} onChange={(e) => setChannel(e.target.value as "email" | "manual")}>
            <option value="email">Email</option>
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

      {error && (
        <p className="rounded-lg bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep">{error}</p>
      )}
      {sent !== null && (
        <p className="rounded-lg bg-sage-band px-3.5 py-2.5 text-[12.5px] text-olive-deep">
          {sent > 0 ? `Sent to ${sent} household${sent === 1 ? "" : "s"}.` : "Logged."}
        </p>
      )}

      {!review && (
        <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
          <p className="text-[12px] text-muted">
            Sent in each guest&apos;s language with their personal RSVP link.
          </p>
          <div className="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
            {channel === "email" && (
              <button
                type="button"
                onClick={doTest}
                disabled={pending}
                className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:opacity-50"
              >
                {testSent ? "Test sent — check your inbox" : "Send a test to me"}
              </button>
            )}
            {channel === "email" ? (
              <button
                type="button"
                onClick={doReview}
                disabled={pending}
                className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-50 motion-reduce:transition-none"
              >
                {pending ? "Looking…" : "Review campaign"}
              </button>
            ) : (
              <button
                type="button"
                onClick={doLogOnly}
                disabled={pending}
                className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose disabled:opacity-50 motion-reduce:transition-none"
              >
                Log it
              </button>
            )}
          </div>
        </div>
      )}

      {review && (
        <div className="flex flex-col gap-3 rounded-xl bg-paper p-4">
          <p className="text-[13.5px] text-ink">
            This will email <strong>{review.count}</strong> household{review.count === 1 ? "" : "s"}.
            {review.skippedNames.length > 0 && (
              <>
                {" "}
                <strong>{review.skippedNames.length}</strong> ha
                {review.skippedNames.length === 1 ? "s" : "ve"} no email address and will be skipped.
              </>
            )}
          </p>
          {skippedShown && skippedShown.length > 0 && (
            <p className="text-[12px] text-muted">
              Skipped: {skippedShown.join(", ")}
              {!showAllSkipped && review.skippedNames.length > 5 && (
                <>
                  {" "}
                  <button type="button" className="underline" onClick={() => setShowAllSkipped(true)}>
                    and {review.skippedNames.length - 5} more
                  </button>
                </>
              )}
            </p>
          )}

          {review.previews.length > 1 && (
            <div className="flex gap-1.5">
              {review.previews.map((p) => (
                <button
                  key={p.locale}
                  type="button"
                  onClick={() => setPreviewLocale(p.locale)}
                  className={`rounded-full px-3 py-1 text-[11.5px] font-medium ${
                    p.locale === (activePreview?.locale ?? "en")
                      ? "bg-olive-deep text-cream"
                      : "border border-[#dddbd0] text-[#4a5147]"
                  }`}
                >
                  {LOCALE_NAMES[p.locale] ?? p.locale}
                </button>
              ))}
            </div>
          )}
          {activePreview && (
            <div className="overflow-hidden rounded-lg border border-hairline bg-white">
              <p className="border-b border-hairline px-3.5 py-2 text-[12.5px] text-[#4a5147]">
                Subject: <strong>{activePreview.subject}</strong>
              </p>
              <iframe title="Email preview" srcDoc={activePreview.html} className="h-[360px] w-full" sandbox="" />
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={invalidate}
              disabled={pending}
              className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:opacity-50"
            >
              Back to editing
            </button>
            <button
              type="button"
              onClick={doSend}
              disabled={pending || review.count === 0}
              className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-50 motion-reduce:transition-none"
            >
              {pending ? "Sending…" : `Send to ${review.count} household${review.count === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
