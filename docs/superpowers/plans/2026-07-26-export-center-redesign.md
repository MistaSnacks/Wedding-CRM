# Export Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 24-target export chips with a grouped report list and a single Excel/CSV toggle (Excel default), per `docs/superpowers/specs/2026-07-26-export-center-redesign-design.md`.

**Architecture:** One client component (`ExportCenter`) renders a format radiogroup and three groups of report rows as real `<a href>` anchors. The existing token→cookie→poll download-feedback machinery from `ExportLinks` carries over unchanged in behavior, keyed by report key alone. Zero backend changes — `app/api/export/[report]/route.ts` already serves both formats.

**Tech Stack:** Next.js (App Router), React client component, Tailwind classes using the project palette (`text-ink`, `text-muted`, `border-hairline`, `bg-sage-band`, `text-olive-deep`, `text-rose`).

## Global Constraints

- Copy register is plain English — the strings "CSV" appears only inside the format toggle and its hint; "XLSX" appears nowhere in user-facing copy (say "Excel").
- Excel (`xlsx`) is the default format; server-rendered anchors carry `format=xlsx` so the no-JS fallback downloads Excel.
- Download feedback must remain *earned*: one-time `dl` token per anchor, cookie receipt polled at 150 ms, 20 s give-up, checkmark cleared after 5 s. No timer-based guessing.
- Real anchors only: right-click → Save link as, middle-click, and keyboard activation must keep working.
- No test infra exists for components — verification is `npm run build` + browser walkthrough (Task 2).

---

### Task 1: `ExportCenter` component + page wiring

**Files:**
- Create: `components/admin/ExportCenter.tsx`
- Delete: `components/admin/ExportLinks.tsx`
- Modify: `app/admin/(dashboard)/imports/page.tsx` (REPORTS array, subtitle, import)

**Interfaces:**
- Consumes: `GET /api/export/[report]?format=csv|xlsx&dl=<token>` (existing route, untouched). Route echoes `dl` back as the `export_download` cookie on the download response.
- Produces: `ExportCenter({ reports: ExportReport[] })` where `ExportReport = { key: string; label: string; description: string; group: string }`. Page renders `<ExportCenter reports={REPORTS} />`.

- [ ] **Step 1: Write `components/admin/ExportCenter.tsx`**

```tsx
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
```

- [ ] **Step 2: Delete the old component**

```bash
git rm components/admin/ExportLinks.tsx
```

- [ ] **Step 3: Update `app/admin/(dashboard)/imports/page.tsx`**

Replace the `ExportLinks` import with:

```tsx
import { ExportCenter, type ExportReport } from "@/components/admin/ExportCenter";
```

Replace the `REPORTS` array with (labels/descriptions/groups verbatim from the spec):

```tsx
const REPORTS: ExportReport[] = [
  { key: "guest-list", label: "Full guest list", group: "Guest lists", description: "Everyone, with RSVPs, meals, dietary notes, and tables" },
  { key: "households", label: "Household list", group: "Guest lists", description: "One row per household — contacts, party size, invite code" },
  { key: "addresses", label: "Mailing addresses", group: "Guest lists", description: "One row per household, ready for envelopes or a mail house" },
  { key: "rsvp-status", label: "RSVP progress", group: "RSVPs", description: "How many in each household have answered" },
  { key: "attending", label: "Attending guests", group: "RSVPs", description: "Everyone who said yes, with their meal choice" },
  { key: "declined", label: "Declined guests", group: "RSVPs", description: "Everyone who said no" },
  { key: "pending", label: "Awaiting reply", group: "RSVPs", description: "Invited guests who haven't answered yet" },
  { key: "caterer", label: "Caterer report", group: "For your vendors", description: "Attending guests with meals, kids' meals, and dietary needs" },
  { key: "meals", label: "Meal counts", group: "For your vendors", description: "Totals for each dish" },
  { key: "dietary", label: "Dietary restrictions", group: "For your vendors", description: "Guests with dietary notes or allergies, and their tables" },
  { key: "accessibility", label: "Accessibility requests", group: "For your vendors", description: "Guests who asked for accommodations" },
  { key: "seating", label: "Seating chart", group: "For your vendors", description: "Who sits at which table, per event" },
];
```

In the Export center card, replace the subtitle line and the component:

```tsx
<p className="mt-0.5 text-[12.5px] text-muted">
  Pick a report and it downloads straight to your computer.
</p>
<ExportCenter reports={REPORTS} />
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: compiles with no type errors; `/admin/imports` builds. (No component test infra exists — the browser walkthrough in Task 2 is the behavioral check.)

- [ ] **Step 5: Commit**

```bash
git add components/admin/ExportCenter.tsx "app/admin/(dashboard)/imports/page.tsx"
git commit -m "feat(exports): grouped report list with single Excel/CSV toggle"
```

---

### Task 2: Browser walkthrough (Chrome extension)

**Files:** none — verification only, against the dev server on port 3006 (`npm run dev`, plus `npm run dev:login` if a session is needed).

**Interfaces:**
- Consumes: the running app at `http://localhost:3006/admin/imports` and the Task 1 UI.

- [ ] **Step 1: Start the dev server** (detached so it outlives the turn, per global rules: `nohup npm run dev > /tmp/…/dev.log 2>&1 & disown`; free port 3006 by PID only if busy).

- [ ] **Step 2: Drive the page with the Chrome extension** and confirm each of:
  - Toggle renders with **Excel** selected by default; hint line reads "Excel opens in Excel, Numbers, or Google Sheets."
  - Three group headers — Guest lists, RSVPs, For your vendors — with 3/4/5 rows and their descriptions.
  - Clicking "Full guest list" downloads `guest-list-<date>.xlsx`; the row shows the pulsing dot then the checkmark; the announcement mentions "an Excel file".
  - Switching to CSV and clicking "Caterer report" downloads `caterer-<date>.csv`; announcement mentions "a CSV file".
  - The word "XLSX" appears nowhere on the page.
  - Keyboard: tab reaches the toggle and rows; Enter on a row downloads.

- [ ] **Step 3: Fix anything found, re-verify, commit fixes** (`git commit -m "fix(exports): <finding>"` per fix; no commit if clean).
