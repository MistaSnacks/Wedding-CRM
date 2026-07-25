"use client";

import { useRef, useState, useTransition } from "react";
import { parseCsv, detectMapping, validateCsv, type CsvMapping, type CsvValidation } from "@/lib/csv";
import {
  commitCsvImport,
  validateCsvImport,
  type CommitResult,
} from "@/app/admin/(dashboard)/imports/actions";
import { TagPicker } from "./TagPicker";
import { EventPicker } from "./EventPicker";

/** `tags` and `events` are arrays, not single-column strings, so they get their own controls. */
type SingleColumnKey = Exclude<keyof CsvMapping, "tags" | "events">;

const MAPPING_FIELDS: Array<{ key: SingleColumnKey; label: string; required?: boolean }> = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name", required: true },
  { key: "household", label: "Household / party" },
  { key: "envelope", label: "Envelope / invitation name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "ageType", label: "Age type" },
  { key: "relationship", label: "Relationship" },
  { key: "isPlusOne", label: "Plus-one marker" },
  { key: "maxPartySize", label: "Max party size" },
  { key: "plusOneSlots", label: "Plus-one slots" },
  { key: "locale", label: "Language" },
  { key: "address", label: "Mailing address (free text)" },
  { key: "street", label: "Street" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "Zip" },
  { key: "country", label: "Country" },
  { key: "meal", label: "Meal choice" },
  { key: "dietary", label: "Dietary restrictions" },
  { key: "notes", label: "Notes" },
];

export function ImportWizard({ events }: { events: Array<{ id: string; name: string }> }) {
  const [filename, setFilename] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [validation, setValidation] = useState<CsvValidation | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Bumped on every mapping/file mutation. A dry run captures the current
   * value when it starts; if it's changed by the time the response lands,
   * the mapping it validated is no longer the one on screen, and the
   * response is stale and must not resurrect `runId`. Without this, a slow
   * dry-run response arriving after a mapping edit could re-arm Commit for
   * a shape that specific run never actually validated.
   */
  const generation = useRef(0);

  async function onFile(file: File) {
    const text = await file.text();
    const parsed = parseCsv(text);
    const detected = detectMapping(parsed.headers);
    generation.current += 1;
    setFilename(file.name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(detected);
    setValidation(validateCsv(parsed.rows, detected));
    setRunId(null);
    setResult(null);
  }

  function remap(key: SingleColumnKey, value: string) {
    if (!mapping) return;
    const next = { ...mapping, [key]: value || undefined } as CsvMapping;
    generation.current += 1;
    setMapping(next);
    setValidation(validateCsv(rows, next));
    setRunId(null);
    setResult(null);
  }

  function onTagsChange(next: Array<{ column: string; prefix?: string }>) {
    if (!mapping) return;
    const nextMapping = { ...mapping, tags: next.length > 0 ? next : undefined };
    generation.current += 1;
    setMapping(nextMapping);
    setValidation(validateCsv(rows, nextMapping));
    setRunId(null);
    setResult(null);
  }

  function onEventsChange(next: Array<{ column: string; eventId: string }>) {
    if (!mapping) return;
    const nextMapping = { ...mapping, events: next.length > 0 ? next : undefined };
    generation.current += 1;
    setMapping(nextMapping);
    setValidation(validateCsv(rows, nextMapping));
    setRunId(null);
    setResult(null);
  }

  function dryRun() {
    if (!mapping) return;
    const startedAt = generation.current;
    startTransition(async () => {
      const r = await validateCsvImport(filename, rows, mapping);
      if (generation.current !== startedAt) return; // stale — mapping/file changed since this run started
      setRunId(r.ok ? r.runId : null);
      setResult(r.ok ? null : { ok: false, errors: r.errors });
    });
  }

  function commit() {
    if (!mapping || !runId) return;
    startTransition(async () => {
      const r = await commitCsvImport(runId, rows, mapping);
      setResult(r);
      if (r.ok) {
        setRows([]);
        setHeaders([]);
        setMapping(null);
        setValidation(null);
        setRunId(null);
      }
    });
  }

  return (
    <div className="rounded-xl border border-hairline p-5">
      <h2 className="text-[14.5px] font-semibold text-ink">CSV import</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">
        Columns are auto-detected; group rows into households with a Household column, or we group by last name + email.
      </p>

      <label className="mt-3.5 flex w-fit cursor-pointer items-center gap-2 rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] motion-reduce:transition-none">
        Choose CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>

      {result?.ok && (
        <p className="mt-3 rounded-lg bg-sage-band px-3.5 py-2.5 text-[13px] font-medium text-olive-deep">
          Imported {result.households} households · {result.guests} guests. Invite codes and RSVP links were generated automatically.
        </p>
      )}
      {result && !result.ok && (
        <div className="mt-3 rounded-lg bg-blush px-3.5 py-2.5 text-[13px] text-rose-deep">
          {result.errors.map((e, i) => (
            <p key={i}>{e.line ? `Line ${e.line}: ` : ""}{e.message}</p>
          ))}
        </div>
      )}

      {mapping && headers.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {MAPPING_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-[11px] font-semibold tracking-wide text-[#6b7167]">
                {f.label.toUpperCase()}{f.required ? " *" : ""}
                <select
                  value={(mapping[f.key] as string) ?? ""}
                  onChange={(e) => remap(f.key, e.target.value)}
                  className="rounded-lg border border-[#dddbd0] bg-white px-2 py-2 text-[12.5px] font-normal"
                >
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <TagPicker headers={headers} value={mapping.tags ?? []} onChange={onTagsChange} />
          {events.length > 0 && (
            <EventPicker headers={headers} events={events} value={mapping.events ?? []} onChange={onEventsChange} />
          )}

          {validation && (
            <div className="mt-4">
              <div className="flex items-center gap-3">
                <p className="text-[13px] font-medium text-ink">
                  Preview: <span className="text-olive">{validation.households.length} households</span> ·{" "}
                  <span className="text-olive">{validation.households.reduce((n, h) => n + h.guests.length, 0)} guests</span>
                  {validation.errors.length > 0 && (
                    <span className="text-rose"> · {validation.errors.length} errors</span>
                  )}
                  {validation.warnings.length > 0 && (
                    <span className="text-[#7a6420]"> · {validation.warnings.length} warnings</span>
                  )}
                </p>
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={!validation.ok || pending}
                  onClick={dryRun}
                  className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose disabled:opacity-50"
                >
                  {pending ? "Running…" : runId ? "Dry run saved ✓" : "Run dry run"}
                </button>
                <button
                  type="button"
                  disabled={!runId || pending}
                  onClick={commit}
                  className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-50 motion-reduce:transition-none"
                >
                  {pending ? "Importing…" : "Commit import"}
                </button>
              </div>

              {[...validation.errors, ...validation.warnings].slice(0, 8).map((e, i) => (
                <p key={i} className={`mt-1 text-[12.5px] ${validation.errors.includes(e) ? "text-rose" : "text-[#7a6420]"}`}>
                  Line {e.line}: {e.message}
                </p>
              ))}

              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-hairline">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="sticky top-0 bg-paper text-[10.5px] font-semibold tracking-wider text-[#6b7167]">
                    <tr>
                      <th className="px-3 py-2">HOUSEHOLD</th>
                      <th className="px-3 py-2">GUESTS</th>
                      <th className="px-3 py-2">EMAIL</th>
                      <th className="px-3 py-2">RULES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.households.map((h, i) => (
                      <tr key={i} className="border-t border-[#f1f0ea]">
                        <td className="px-3 py-2 font-medium text-ink">{h.displayName}</td>
                        <td className="px-3 py-2 text-[#4a5147]">
                          {h.guests.map((g) => `${g.firstName} ${g.lastName}`).join(", ")}
                        </td>
                        <td className="px-3 py-2 text-[#4a5147]">{h.email ?? "—"}</td>
                        <td className="px-3 py-2 text-[#4a5147]">
                          Max {h.maxPartySize}{h.plusOneSlots ? ` · +${h.plusOneSlots}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
