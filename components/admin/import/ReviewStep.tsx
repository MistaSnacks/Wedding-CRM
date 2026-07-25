"use client";

import type { ReactNode } from "react";
import type { ImportProblem, ImportSummary } from "@/lib/csv";
import { ProblemList } from "./ProblemList";

/**
 * The heart of the redesign: what we found, in her words, before any control.
 *
 * The old screen opened with 21 dropdowns and closed with a truncated list of
 * line numbers. This one opens with her guests by name. The column matches are
 * still here — passed in as `columnMatches` and rendered last, behind a quiet
 * link — but they are now the escape hatch, not the path.
 */
export function ReviewStep({
  summary,
  filename,
  importing,
  needsColumns,
  commitErrors,
  onImport,
  onStartOver,
  onDownloadProblems,
  columnMatches,
}: {
  summary: ImportSummary;
  filename: string;
  importing: boolean;
  /** True when no first/last name column could be matched — nothing can be counted yet. */
  needsColumns: boolean;
  commitErrors?: Array<{ line: number; message: string }> | null;
  onImport: () => void;
  onStartOver: () => void;
  onDownloadProblems: (problems: ImportProblem[], filename: string) => void;
  columnMatches: ReactNode;
}) {
  const { invitations, namedGuests, unnamedSeats, extras, problems, preview } = summary;

  return (
    <section className="rounded-2xl border border-hairline bg-white/60 p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#9aa38f] uppercase">
          From {filename || "your spreadsheet"}
        </p>
        <button
          type="button"
          onClick={onStartOver}
          disabled={importing}
          className="text-[12px] text-[#6b7167] underline decoration-[#c9cdbf] underline-offset-4 transition-colors hover:text-rose hover:decoration-rose disabled:opacity-50 motion-reduce:transition-none"
        >
          Use a different file
        </button>
      </div>

      {needsColumns ? (
        <>
          <h2 className="font-display mt-2 max-w-[20ch] text-[30px] leading-[1.15] font-medium text-olive-deep">
            We couldn&rsquo;t tell which columns hold names
          </h2>
          <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed text-[#4a5147]">
            Your spreadsheet came through fine, but we need to know which column holds first
            names and which holds last names before we can show you your guests. Point us at
            them below and everything else will fill in.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-display mt-2 max-w-[22ch] text-[32px] leading-[1.15] font-medium text-olive-deep sm:text-[38px]">
            We found{" "}
            <span className="text-ink tabular-nums">{namedGuests.toLocaleString()} guests</span> in{" "}
            <span className="text-ink tabular-nums">{invitations.toLocaleString()} invitations</span>
          </h2>
          <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-[#4a5147]">
            Guests who share an envelope are grouped into one invitation with one RSVP link.
            {/* One expression, not text interleaved with `{...}`: this
                toolchain drops the leading space of a JSX text node that wraps
                onto a second line, which silently shipped "seats areheld". */}
            {unnamedSeats > 0 &&
              ` ${unnamedSeats} more ${
                unnamedSeats === 1 ? "seat is" : "seats are"
              } held for plus-ones you haven’t named yet.`}
          </p>

          {extras.length > 0 && (
            <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-[#6b7167]">
              Also picked up:{" "}
              {extras.map((e, i) => (
                <span key={e.label}>
                  {i > 0 && <span className="text-[#c9cdbf]"> · </span>}
                  <span className="font-medium text-ink">{e.label}</span> for {e.count}
                </span>
              ))}
            </p>
          )}

          <HouseholdPreview preview={preview} />

          <ProblemList
            errors={problems.errors}
            warnings={problems.warnings}
            onDownload={onDownloadProblems}
          />
        </>
      )}

      {commitErrors && commitErrors.length > 0 && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-blush-border bg-blush px-4 py-3 text-[13px] leading-relaxed text-rose-deep"
        >
          <p className="font-semibold">Nothing was imported.</p>
          {commitErrors.map((e, i) => (
            <p key={i} className="mt-1">
              {e.line > 1 ? `Row ${e.line}: ` : ""}
              {e.message}
            </p>
          ))}
          <p className="mt-1.5 text-[12.5px] text-[#7d5348]">
            Your guest list is unchanged. You can fix the file and try again.
          </p>
        </div>
      )}

      {!needsColumns && (
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onImport}
            disabled={importing || namedGuests === 0}
            className="rounded-lg bg-olive-deep px-6 py-3 text-[14px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          >
            {importing
              ? "Importing…"
              : `Import ${namedGuests.toLocaleString()} ${namedGuests === 1 ? "guest" : "guests"}`}
          </button>
          {problems.errors.length > 0 && (
            <p className="max-w-[44ch] text-[12.5px] leading-relaxed text-[#6b7167]">
              {`${problems.errors.length === 1 ? "That row" : `Those ${problems.errors.length} rows`} won’t be included. Fixing ${
                problems.errors.length === 1 ? "it" : "them"
              } in your spreadsheet and uploading again brings everyone in at once — if you import now, you’ll need to add ${
                problems.errors.length === 1 ? "that guest" : "those guests"
              } by hand afterwards, because uploading the same file twice would duplicate the rest.`}
            </p>
          )}
        </div>
      )}

      {columnMatches}
    </section>
  );
}

/**
 * Household cards, not a data grid. Juliet recognises "The Smith Family —
 * John, Sarah, Emma"; she does not read a HOUSEHOLD / GUESTS / EMAIL / RULES
 * table. The list scrolls rather than paginating, so the whole import is
 * present and skimmable.
 */
function HouseholdPreview({ preview }: { preview: ImportSummary["preview"] }) {
  if (preview.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-[#6b7167] uppercase">
        Your invitations
      </p>
      <div className="mt-2 max-h-[380px] overflow-y-auto rounded-xl border border-hairline bg-paper/70">
        <ul className="divide-y divide-[#f1f0ea]">
          {preview.map((h, i) => (
            <li key={`${h.displayName}-${i}`} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5">
              <span className="font-display text-[16px] font-medium text-olive-deep">
                {h.displayName}
              </span>
              {h.guests.length > 0 && (
                <span className="text-[12.5px] text-[#4a5147]">
                  <span className="text-[#c9cdbf]">&mdash;</span> {h.guests.join(", ")}
                </span>
              )}
              <span className="ml-auto pl-3 text-[11.5px] whitespace-nowrap text-[#8a8f86] tabular-nums">
                {h.seats} {h.seats === 1 ? "seat" : "seats"}
                {h.unnamed > 0 && (
                  <span className="text-rose"> · {h.unnamed} unnamed</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        {preview.length.toLocaleString()} {preview.length === 1 ? "invitation" : "invitations"},
        all shown &mdash; scroll to read them.
      </p>
    </div>
  );
}
