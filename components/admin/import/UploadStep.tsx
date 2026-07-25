"use client";

import { useRef, useState } from "react";

/**
 * Step 1 of the import. A real dropzone — not a file input styled as a
 * button — because the previous screen gave no signal that anything was
 * happening between "Choose CSV file" and a wall of dropdowns.
 *
 * Two things this component is responsible for and must never drop:
 *  - a visible drag-over state, so the drop target is obviously a target;
 *  - an explicit reading state, so the gap between picking a file and
 *    seeing guests is narrated rather than silent.
 */
export function UploadStep({
  onFile,
  reading,
  readingName,
  error,
}: {
  onFile: (file: File) => void;
  reading: boolean;
  readingName?: string;
  error?: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(file: File | undefined) {
    if (file) onFile(file);
  }

  return (
    <section className="rounded-2xl border border-hairline bg-white/60 p-6 sm:p-8">
      <h2 className="font-display text-[30px] leading-tight font-medium text-olive-deep">
        Upload your guest list
      </h2>
      <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-[#6b7167]">
        A spreadsheet from Excel, Google Sheets, or Numbers. We&rsquo;ll work out the columns
        &mdash; you don&rsquo;t need a template.
      </p>

      <div
        role="button"
        tabIndex={reading ? -1 : 0}
        aria-label="Choose a guest list file, or drop one here"
        aria-busy={reading}
        onClick={() => !reading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (reading) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!reading) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!reading) pick(e.dataTransfer.files?.[0]);
        }}
        className={[
          "group mt-5 flex min-h-[188px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-9 text-center transition-all duration-200 outline-none motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-rose/40",
          reading
            ? "cursor-progress border-[#c7cbbd] bg-paper"
            : dragging
              ? "-translate-y-px border-rose bg-blush shadow-[0_10px_24px_rgba(177,117,101,0.16)]"
              : "border-[#c9cdbf] bg-paper hover:border-rose hover:bg-white",
        ].join(" ")}
      >
        {reading ? (
          <>
            <Sheet className="text-olive animate-pulse" />
            <p className="text-[14px] font-medium text-olive-deep">
              Reading {readingName ? <span className="italic">{readingName}</span> : "your file"}&hellip;
            </p>
            <p className="text-[12.5px] text-[#6b7167]">
              Working out which column is which. This only takes a moment.
            </p>
          </>
        ) : (
          <>
            <Sheet className="text-[#9aa38f] transition-colors duration-200 group-hover:text-rose motion-reduce:transition-none" />
            <p className="text-[14.5px] font-medium text-ink">
              Drop your spreadsheet here, or{" "}
              <span className="text-rose underline decoration-rose/40 underline-offset-4">
                choose a file
              </span>
            </p>
            <p className="text-[12px] tracking-wide text-muted">CSV or Excel (.csv, .xlsx)</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            // Let the same file be chosen twice in a row after a failure.
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[13px] leading-relaxed text-rose-deep"
        >
          {error}
        </p>
      )}

      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
        Nothing is saved until you say so. You&rsquo;ll see every guest we found before anything
        is imported.
      </p>
    </section>
  );
}

function Sheet({ className }: { className?: string }) {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 12.5h7M8.5 16h7" />
    </svg>
  );
}
