"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "@/components/admin/form-fields.css";
import "./report-print.css";
import { toCsv } from "@/lib/reports/csv";
import {
  AGE_LABEL, COLUMNS, NONE, NO_FILTERS, NO_MEAL_LABEL, NO_TABLE_LABEL, PRESETS, RSVP_LABEL,
  cellText, describeFilters, exportRows, fileStem, filterOptions, filterRows, groupRows, isReminder, plural,
  rowsForEvent, sortRows, summarize,
  type ColumnKey, type GroupBy, type ReportEvent, type ReportFilters, type ReportRow, type ReportSummary, type SortState,
} from "@/lib/reports/report-view";
import type { AgeType, Attending } from "@/lib/types";

/**
 * The on-screen report builder.
 *
 * Everything on this page — the tiles, the table, the downloads and the
 * printout — is derived from the one flat `rows` array the server sent, through
 * the pure functions in `lib/reports/report-view.ts`. Nothing is fetched again
 * and nothing is written: the downloads are made in the browser from exactly
 * the rows and columns on screen, so a file can never disagree with the table.
 */

const pill = "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors motion-reduce:transition-none";
const pillOn = "border-olive-deep bg-olive-deep text-cream";
const pillOff = "border-[#dddbd0] bg-white/60 text-[#4a5147] hover:border-rose hover:text-rose";
const fieldLabel = "text-[12px] font-semibold text-[#4a5147]";
const field = "admin-field min-h-10 w-full rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13.5px] text-ink outline-none focus:border-olive";
const card = "rounded-2xl border border-hairline bg-white/70 p-5 max-md:p-4";

const RSVP_BADGE: Record<Attending, string> = {
  yes: "bg-sage-band text-olive-deep",
  no: "bg-blush text-rose-deep",
  pending: "bg-[#f1f0ea] text-[#5c6259]",
};

const GROUP_LABEL: Record<GroupBy, string> = {
  none: "No grouping",
  household: "Household",
  table: "Table",
  meal: "Meal",
  event: "Event",
};

const GROUP_COLUMN: Partial<Record<GroupBy, ColumnKey>> = { household: "household", table: "table", meal: "meal", event: "event" };

/** Long free-text columns wrap; everything else stays on one line. */
const WRAPPING = new Set<ColumnKey>(["dietary", "allergies", "accessibility", "tags"]);

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function localDay(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function ReportBuilder({
  rows,
  events,
  coupleNames,
}: {
  rows: ReportRow[];
  events: ReportEvent[];
  coupleNames: string;
}) {
  const first = PRESETS[0];
  const [eventId, setEventId] = useState<string | null>(events[0]?.id ?? null);
  const [filters, setFilters] = useState<ReportFilters>({ ...NO_FILTERS, ...first.filters });
  const [columns, setColumns] = useState<ColumnKey[]>(first.columns);
  const [groupBy, setGroupBy] = useState<GroupBy>(first.groupBy);
  const [sort, setSort] = useState<SortState>({ key: "household", dir: "asc" });
  const [presetKey, setPresetKey] = useState<string | null>(first.key);
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const [notice, setNotice] = useState("");
  // Filled in after mount and again just before printing: a date rendered on
  // the server could differ from the one in the browser.
  const [printedOn, setPrintedOn] = useState("");

  useEffect(() => {
    const stamp = () => setPrintedOn(new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date()));
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);

  const event = events.find((e) => e.id === eventId) ?? null;
  const allEvents = eventId === null;
  const eventName = event?.name ?? "All events";

  const eventRows = useMemo(() => rowsForEvent(rows, eventId), [rows, eventId]);
  const menu = useMemo(() => (event ? event.meals : [...new Set(events.flatMap((e) => e.meals))]), [event, events]);
  const summary = useMemo(() => summarize(eventRows, menu), [eventRows, menu]);
  const options = useMemo(() => filterOptions(eventRows, menu), [eventRows, menu]);
  const households = useMemo(() => new Set(eventRows.map((r) => r.householdId)).size, [eventRows]);

  const filtered = useMemo(() => filterRows(eventRows, filters), [eventRows, filters]);
  const groups = useMemo(() => groupRows(sortRows(filtered, sort), groupBy), [filtered, sort, groupBy]);
  const shown = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  const visible = COLUMNS.filter((c) => (c.key === "event" ? allEvents : columns.includes(c.key)));
  const choosable = COLUMNS.filter((c) => c.key !== "event" && (c.key !== "tags" || options.tags.length > 0));
  const filterWords = describeFilters(filters);
  const filtering = filterWords.length > 0;
  const countWords = allEvents ? `${filtered.length} guest ${filtered.length === 1 ? "entry" : "entries"}` : plural(filtered.length, "guest");
  const summaryLine = [countWords, eventName, ...filterWords].join(" · ");
  const onlyComing = filters.rsvp.length === 1 && filters.rsvp[0] === "yes";
  // Offer only the ages on this guest list, but never hide one that is switched on.
  const ageChoices = (["adult", "child", "infant"] as AgeType[]).filter((a) => options.ages.includes(a) || filters.ages.includes(a));

  /** Any hand-made change means the view is no longer the named quick report. */
  const patch = (next: Partial<ReportFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    if (!("query" in next)) setPresetKey(null);
    setNotice("");
  };

  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setFilters({ ...NO_FILTERS, ...preset.filters });
    setColumns(preset.columns);
    setGroupBy(preset.groupBy);
    setPresetKey(preset.key);
    setNotice("");
  };

  const chooseEvent = (id: string | null) => {
    setEventId(id);
    const next = filterOptions(rowsForEvent(rows, id), id ? events.find((e) => e.id === id)?.meals ?? [] : events.flatMap((e) => e.meals));
    // A dish or table from the other event would silently match nobody here.
    setFilters((f) => ({
      ...f,
      meals: f.meals.filter((m) => m === NONE || next.meals.includes(m)),
      table: f.table === NONE || next.tables.includes(f.table) ? f.table : "",
      tag: next.tags.includes(f.tag) ? f.tag : "",
    }));
    if (id !== null && groupBy === "event") setGroupBy("none");
    setNotice("");
  };

  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setPresetKey(null);
    setNotice("");
  };

  const onSort = (key: ColumnKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  /** The file holds the columns on screen, plus the grouping column if it is hidden. */
  const fileColumns = (): ColumnKey[] => {
    const keys = visible.map((c) => c.key);
    const extra = GROUP_COLUMN[groupBy];
    return extra && !keys.includes(extra) ? [...keys, extra] : keys;
  };
  const stem = () => fileStem([eventName, presetKey ? PRESETS.find((p) => p.key === presetKey)?.label ?? "" : filtering ? "filtered" : "guests"], localDay(new Date()));

  const downloadCsv = () => {
    if (!shown.length) return;
    setBusy("csv");
    try {
      // The leading mark tells Excel the file is UTF-8, so accented names survive.
      const csv = `﻿${toCsv(exportRows(shown, fileColumns()))}`;
      saveFile(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${stem()}.csv`);
      setNotice(`Downloaded ${countWords} as a CSV file. Check your Downloads folder.`);
    } catch {
      setNotice("The CSV file could not be made. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const downloadExcel = async () => {
    if (!shown.length) return;
    setBusy("xlsx");
    setNotice("Preparing your Excel file…");
    try {
      const data = exportRows(shown, fileColumns());
      // Loaded on click so the spreadsheet library is not part of the page.
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.json_to_sheet(data);
      const headers = Object.keys(data[0]);
      sheet["!cols"] = headers.map((h) => ({ wch: Math.min(48, Math.max(h.length, ...data.map((r) => r[h].length)) + 2) }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, eventName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Guests");
      XLSX.writeFile(book, `${stem()}.xlsx`);
      setNotice(`Downloaded ${countWords} as an Excel file. Check your Downloads folder.`);
    } catch {
      setNotice("The Excel file could not be made. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!events.length) {
    return (
      <div className={`${card} text-[14px] text-[#4a5147]`}>
        <p className="font-semibold text-ink">There are no events yet.</p>
        <p className="mt-1">
          Reports show who is coming to each event.{" "}
          <Link href="/admin/events" className="font-medium text-olive-deep underline underline-offset-2">Add your first event</Link>{" "}
          and they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div data-report-root className="flex flex-col gap-5">
      {/* Printed title: shown on paper only. */}
      <div className="hidden print:block">
        <p className="text-[20px] font-semibold text-ink">{coupleNames} · {eventName}</p>
        <p className="mt-1 text-[13px] text-ink">{[...(filterWords.length ? filterWords : ["Everyone invited"]), countWords].join(" · ")}</p>
        {groupBy !== "none" && <p className="text-[12px] text-[#4a5147]">Grouped by {GROUP_LABEL[groupBy].toLowerCase()}</p>}
        <p className="text-[12px] text-[#4a5147]">Printed {printedOn}</p>
      </div>

      {/* 1. Event */}
      <div className="no-print flex flex-wrap items-center gap-2" role="group" aria-label="Choose an event">
        {events.map((e) => (
          <button key={e.id} type="button" aria-pressed={eventId === e.id} onClick={() => chooseEvent(e.id)} className={`${pill} ${eventId === e.id ? pillOn : pillOff} px-4 text-[13.5px]`}>
            {e.name}
          </button>
        ))}
        {events.length > 1 && (
          <button type="button" aria-pressed={allEvents} onClick={() => chooseEvent(null)} className={`${pill} ${allEvents ? pillOn : pillOff} px-4 text-[13.5px]`}>
            All events
          </button>
        )}
      </div>

      {/* 2. Summary */}
      {allEvents
        ? <EventComparison rows={rows} events={events} onChoose={chooseEvent} />
        : <Summary summary={summary} households={households} eventName={eventName} onPreset={applyPreset} />}

      {/* 3. Quick reports */}
      <section className={`no-print ${card}`} aria-labelledby="quick-reports">
        <h2 id="quick-reports" className="text-[15px] font-semibold text-ink">Quick reports</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Pick one to see it below. You can adjust it afterwards.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" title={p.hint} aria-pressed={presetKey === p.key} onClick={() => applyPreset(p.key)} className={`${pill} ${presetKey === p.key ? pillOn : pillOff}`}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* 4. Filters */}
      <section className={`no-print ${card}`} aria-labelledby="narrow-down">
        <h2 id="narrow-down" className="text-[15px] font-semibold text-ink">Narrow it down</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Choices add up: a guest must match all of them.</p>

        <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
          <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
            Search by name
            <input
              type="search"
              value={filters.query}
              onChange={(e) => patch({ query: e.target.value })}
              placeholder="Guest or household name"
              className={`${field} font-normal`}
            />
          </label>

          <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
            Table
            <select value={filters.table} onChange={(e) => patch({ table: e.target.value })} className={`${field} font-normal`}>
              <option value="">Any table</option>
              <option value={NONE}>{NO_TABLE_LABEL}</option>
              {options.tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          {options.tags.length > 0 && (
            <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
              Household tag
              <select value={filters.tag} onChange={(e) => patch({ tag: e.target.value })} className={`${field} font-normal`}>
                <option value="">Any tag</option>
                {options.tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className={`mb-1.5 ${fieldLabel}`}>Answer</legend>
            <div className="flex flex-wrap gap-1.5">
              {(["yes", "no", "pending"] as const).map((a) => (
                <button key={a} type="button" aria-pressed={filters.rsvp.includes(a)} onClick={() => patch({ rsvp: toggle(filters.rsvp, a) })} className={`${pill} ${filters.rsvp.includes(a) ? pillOn : pillOff}`}>
                  {RSVP_LABEL[a]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className={`mb-1.5 ${fieldLabel}`}>Meal</legend>
            <div className="flex flex-wrap gap-1.5">
              {[...options.meals, NONE].map((m) => (
                <button key={m} type="button" aria-pressed={filters.meals.includes(m)} onClick={() => patch({ meals: toggle(filters.meals, m) })} className={`${pill} ${filters.meals.includes(m) ? pillOn : pillOff}`}>
                  {m === NONE ? NO_MEAL_LABEL : m}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className={`mb-1.5 ${fieldLabel}`}>Adult or child</legend>
            <div className="flex flex-wrap gap-1.5">
              {ageChoices.map((a) => (
                <button key={a} type="button" aria-pressed={filters.ages.includes(a)} onClick={() => patch({ ages: toggle(filters.ages, a) })} className={`${pill} ${filters.ages.includes(a) ? pillOn : pillOff}`}>
                  {a === "adult" ? "Adults" : a === "child" ? "Children" : "Infants"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-4">
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13.5px] text-ink">
            <input type="checkbox" checked={filters.hasDietary} onChange={(e) => patch({ hasDietary: e.target.checked })} className="h-4 w-4 accent-[#3b4823]" />
            Has a dietary note or allergy
          </label>
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13.5px] text-ink">
            <input type="checkbox" checked={filters.hasAccessibility} onChange={(e) => patch({ hasAccessibility: e.target.checked })} className="h-4 w-4 accent-[#3b4823]" />
            Has an accessibility need
          </label>
        </div>
      </section>

      {/* 5 + 6. Results and actions */}
      <section aria-labelledby="report-results" className="flex flex-col gap-3">
        <div className="no-print flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 id="report-results" className="text-[15px] font-semibold text-ink">Your report</h2>
            <p className="mt-0.5 text-[13.5px] text-[#4a5147]" aria-live="polite">
              {summaryLine}
              {filtering && (
                <>
                  {" · "}
                  <button type="button" onClick={clearFilters} className="font-medium text-rose-deep underline underline-offset-2 hover:text-rose">
                    Clear filters
                  </button>
                </>
              )}
            </p>
            {allEvents && <p className="mt-0.5 text-[12px] text-muted">A guest appears once for each event they are invited to.</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={downloadExcel} disabled={!shown.length || busy !== null} className="min-h-10 rounded-lg bg-olive-deep px-4 py-2 text-[13.5px] font-semibold text-cream transition-colors hover:bg-olive-deeper disabled:cursor-not-allowed disabled:opacity-50">
              {busy === "xlsx" ? "Preparing…" : "Download Excel"}
            </button>
            <button type="button" onClick={downloadCsv} disabled={!shown.length || busy !== null} className="min-h-10 rounded-lg border border-[#dddbd0] bg-white/70 px-4 py-2 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:cursor-not-allowed disabled:opacity-50">
              Download CSV
            </button>
            <button type="button" onClick={() => window.print()} disabled={!shown.length} className="min-h-10 rounded-lg border border-[#dddbd0] bg-white/70 px-4 py-2 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:cursor-not-allowed disabled:opacity-50">
              Print
            </button>
          </div>
        </div>

        <div className="no-print flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-[13px] text-[#4a5147]">
            Group by
            <select
              value={groupBy}
              onChange={(e) => { setGroupBy(e.target.value as GroupBy); setPresetKey(null); }}
              className="admin-field min-h-9 rounded-lg border border-[#dddbd0] bg-white px-3 py-1.5 text-[13px] text-ink outline-none focus:border-olive"
            >
              {(["none", "household", "table", "meal", ...(allEvents ? ["event" as const] : [])] as GroupBy[]).map((g) => (
                <option key={g} value={g}>{GROUP_LABEL[g]}</option>
              ))}
            </select>
          </label>

          <details className="group relative">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[#dddbd0] bg-white px-3 py-1.5 text-[13px] text-ink hover:border-rose [&::-webkit-details-marker]:hidden">
              Columns shown ({visible.length})
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="transition-transform group-open:rotate-180 motion-reduce:transition-none"><path d="m3 4.5 3 3 3-3" fill="none" stroke="#6b7167" strokeWidth="1.5" /></svg>
            </summary>
            <div className="absolute left-0 z-30 mt-1.5 grid w-[min(23rem,calc(100vw-2rem))] grid-cols-2 gap-x-3 gap-y-0.5 rounded-xl border border-hairline bg-white p-3 shadow-[0_10px_30px_rgba(28,35,27,0.12)]">
              {choosable.map((c) => (
                <label key={c.key} className={`flex min-h-8 items-center gap-2 text-[13px] ${c.key === "guest" ? "text-muted" : "cursor-pointer text-ink"}`}>
                  <input
                    type="checkbox"
                    checked={columns.includes(c.key)}
                    disabled={c.key === "guest"}
                    onChange={() => { setColumns((cols) => toggle(cols, c.key)); setPresetKey(null); }}
                    className="h-4 w-4 accent-[#3b4823]"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </details>

          <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[12.5px] text-olive-deep">{notice}</p>
        </div>

        {shown.length === 0 ? (
          <div className={`${card} py-10 text-center`}>
            <p className="text-[14.5px] font-semibold text-ink">
              {eventRows.length === 0 ? `Nobody is invited to ${eventName} yet.` : "No guests match these choices."}
            </p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              {eventRows.length === 0
                ? "Once households are invited to this event, they will show up here."
                : "Try removing a choice above, or pick a different event."}
            </p>
            {eventRows.length > 0 && filtering && (
              <button type="button" onClick={clearFilters} className="no-print mt-4 min-h-10 rounded-lg border border-[#dddbd0] bg-white px-4 py-2 text-[13.5px] font-medium text-ink hover:border-rose hover:text-rose">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="max-h-[75vh] overflow-auto rounded-2xl border border-hairline bg-white print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:bg-white">
            <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
              <caption className="sr-only">{summaryLine}</caption>
              <thead>
                <tr>
                  {visible.map((c, i) => {
                    const active = sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                        className={`sticky top-0 border-b border-hairline bg-paper p-0 text-[12px] font-semibold text-[#4a5147] print:static ${i === 0 ? "left-0 z-20" : "z-10"}`}
                      >
                        <button
                          type="button"
                          onClick={() => onSort(c.key)}
                          title={`Sort by ${c.label.toLowerCase()}`}
                          className="flex w-full items-center gap-1.5 whitespace-nowrap px-4 py-3 text-left hover:text-olive-deep focus-visible:outline-offset-[-2px]"
                        >
                          {c.label}
                          <span aria-hidden="true" className={`text-[10px] print:hidden ${active ? "text-olive-deep" : "text-[#c5c3b6]"}`}>
                            {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key}>
                  {groupBy !== "none" && (
                    <tr data-group-row>
                      <th scope="colgroup" colSpan={visible.length} className="border-b border-hairline bg-sage-band/70 p-0 text-left font-normal print:bg-transparent print:border-ink/40">
                        <span className="sticky left-0 inline-flex flex-wrap items-baseline gap-x-2.5 px-4 py-2 print:static">
                          <span className={`text-[13.5px] font-semibold ${g.key === NONE ? "text-rose-deep" : "text-olive-deep"}`}>{g.label}</span>
                          <span className="text-[12.5px] text-[#4a5147]">
                            {plural(g.guests, "guest")}
                            {!onlyComing && ` · ${g.coming} coming`}
                          </span>
                        </span>
                      </th>
                    </tr>
                  )}
                  {g.rows.map((r) => (
                    <tr key={r.key} className="group/row">
                      {visible.map((c, i) => (
                        <td
                          key={c.key}
                          className={`border-b border-[#f1f0ea] px-4 py-3 align-top text-[#353d33] group-hover/row:bg-paper print:py-1.5 print:whitespace-normal ${
                            WRAPPING.has(c.key) ? "min-w-[11rem] max-w-[22rem] break-words print:min-w-0" : "whitespace-nowrap"
                          } ${i === 0 ? "sticky left-0 z-[5] bg-white print:static" : ""}`}
                        >
                          <Cell row={r} column={c.key} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Cell({ row, column }: { row: ReportRow; column: ColumnKey }) {
  const value = cellText(row, column);
  if (column === "guest") {
    return (
      <Link href={`/admin/guests/${row.householdId}`} prefetch={false} className="font-semibold text-ink underline-offset-2 hover:text-rose hover:underline">
        {value || "Unnamed guest"}
      </Link>
    );
  }
  if (!value) return <span className="text-[#b9b7aa]" aria-hidden="true">—</span>;
  if (column === "rsvp") {
    return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium print:p-0 ${RSVP_BADGE[row.rsvp]} print:bg-transparent print:text-ink`}>{value}</span>;
  }
  if (isReminder(row, column)) return <span className="font-medium text-rose-deep">{value}</span>;
  if (column === "tags") {
    return (
      <span className="flex flex-wrap gap-1">
        {row.tags.map((t) => <span key={t} className="rounded-full bg-[#f1f0ea] px-2 py-0.5 text-[12px] text-[#4a5147] print:p-0">{t}</span>)}
      </span>
    );
  }
  if (column === "age") return <>{AGE_LABEL[row.ageType]}</>;
  return <>{value}</>;
}

function Summary({
  summary: s,
  households,
  eventName,
  onPreset,
}: {
  summary: ReportSummary;
  households: number;
  eventName: string;
  onPreset: (key: string) => void;
}) {
  const ages = [plural(s.adults, "adult"), s.children ? (s.children === 1 ? "1 child" : `${s.children} children`) : "", s.infants ? plural(s.infants, "infant") : ""].filter(Boolean).join(" · ");
  const tiles = [
    { label: "Invited guests", value: s.invited, sub: `in ${plural(households, "household")}`, tone: "text-ink" },
    { label: "Coming", value: s.coming, sub: s.coming ? ages : "No one has said yes yet", tone: "text-olive-deep" },
    { label: "Not coming", value: s.notComing, sub: "have said no", tone: "text-ink" },
    { label: "Awaiting reply", value: s.awaiting, sub: s.awaiting ? "have not answered yet" : "Everyone has answered", tone: "text-ink" },
  ];
  const dishes = [...s.meals, { name: NO_MEAL_LABEL, count: s.noMeal }];

  return (
    <section className="no-print flex flex-col gap-4 max-md:gap-2.5" aria-label={`Summary for ${eventName}`}>
      <dl className="grid grid-cols-4 gap-4 max-md:grid-cols-2 max-md:gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-2 rounded-2xl border border-hairline bg-white/70 p-5 max-md:p-4">
            <dt className="text-[13px] font-semibold text-[#4a5147]">{t.label}</dt>
            <dd className="flex flex-col gap-2">
              <span className={`text-[34px] font-semibold leading-none tabular-nums max-md:text-[30px] ${t.tone}`}>{t.value}</span>
              <span className="text-[12.5px] text-muted">{t.sub}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-semibold text-ink">Meals for guests who are coming</h2>
          <p className="text-[12.5px] text-muted">{plural(s.coming, "guest")} coming</p>
        </div>
        {s.coming === 0 ? (
          <p className="mt-3 text-[13.5px] text-muted">Meal counts will appear here as guests say yes.</p>
        ) : (
          <ul className="mt-3 grid gap-x-8 gap-y-2.5 md:grid-cols-2">
            {dishes.map((d) => {
              const missing = d.name === NO_MEAL_LABEL;
              const share = s.coming ? (d.count / s.coming) * 100 : 0;
              return (
                <li key={d.name} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.25rem] items-center gap-3 text-[13.5px]">
                  <span className={`truncate ${missing && d.count ? "font-medium text-rose-deep" : "text-ink"}`} title={d.name}>{d.name}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-[#eeede4]" aria-hidden="true">
                    <span className={`block h-full rounded-full ${missing ? "bg-rose" : "bg-olive"}`} style={{ width: d.count ? `${Math.max(share, 2)}%` : 0 }} />
                  </span>
                  <span className={`text-right font-semibold tabular-nums ${missing && d.count ? "text-rose-deep" : d.count ? "text-ink" : "text-muted"}`}>{d.count}</span>
                </li>
              );
            })}
          </ul>
        )}
        {(s.noMeal > 0 || s.noTable > 0) && (
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline pt-3 text-[13px] text-[#4a5147]">
            <span className="font-medium text-ink">Still to sort out:</span>
            {s.noMeal > 0 && (
              <button type="button" onClick={() => onPreset("no-meal")} className="text-rose-deep underline underline-offset-2 hover:text-rose">
                {plural(s.noMeal, "coming guest")} with no meal yet
              </button>
            )}
            {s.noTable > 0 && (
              <button type="button" onClick={() => onPreset("no-table")} className="text-rose-deep underline underline-offset-2 hover:text-rose">
                {plural(s.noTable, "coming guest")} with no table yet
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

/** "All events": one line per event, so the numbers never mix events together. */
function EventComparison({ rows, events, onChoose }: { rows: ReportRow[]; events: ReportEvent[]; onChoose: (id: string) => void }) {
  return (
    <section className={`no-print ${card}`} aria-labelledby="event-comparison">
      <h2 id="event-comparison" className="text-[15px] font-semibold text-ink">All events at a glance</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">Choose an event name to see its meals and details.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-[13.5px]">
          <thead>
            <tr className="text-[12px] font-semibold text-[#4a5147]">
              <th scope="col" className="border-b border-hairline py-2 pr-4">Event</th>
              <th scope="col" className="border-b border-hairline px-3 py-2 text-right">Invited guests</th>
              <th scope="col" className="border-b border-hairline px-3 py-2 text-right">Coming</th>
              <th scope="col" className="border-b border-hairline px-3 py-2 text-right">Not coming</th>
              <th scope="col" className="border-b border-hairline py-2 pl-3 text-right">Awaiting reply</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const s = summarize(rowsForEvent(rows, e.id));
              return (
                <tr key={e.id}>
                  <th scope="row" className="border-b border-[#f1f0ea] py-2.5 pr-4 text-left font-semibold">
                    <button type="button" onClick={() => onChoose(e.id)} className="text-left text-ink underline-offset-2 hover:text-rose hover:underline">{e.name}</button>
                  </th>
                  <td className="border-b border-[#f1f0ea] px-3 py-2.5 text-right tabular-nums">{s.invited}</td>
                  <td className="border-b border-[#f1f0ea] px-3 py-2.5 text-right font-semibold tabular-nums text-olive-deep">{s.coming}</td>
                  <td className="border-b border-[#f1f0ea] px-3 py-2.5 text-right tabular-nums">{s.notComing}</td>
                  <td className="border-b border-[#f1f0ea] py-2.5 pl-3 text-right tabular-nums">{s.awaiting}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
