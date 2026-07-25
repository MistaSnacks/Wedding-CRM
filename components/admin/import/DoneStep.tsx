"use client";

import Link from "next/link";
import type { ImportProblem } from "@/lib/csv";

/**
 * The import is not the goal — inviting people is. This step ends on two real
 * destinations rather than a green confirmation box that leaves the user on
 * the same screen wondering what just happened.
 */
export function DoneStep({
  households,
  guests,
  skipped,
  onDownloadSkipped,
  onImportAnother,
}: {
  households: number;
  guests: number;
  skipped: ImportProblem[];
  onDownloadSkipped: (problems: ImportProblem[], filename: string) => void;
  onImportAnother: () => void;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-white/60 p-6 sm:p-8">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-olive uppercase">Imported</p>
      <h2 className="font-display mt-1.5 text-[32px] leading-tight font-medium text-olive-deep sm:text-[38px]">
        Your guest list is ready
      </h2>

      <p className="mt-3 rounded-xl bg-sage-band px-4 py-3 text-[15px] font-medium text-olive-deep tabular-nums">
        {households.toLocaleString()} {households === 1 ? "invitation" : "invitations"} ·{" "}
        {guests.toLocaleString()} {guests === 1 ? "guest" : "guests"}
      </p>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[#6b7167]">
        Every invitation now has its own invite code and RSVP link, generated automatically.
      </p>

      {skipped.length > 0 && (
        <div className="mt-4 rounded-xl border border-blush-border bg-blush/60 px-4 py-3">
          <p className="text-[13px] leading-relaxed text-rose-deep">
            {skipped.length} {skipped.length === 1 ? "row was" : "rows were"} skipped and{" "}
            {skipped.length === 1 ? "is" : "are"} not in the numbers above.
          </p>
          <button
            type="button"
            onClick={() => onDownloadSkipped(skipped, "skipped-rows.csv")}
            className="mt-2 rounded-lg border border-blush-border bg-white/60 px-3.5 py-2 text-[12.5px] font-medium text-rose-deep transition-colors hover:bg-white"
          >
            Download {skipped.length === 1 ? "it" : "them"} to fix and re-upload
          </button>
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/guests"
          className="rounded-lg bg-olive-deep px-6 py-3 text-[14px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] motion-reduce:transition-none"
        >
          View guest list
        </Link>
        <Link
          href="/admin/comms"
          className="rounded-lg border border-[#dddbd0] px-6 py-3 text-[14px] font-medium text-ink transition-colors hover:border-rose hover:text-rose motion-reduce:transition-none"
        >
          Send invitations
        </Link>
        <button
          type="button"
          onClick={onImportAnother}
          className="text-[12.5px] text-[#6b7167] underline decoration-[#c9cdbf] underline-offset-4 transition-colors hover:text-rose hover:decoration-rose motion-reduce:transition-none"
        >
          Import another file
        </button>
      </div>
    </section>
  );
}
