"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import {
  parseCsv,
  detectMapping,
  validateCsv,
  summarize,
  type CsvMapping,
  type CsvValidation,
  type ImportContext,
  type ImportProblem,
  type RowError,
} from "@/lib/csv";
import { commitCsvImport, validateCsvImport } from "@/app/admin/(dashboard)/imports/actions";
import { UploadStep } from "./import/UploadStep";
import { ReviewStep } from "./import/ReviewStep";
import { DoneStep } from "./import/DoneStep";
import { ColumnMatches, type SingleColumnKey } from "./import/ColumnMatches";

type Step = "upload" | "review" | "done";

/**
 * Step machine only: Upload → Review → Done. It holds state and handlers;
 * every pixel lives in the child components under `./import/`.
 *
 * The central inversion versus the old wizard: a dropped file goes straight
 * to Review. Configuration is reachable from Review, never ahead of it.
 */
export function ImportWizard({
  events,
  mealOptions,
}: {
  events: Array<{ id: string; name: string }>;
  mealOptions: Array<{ id: string; name: string }>;
}) {
  /**
   * The same ImportContext the server action builds. The preview must be given
   * the real meal options: without them `resolveMeal` cannot match anything and
   * warns "doesn't match any meal option" for every row with a mapped meal
   * column, so a valid 400-row sheet previews as 400 warnings. A dry run whose
   * output differs from the commit defeats the point of having one.
   */
  const context = useMemo<ImportContext>(() => ({ events, mealOptions }), [events, mealOptions]);

  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [validation, setValidation] = useState<CsvValidation | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [commitErrors, setCommitErrors] = useState<RowError[] | null>(null);
  const [done, setDone] = useState<{ households: number; guests: number; skipped: ImportProblem[] } | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnsReason, setColumnsReason] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Bumped on every mapping/file mutation. A dry run captures the current
   * value when it starts; if it's changed by the time the response lands,
   * the mapping it validated is no longer the one on screen, and the
   * response is stale and must not resurrect `runId`. Without this, a slow
   * dry-run response arriving after a mapping edit could re-arm Commit for
   * a shape that specific run never actually validated.
   *
   * The import sequence below re-checks it after *every* await, not just the
   * first: the mapping controls stay mounted while an import runs, so the
   * window between the dry run landing and the commit leaving is just as
   * racy as the window before it.
   */
  const generation = useRef(0);

  const summary = useMemo(
    () => (validation && mapping ? summarize(validation, rows, mapping) : null),
    [validation, mapping, rows],
  );

  /** No name columns is the one case where the mapping surface opens unprompted. */
  const needsColumns = !mapping?.firstName || !mapping?.lastName;

  async function onFile(file: File) {
    setFileError(null);
    setReading(true);
    setFilename(file.name);
    // A new file invalidates any dry run in flight for the previous one.
    generation.current += 1;
    try {
      const text = await readSpreadsheet(file);
      const parsed = parseCsv(text);
      if (parsed.rows.length === 0) {
        setFileError(
          "That file didn't have any guests in it. If your spreadsheet has more than one tab, export the tab with your guest list on it and try again.",
        );
        return;
      }
      const detected = detectMapping(parsed.headers);
      const missingNames = !detected.firstName || !detected.lastName;
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(detected);
      setValidation(validateCsv(parsed.rows, detected, context));
      setRunId(null);
      setCommitErrors(null);
      setDone(null);
      setColumnsOpen(missingNames);
      setColumnsReason(
        missingNames
          ? "We couldn't tell which columns hold names. Choose your first name and last name columns below and your guests will appear."
          : null,
      );
      setStep("review");
    } catch {
      setFileError(
        "We couldn't read that file. It needs to be a spreadsheet saved as CSV or Excel — in Google Sheets that's File → Download → Comma-separated values.",
      );
    } finally {
      setReading(false);
    }
  }

  /** Every mapping mutation revalidates locally and disarms the dry run. */
  function applyMapping(next: CsvMapping) {
    generation.current += 1;
    setMapping(next);
    setValidation(validateCsv(rows, next, context));
    setRunId(null);
    setCommitErrors(null);
    if (next.firstName && next.lastName) setColumnsReason(null);
  }

  function remap(key: SingleColumnKey, value: string) {
    if (!mapping) return;
    applyMapping({ ...mapping, [key]: value || undefined } as CsvMapping);
  }

  function onTagsChange(next: Array<{ column: string; prefix?: string }>) {
    if (!mapping) return;
    applyMapping({ ...mapping, tags: next.length > 0 ? next : undefined });
  }

  function onEventsChange(next: Array<{ column: string; eventId: string }>) {
    if (!mapping) return;
    applyMapping({ ...mapping, events: next.length > 0 ? next : undefined });
  }

  /**
   * One button, two server calls, in the required order: the dry run persists
   * an `imports` row and returns the run id; the commit is only ever reached
   * with a `runId` this very sequence produced, so a commit can never precede
   * a dry run. Each `await` is followed by the staleness check — a mapping
   * edit mid-flight aborts the sequence rather than committing a shape that
   * was never validated.
   */
  function importNow() {
    if (!mapping || pending) return;
    const startedAt = generation.current;
    const skipped = summary?.problems.errors ?? [];
    setCommitErrors(null);

    startTransition(async () => {
      const dry = await validateCsvImport(filename, rows, mapping);
      if (generation.current !== startedAt) return; // stale — mapping/file changed since this run started
      if (!dry.ok) {
        setRunId(null);
        setCommitErrors(dry.errors);
        return;
      }
      setRunId(dry.runId);

      if (generation.current !== startedAt) return; // stale — do not commit an unvalidated shape
      const committed = await commitCsvImport(dry.runId, rows, mapping);
      if (generation.current !== startedAt) return;

      if (!committed.ok) {
        setCommitErrors(committed.errors);
        return;
      }
      setDone({ households: committed.households, guests: committed.guests, skipped });
      setRunId(null);
      setStep("done");
    });
  }

  function startOver() {
    generation.current += 1;
    setStep("upload");
    setFilename("");
    setHeaders([]);
    setRows([]);
    setMapping(null);
    setValidation(null);
    setRunId(null);
    setCommitErrors(null);
    setDone(null);
    setFileError(null);
    setColumnsOpen(false);
    setColumnsReason(null);
  }

  /**
   * Builds a CSV of just the offending rows, with a plain-language column
   * saying what to fix, so the sheet can be corrected and re-uploaded.
   * Household-level problems carry no row of their own (they're reported at
   * the header line); they're still listed, with the cells left blank.
   */
  function downloadProblems(problems: ImportProblem[], name: string) {
    const data = problems.map((p) => {
      const row = p.line >= 2 ? rows[p.line - 2] : undefined;
      const out: Record<string, string> = {};
      for (const h of headers) out[h] = row?.[h] ?? "";
      out["Spreadsheet row"] = p.line >= 2 ? String(p.line) : "";
      out["What to fix"] = p.message;
      return out;
    });
    const csv = Papa.unparse({ fields: [...headers, "Spreadsheet row", "What to fix"], data });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (step === "done" && done) {
    return (
      <DoneStep
        households={done.households}
        guests={done.guests}
        skipped={done.skipped}
        onDownloadSkipped={downloadProblems}
        onImportAnother={startOver}
      />
    );
  }

  if (step === "review" && summary && mapping) {
    return (
      <ReviewStep
        summary={summary}
        filename={filename}
        importing={pending}
        needsColumns={needsColumns}
        commitErrors={commitErrors}
        onImport={importNow}
        onStartOver={startOver}
        onDownloadProblems={downloadProblems}
        columnMatches={
          <ColumnMatches
            open={columnsOpen}
            onToggle={() => setColumnsOpen((v) => !v)}
            headers={headers}
            mapping={mapping}
            events={events}
            reason={columnsReason}
            disabled={pending}
            onRemap={remap}
            onTagsChange={onTagsChange}
            onEventsChange={onEventsChange}
          />
        }
      />
    );
  }

  return <UploadStep onFile={onFile} reading={reading} readingName={filename} error={fileError} />;
}

/**
 * CSV goes straight to the tested parser. Excel workbooks are converted to
 * CSV first and then take the identical path, so there is exactly one parsing
 * code path. `xlsx` is already a dependency (the export routes use it) and is
 * loaded dynamically, so it stays out of the bundle unless someone actually
 * drops a workbook.
 */
async function readSpreadsheet(file: File): Promise<string> {
  if (!/\.xlsx?$/i.test(file.name)) return file.text();
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("empty workbook");
  return XLSX.utils.sheet_to_csv(sheet);
}
