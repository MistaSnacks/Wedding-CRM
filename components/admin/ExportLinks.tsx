"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The export pills, with feedback.
 *
 * The complaint this fixes, verbatim: "I chose an export to download and it
 * just happened I didn't even know or could tell." Twelve reports x two formats
 * were bare `<a href>`s. A CSV of 250 guests takes a moment to build, and
 * nothing on the page moved in the meantime — so the click read as broken, and
 * the finished download read as nothing at all.
 *
 * These are still real anchors: right-click -> Save link as, middle-click and
 * keyboard activation all work exactly as before, and the whole thing degrades
 * to the previous behaviour with JavaScript off. The enhancement is additive.
 *
 * The confirmation is *earned*, not guessed on a timer. Each anchor carries a
 * one-time `dl` token in its URL; the export route echoes that token back in a
 * short-lived, non-HttpOnly cookie on the download response itself. So the
 * cookie can only appear once the browser has actually received the file. We
 * clear it on click and poll until our own token comes back. A timer would have
 * been three lines shorter and would have lied whenever the export was slow or
 * failed — which is precisely the case where the user needs the truth.
 */

const COOKIE = "export_download";
const POLL_MS = 150;
const GIVE_UP_MS = 20_000;
const CLEAR_AFTER_MS = 5_000;

type Status = "pending" | "done" | "slow";
type Format = "csv" | "xlsx";

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

export function ExportLinks({ reports }: { reports: Array<{ key: string; label: string }> }) {
  // Tokens are generated after mount, never during render: a random value in
  // the server-rendered HTML would be a hydration mismatch. Until they arrive
  // the hrefs are the plain URLs, which is the correct no-JS behaviour anyway.
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [announcement, setAnnouncement] = useState("");
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const r of reports) {
      seeded[`${r.key}:csv`] = newToken();
      seeded[`${r.key}:xlsx`] = newToken();
    }
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
    (id: string, label: string, format: Format) => {
      const token = tokens[id];
      if (!token) return; // Pre-hydration click: let the plain link do its job.

      clearCookie();
      setStatus((s) => ({ ...s, [id]: "pending" }));
      setAnnouncement(`Preparing ${label}…`);

      const startedAt = Date.now();
      const poll = () => {
        if (readCookie() === token) {
          clearCookie();
          setStatus((s) => ({ ...s, [id]: "done" }));
          setAnnouncement(
            `${label} downloaded as ${format.toUpperCase()}. Check your Downloads folder.`,
          );
          // A fresh token, so clicking the same report again is a new round trip
          // rather than an instant false "downloaded" from the old cookie.
          setTokens((t) => ({ ...t, [id]: newToken() }));
          later(() => {
            setStatus((s) => {
              if (s[id] !== "done") return s;
              const next = { ...s };
              delete next[id];
              return next;
            });
          }, CLEAR_AFTER_MS);
          return;
        }
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setStatus((s) => ({ ...s, [id]: "slow" }));
          setAnnouncement(`${label} is taking longer than usual.`);
          return;
        }
        later(poll, POLL_MS);
      };
      later(poll, POLL_MS);
    },
    [tokens, later],
  );

  return (
    <>
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {reports.map((r) => {
          const csvId = `${r.key}:csv`;
          const xlsxId = `${r.key}:xlsx`;
          const csv = status[csvId];
          const xlsx = status[xlsxId];
          const busy = csv === "pending" || xlsx === "pending";

          return (
            <span
              key={r.key}
              className={`flex overflow-hidden rounded-full border transition-colors duration-200 motion-reduce:transition-none ${
                busy
                  ? "border-olive-deep/40 bg-sage-band"
                  : csv === "done" || xlsx === "done"
                    ? "border-olive-deep/40 bg-sage-band"
                    : "border-[#dddbd0]"
              }`}
            >
              <a
                href={hrefFor(r.key, "csv", tokens[csvId])}
                onClick={() => onDownload(csvId, r.label, "csv")}
                aria-busy={csv === "pending" || undefined}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-medium text-[#4a5147] transition-colors hover:bg-sage-band hover:text-olive-deep"
              >
                <StatusMark status={csv} />
                {r.label}
              </a>
              <a
                href={hrefFor(r.key, "xlsx", tokens[xlsxId])}
                onClick={() => onDownload(xlsxId, r.label, "xlsx")}
                aria-busy={xlsx === "pending" || undefined}
                aria-label={`${r.label} as Excel`}
                className="flex items-center gap-1 border-l border-[#dddbd0] px-2.5 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-sage-band hover:text-olive-deep"
              >
                <StatusMark status={xlsx} />
                XLSX
              </a>
            </span>
          );
        })}
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

/** A dot while the file is being built, a tick once the browser has it. */
function StatusMark({ status }: { status: Status | undefined }) {
  if (!status) return null;

  if (status === "done") {
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-olive-deep"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (status === "slow") {
    return (
      <span aria-hidden="true" className="text-[11px] text-rose">
        !
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="h-[7px] w-[7px] animate-pulse rounded-full bg-olive-deep motion-reduce:animate-none"
    />
  );
}
