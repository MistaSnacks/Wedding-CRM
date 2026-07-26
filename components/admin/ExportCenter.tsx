"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The export center: a format toggle and a grouped list of reports.
 *
 * Replaces the chip wall (12 reports x 2 formats = 24 targets, "XLSX" twelve
 * times) with one Excel/CSV choice and one row per report, each carrying a
 * plain-English description of what's inside. Excel is the default because it
 * opens cleanly for non-technical users; CSV stays one toggle away.
 *
 * The download feedback is inherited from the old ExportLinks and is *earned*,
 * not guessed on a timer: each anchor carries a one-time `dl` token, the export
 * route echoes it back in a short-lived non-HttpOnly cookie on the download
 * response itself, and we poll until our own token comes back. Rows are real
 * anchors — right-click -> Save link as, middle-click, keyboard activation and
 * no-JS all work; with JS off the server-rendered hrefs say format=xlsx, so the
 * fallback matches the Excel default.
 */

const COOKIE = "export_download";
const POLL_MS = 150;
const GIVE_UP_MS = 20_000;
const CLEAR_AFTER_MS = 5_000;

type Status = "pending" | "done" | "slow";
type Format = "csv" | "xlsx";

export type ExportReport = {
  key: string;
  label: string;
  description: string;
  group: string;
};

function newToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function readCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)export_download=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function clearCookie(): void {
  document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function hrefFor(report: string, format: Format, token: string | undefined): string {
  const params = new URLSearchParams();
  if (format === "xlsx") params.set("format", "xlsx");
  if (token) params.set("dl", token);
  const query = params.toString();
  return `/api/export/${report}${query ? `?${query}` : ""}`;
}

export function ExportCenter({ reports }: { reports: ExportReport[] }) {
  const [format, setFormat] = useState<Format>("xlsx");
  // Tokens are generated after mount, never during render: a random value in
  // the server-rendered HTML would be a hydration mismatch. Until they arrive
  // the hrefs are the plain URLs, which is the correct no-JS behaviour anyway.
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [announcement, setAnnouncement] = useState("");
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const r of reports) seeded[r.key] = newToken();
    setTokens(seeded);
  }, [reports]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const handle = setTimeout(() => {
      timers.current.delete(handle);
      fn();
    }, ms);
    timers.current.add(handle);
  }, []);

  const onDownload = useCallback(
    (key: string, label: string) => {
      const token = tokens[key];
      if (!token) return; // Pre-hydration click: let the plain link do its job.

      clearCookie();
      setStatus((s) => ({ ...s, [key]: "pending" }));
      setAnnouncement(`Preparing ${label}…`);
      const asWhat = format === "xlsx" ? "an Excel file" : "a CSV file";

      const startedAt = Date.now();
      const poll = () => {
        if (readCookie() === token) {
          clearCookie();
          setStatus((s) => ({ ...s, [key]: "done" }));
          setAnnouncement(`${label} downloaded as ${asWhat}. Check your Downloads folder.`);
          // A fresh token, so clicking the same report again is a new round
          // trip rather than an instant false "downloaded" from the old cookie.
          setTokens((t) => ({ ...t, [key]: newToken() }));
          later(() => {
            setStatus((s) => {
              if (s[key] !== "done") return s;
              const next = { ...s };
              delete next[key];
              return next;
            });
          }, CLEAR_AFTER_MS);
          return;
        }
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setStatus((s) => ({ ...s, [key]: "slow" }));
          setAnnouncement(`${label} is taking longer than usual.`);
          return;
        }
        later(poll, POLL_MS);
      };
      later(poll, POLL_MS);
    },
    [tokens, later, format],
  );

  // Groups in order of first appearance, so the page array controls layout.
  const groups: Array<{ name: string; items: ExportReport[] }> = [];
  for (const r of reports) {
    const g = groups.find((x) => x.name === r.group);
    if (g) g.items.push(r);
    else groups.push({ name: r.group, items: [r] });
  }

  return (
    <>
      <fieldset className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <legend className="sr-only">File format</legend>
        <div className="flex overflow-hidden rounded-full border border-[#dddbd0]" role="presentation">
          {(
            [
              { value: "xlsx", label: "Excel" },
              { value: "csv", label: "CSV" },
            ] as const
          ).map((opt) => (
            <label
              key={opt.value}
              className={`cursor-pointer px-4 py-1.5 text-[12.5px] font-medium transition-colors ${
                format === opt.value
                  ? "bg-sage-band text-olive-deep"
                  : "text-[#4a5147] hover:bg-sage-band/50"
              }`}
            >
              <input
                type="radio"
                name="export-format"
                value={opt.value}
                checked={format === opt.value}
                onChange={() => setFormat(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
        <p className="text-[12px] text-muted">
          Excel opens in Excel, Numbers, or Google Sheets.
        </p>
      </fieldset>

      <div className="mt-4 flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.name}>
            <h3 className="px-3 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              {group.name}
            </h3>
            <ul className="mt-1">
              {group.items.map((r) => {
                const st = status[r.key];
                return (
                  <li key={r.key}>
                    <a
                      href={hrefFor(r.key, format, tokens[r.key])}
                      onClick={() => onDownload(r.key, r.label)}
                      aria-busy={st === "pending" || undefined}
                      className={`group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sage-band ${
                        st ? "bg-sage-band" : ""
                      }`}
                    >
                      <span>
                        <span className="block text-[13.5px] font-medium text-ink group-hover:text-olive-deep">
                          {r.label}
                        </span>
                        <span className="block text-[12px] text-muted">{r.description}</span>
                      </span>
                      <StatusMark status={st} />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <p
        role="status"
        aria-live="polite"
        className={`mt-3 min-h-[1.25rem] text-[12.5px] transition-opacity duration-200 motion-reduce:transition-none ${
          announcement ? "text-olive-deep opacity-100" : "opacity-0"
        }`}
      >
        {announcement}
      </p>
    </>
  );
}

/**
 * A download arrow at rest, a dot while the file is being built, a tick once
 * the browser actually has it.
 */
function StatusMark({ status }: { status: Status | undefined }) {
  if (status === "done") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0 text-olive-deep"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (status === "slow") {
    return (
      <span aria-hidden="true" className="shrink-0 text-[11px] font-semibold text-rose">
        !
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        aria-hidden="true"
        className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-olive-deep motion-reduce:animate-none"
      />
    );
  }

  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-muted transition-colors group-hover:text-olive-deep"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
