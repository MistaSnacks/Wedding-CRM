"use client";

import { useState } from "react";
import type { ImportProblem } from "@/lib/csv";

/**
 * Errors and warnings as two separate, independently complete lists.
 *
 * The bug this replaces was a single `[...errors, ...warnings].slice(0, 8)`:
 * with 12 errors on the real sheet, every warning was unreachable — including
 * twelve "someone may be missing" warnings, each one a potentially absent
 * wedding guest. There is deliberately no cap here. Long lists scroll inside
 * their own box; scrolling is not truncation, and the header always states
 * the true total.
 */
export function ProblemList({
  errors,
  warnings,
  onDownload,
}: {
  errors: ImportProblem[];
  warnings: ImportProblem[];
  onDownload: (problems: ImportProblem[], filename: string) => void;
}) {
  if (errors.length === 0 && warnings.length === 0) return null;

  return (
    <div className="mt-6 flex flex-col gap-3">
      {errors.length > 0 && (
        <ProblemSection
          tone="error"
          problems={errors}
          title={`${errors.length} ${errors.length === 1 ? "row" : "rows"} can't be imported`}
          note="These rows are missing something we need, so they'll be left out. They aren't counted in the totals above — fix them in your spreadsheet and upload again to add them."
          downloadLabel={`Download ${errors.length === 1 ? "this row" : `these ${errors.length} rows`}`}
          downloadName="rows-to-fix.csv"
          onDownload={onDownload}
        />
      )}
      {warnings.length > 0 && (
        <ProblemSection
          tone="warning"
          problems={warnings}
          title={`${warnings.length} ${warnings.length === 1 ? "thing" : "things"} worth a look`}
          note="Nothing here blocks the import — these guests will all come through. They're just worth checking against your spreadsheet, in case someone was left off."
          downloadLabel={`Download ${warnings.length === 1 ? "this row" : `these ${warnings.length} rows`}`}
          downloadName="rows-to-check.csv"
          onDownload={onDownload}
        />
      )}
    </div>
  );
}

function ProblemSection({
  tone,
  problems,
  title,
  note,
  downloadLabel,
  downloadName,
  onDownload,
}: {
  tone: "error" | "warning";
  problems: ImportProblem[];
  title: string;
  note: string;
  downloadLabel: string;
  downloadName: string;
  onDownload: (problems: ImportProblem[], filename: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [downloaded, setDownloaded] = useState(false);

  const skin =
    tone === "error"
      ? {
          box: "border-blush-border bg-blush/60",
          heading: "text-rose-deep",
          rule: "border-blush-border",
          divide: "divide-[#f4e0dc]",
          name: "text-rose-deep",
          body: "text-[#7d5348]",
          row: "text-[#a58076]",
          button: "border-blush-border text-rose-deep hover:bg-white",
        }
      : {
          box: "border-[#e7dfc2] bg-[#fdf8e8]/70",
          heading: "text-[#6f5a15]",
          rule: "border-[#e7dfc2]",
          divide: "divide-[#efe6cd]",
          name: "text-[#6f5a15]",
          body: "text-[#7a6a3c]",
          row: "text-[#a3925f]",
          button: "border-[#e7dfc2] text-[#6f5a15] hover:bg-white",
        };

  return (
    <section className={`rounded-xl border ${skin.box}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Chevron open={open} className={skin.heading} />
        <span className={`text-[13.5px] font-semibold ${skin.heading}`}>{title}</span>
      </button>

      {open && (
        <div className={`border-t px-4 py-3.5 ${skin.rule}`}>
          <p className={`max-w-[68ch] text-[12.5px] leading-relaxed ${skin.body}`}>{note}</p>

          <ul
            className={`mt-3 max-h-72 divide-y overflow-y-auto rounded-lg bg-white/70 ${skin.divide}`}
          >
            {problems.map((p, i) => (
              <li
                key={`${p.line}-${i}`}
                className={`flex flex-wrap items-baseline gap-x-1.5 px-3 py-2 text-[12.5px] leading-relaxed ${skin.body}`}
              >
                <span className={`font-semibold ${skin.name}`}>{p.who}</span>
                {p.household && p.household !== p.who && (
                  <span className={skin.body}>in {p.household}</span>
                )}
                <span aria-hidden="true" className={skin.row}>
                  &mdash;
                </span>
                <span>{phrase(p)}</span>
                {p.line > 1 && (
                  <span className={`ml-auto pl-3 text-[11.5px] tabular-nums ${skin.row}`}>
                    row {p.line}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                onDownload(problems, downloadName);
                setDownloaded(true);
                window.setTimeout(() => setDownloaded(false), 4000);
              }}
              className={`rounded-lg border bg-white/60 px-3.5 py-2 text-[12.5px] font-medium transition-colors ${skin.button}`}
            >
              {downloadLabel}
            </button>
            {downloaded && (
              <span role="status" className={`text-[12.5px] ${skin.body}`}>
                Downloaded &mdash; check your Downloads folder.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Turns an engine message into a clause that reads on from the person's name.
 *
 * Presentation only — the engine's strings are untouched. Every rewrite below
 * keeps all of the original's information (counts, values, consequences); it
 * only removes the household name the engine repeats in quotes, which we have
 * already printed immediately to the left, and re-points the subject at the
 * invitation where the sentence would otherwise read as if the guest did it.
 */
function phrase(p: ImportProblem): string {
  const exact: Record<string, string> = {
    "Missing last name.": "no last name",
    "Missing first name.": "no first name",
    "Empty name — row skipped.": "no name in this row, so it was skipped",
    "Map both a First name and a Last name column.":
      "we couldn't tell which columns hold names",
  };
  if (exact[p.message]) return exact[p.message];

  // `"<invitation>" names N people but has only M rows — someone may be missing.`
  const envelope = p.message.match(
    /^".*" names (\d+) people but has only (\d+) rows? — someone may be missing\.$/,
  );
  if (envelope) {
    const named = Number(envelope[1]);
    const rows = Number(envelope[2]);
    return `this invitation is addressed to ${named} people but only ${rows} ${
      rows === 1 ? "guest is" : "guests are"
    } listed — someone may be missing`;
  }

  let text = p.message;
  // Drop a leading `"<household>"` / `"<household>":` we have already shown.
  text = text.replace(/^"[^"]*"\s*:?\s*/, "");
  return text.replace(/\.$/, "");
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${className ?? ""} transition-transform duration-200 motion-reduce:transition-none ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
