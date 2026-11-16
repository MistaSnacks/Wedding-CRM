"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { resolveApplied, resolveFix, type AppliedFix, type RowFix } from "./import/fixable";

import type { ImportDecision, Reconciliation } from "@/lib/csv/reconciliation";
import { ImportReconciliation } from "./import/ImportReconciliation";
type Step = "upload" | "sheet" | "review" | "done";

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
  weddingId = "default",
}: {
  weddingId?: string;
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
  const [done, setDone] = useState<{ households: number; guests: number; skipped: ImportProblem[]; updated?: number } | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnsReason, setColumnsReason] = useState<string | null>(null);
  /**
   * Rows repaired in place on this screen — the numerator of "3 of 12 fixed",
   * and the record that lets every one of them be read back and re-edited.
   * Only which cell was written is kept here; the value itself is read out of
   * `rows`, so the read-back cannot drift from what will actually be imported.
   */
  const [applied, setApplied] = useState<AppliedFix[]>([]);
  /**
   * Warnings the most recent repair *added*. Filling in a name can resurrect a
   * whole invitation, which then draws its own "someone may be missing" check —
   * so her own correction can push the count up. That is correct, and it is
   * also the single most alarming thing on the screen if left unexplained.
   */
  const [warningsAdded, setWarningsAdded] = useState(0);
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
  const [sheets, setSheets] = useState<Array<{name:string;text:string;rows:number}>>([]);
  const [reconciliation, setReconciliation] = useState<Reconciliation[]>([]);
  const [decisions, setDecisions] = useState<ImportDecision[]>([]);
  const draftKey = `import-draft:${weddingId}`;
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  useEffect(() => { try { setSavedDraft(sessionStorage.getItem(draftKey)); } catch {} }, [draftKey]);
  function invalidateReview() { setRunId(null); setReconciliation([]); setDecisions([]); }
  function loadText(text: string) {
    const parsed = parseCsv(text);
    if (!parsed.rows.length) throw new Error("This worksheet has no guest rows. Choose another worksheet.");
    if (new TextEncoder().encode(JSON.stringify(parsed.rows)).length > 3_000_000) throw new Error("This worksheet expands beyond the 3 MB import limit. Split it into smaller files.");
    if (parsed.rows.length > 10000) throw new Error("Import up to 10,000 rows at a time.");
    let detected = detectMapping(parsed.headers);
    try { const saved = localStorage.getItem(`import-columns:${weddingId}:${JSON.stringify(parsed.headers)}`); if(saved) detected = JSON.parse(saved); } catch {}
    setHeaders(parsed.headers); setRows(parsed.rows); setMapping(detected);
    setValidation(validateCsv(parsed.rows, detected, context)); invalidateReview();
    setCommitErrors(null); setDone(null); setApplied([]); setWarningsAdded(0);
    setColumnsOpen(!detected.firstName || !detected.lastName); setColumnsReason(null); setStep("review");
  }
  function saveDraft() {
    try { sessionStorage.setItem(draftKey, JSON.stringify({at:Date.now(),filename,headers,rows,mapping})); setDraftMessage("Draft saved in this browser tab for 24 hours. Closing the tab clears it."); }
    catch { setDraftMessage("This browser could not save the draft. Keep this tab open to continue."); }
  }
  function restoreDraft() {
    try { const d=JSON.parse(savedDraft!); if(Date.now()-d.at>86400000) throw new Error("This draft expired. Upload the file again."); generation.current++; setFilename(d.filename); setHeaders(d.headers); setRows(d.rows); setMapping(d.mapping); setValidation(validateCsv(d.rows,d.mapping,context)); invalidateReview(); setStep("review"); }
    catch(e) { setFileError(e instanceof Error?e.message:"Could not restore this draft."); }
  }

  const summary = useMemo(
    () => (validation && mapping ? summarize(validation, rows, mapping) : null),
    [validation, mapping, rows],
  );

  /** The repairs as editable rows again, read straight out of the current data. */
  const fixed = useMemo(
    () => (mapping ? resolveApplied(applied, rows, mapping) : []),
    [applied, rows, mapping],
  );

  /** No name columns is the one case where the mapping surface opens unprompted. */
  const needsColumns = !mapping?.firstName || !mapping?.lastName;

  async function onFile(file: File) {
    setFileError(null);
    setReading(true);
    setFilename(file.name);
    // A new file invalidates any dry run in flight for the previous one.
    generation.current += 1;
    const startedAt = generation.current;
    try {
      if (file.size > 5_000_000) throw new Error("Import files up to 5 MB. Split larger workbooks into smaller files.");
      const choices = await readSpreadsheet(file);
      if (generation.current !== startedAt) return;
      setSheets(choices); invalidateReview();
      if (choices.length > 1) setStep("sheet");
      else loadText(choices[0].text);
    } catch(e) {
      if (generation.current === startedAt) setFileError(e instanceof Error ? e.message : "We couldn't read that file. Try CSV or Excel.");
    } finally {
      if (generation.current === startedAt) setReading(false);
    }
  }

  /** Every mapping mutation revalidates locally and disarms the dry run. */
  function applyMapping(next: CsvMapping) {
    generation.current += 1;
    setMapping(next);
    setValidation(validateCsv(rows, next, context));
    invalidateReview();
    setCommitErrors(null);
    // Inline fixes were written into the previously mapped name column. Point
    // either name column somewhere else and those repairs no longer apply to
    // what is being validated, so the tally that counts them must reset too —
    // otherwise "11 of 22 fixed" appears above eleven errors that are back.
    if (next.firstName !== mapping?.firstName || next.lastName !== mapping?.lastName) {
      setApplied([]);
    }
    // Whatever the last repair did to the warning count, the note explaining it
    // is about a screen that no longer exists after a remap.
    setWarningsAdded(0);
    if (next.firstName && next.lastName) setColumnsReason(null);
  }

  /**
   * Repairs one cell in place and re-derives the whole screen from it.
   *
   * An edit changes the data being imported, which makes it exactly as
   * dangerous to an in-flight dry run as a mapping change: bumping
   * `generation` and clearing `runId` together is what stops a slow dry-run
   * response, validated against the pre-edit rows, from landing afterwards and
   * re-arming Commit for data that run never saw. Both are required — `runId`
   * alone would still be resurrected by the stale response's `setRunId`.
   *
   * Re-running `validateCsv` wholesale rather than striking the problem out of
   * the summary is deliberate. A restored surname is a grouping input: it can
   * move that guest onto a different invitation, close a "someone may be
   * missing" warning, or change the household totals. Re-validation gets all of
   * that right for free; patching a list would get only the list right.
   *
   * The same path serves a first repair and a correction to one, so a typo is
   * fixed by the identical gesture that made it. `applied` is keyed by sheet
   * line for exactly that reason: re-editing a row updates its entry instead of
   * adding a second one, and the tally stays honest.
   */
  function applyRowFix(fix: RowFix, raw: string) {
    if (!mapping) return;
    const value = raw.trim();
    if (!value) return;

    const index = fix.line - 2; // line 1 is the header
    if (index < 0 || index >= rows.length) return;
    if ((rows[index]?.[fix.column] ?? "").trim() === value) return;

    const next = rows.map((row, i) => (i === index ? { ...row, [fix.column]: value } : row));
    /* Compared against the validation currently on screen, not a re-derived
       one: the number she is watching move is the one that must be explained.
       `summarize` maps warnings one-for-one, so these lengths are the counts
       printed in the section header. */
    const before = validation?.warnings.length ?? 0;
    const revalidated = validateCsv(next, mapping, context);

    generation.current += 1;
    setRows(next);
    setValidation(revalidated);
    invalidateReview();
    setCommitErrors(null);
    setWarningsAdded(Math.max(0, revalidated.warnings.length - before));
    setApplied((list) => {
      const entry: AppliedFix = { line: fix.line, field: fix.field, column: fix.column };
      return list.some((a) => a.line === fix.line)
        ? list.map((a) => (a.line === fix.line ? entry : a))
        : [...list, entry];
    });
  }

  const fixFor = useCallback(
    (problem: ImportProblem) => (mapping ? resolveFix(problem, rows, mapping) : null),
    [rows, mapping],
  );

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
      try {
        let reviewedRun = runId;
        if (!reviewedRun) {
          const dry = await validateCsvImport(filename, rows, mapping);
          if (generation.current !== startedAt) return;
          if (!dry.ok) { invalidateReview(); setCommitErrors(dry.errors); return; }
          reviewedRun = dry.runId; setRunId(dry.runId); setReconciliation(dry.reconciliation);
          if (dry.reconciliation.some(r => r.candidates.length)) return;
        }
        const unresolved = reconciliation.filter(r => r.candidates.length && !decisions.some(d => d.index === r.index));
        if (unresolved.length) { setCommitErrors([{line:0,message:`Choose what to do with ${unresolved.length} possible matches below.`}]); return; }
        const committed = await commitCsvImport(reviewedRun, rows, mapping, decisions);
        if (generation.current !== startedAt) return;
        if (!committed.ok) { setCommitErrors(committed.errors); return; }
        setDone({ households: committed.households, guests: committed.guests, skipped, updated: committed.updated });
        try { sessionStorage.removeItem(draftKey); } catch {}
        setSavedDraft(null); setRunId(null); setStep("done");
      } catch { setCommitErrors([{line:0,message:"The connection was interrupted. Retry this same import to safely check or finish it."}]); }
    });
  }

  function startOver() {
    generation.current += 1;
    try { sessionStorage.removeItem(draftKey); } catch {}
    setSavedDraft(null); setSheets([]); setDraftMessage("");
    setStep("upload");
    setFilename("");
    setHeaders([]);
    setRows([]);
    setMapping(null);
    setValidation(null);
    invalidateReview();
    setCommitErrors(null);
    setDone(null);
    setFileError(null);
    setColumnsOpen(false);
    setColumnsReason(null);
    setApplied([]);
    setWarningsAdded(0);
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
    const csv = Papa.unparse({ fields: [...headers, "Spreadsheet row", "What to fix"], data }, { escapeFormulae: true });
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
        updated={done.updated}
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
      <>
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <button disabled={pending} onClick={saveDraft} className="underline">Save draft in this tab</button>
        <button disabled={pending} onClick={() => {try {localStorage.setItem(`import-columns:${weddingId}:${JSON.stringify(headers)}`,JSON.stringify(mapping));setDraftMessage("Column choices saved for files with these headers.");}catch {setDraftMessage("Could not save column choices in this browser.");}}} className="underline">Remember column choices</button>
        {runId && <button disabled={pending} onClick={()=>{invalidateReview();setCommitErrors(null);}} className="underline">Refresh match review</button>}
        <p role="status">{draftMessage}</p>
      </div>
      <ImportReconciliation items={reconciliation} decisions={decisions} onChange={setDecisions} disabled={pending} />
      <ReviewStep
        importLabel={runId ? "Apply reviewed import" : "Review and import"}
        summary={summary}
        filename={filename}
        importing={pending}
        needsColumns={needsColumns}
        commitErrors={commitErrors}
        onImport={importNow}
        onStartOver={startOver}
        onDownloadProblems={downloadProblems}
        fixFor={fixFor}
        onFix={applyRowFix}
        fixed={fixed}
        warningsAdded={warningsAdded}
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
      </>
    );
  }

  if(step === "sheet") return <section className="rounded-xl border border-hairline p-6"><h2 className="font-display text-2xl">Choose the guest worksheet</h2><p>{filename}</p>{fileError && <p role="alert">{fileError}</p>}<ul>{sheets.map(sheet=><li key={sheet.name}><button className="my-2 rounded-lg border border-hairline p-3" onClick={()=>{try {setFileError(null);loadText(sheet.text);}catch(e){setFileError(e instanceof Error?e.message:"Cannot read worksheet.");}}}>{sheet.name} · {sheet.rows} rows before validation</button></li>)}</ul><button onClick={startOver} className="underline">Choose another file</button></section>;
  return <>{savedDraft && <div className="mb-4"><button onClick={restoreDraft} className="underline">Resume saved import draft</button><button onClick={startOver} className="ml-4 underline">Discard draft</button></div>}<UploadStep onFile={onFile} reading={reading} readingName={filename} error={fileError} /></>;
}

/**
 * CSV goes straight to the tested parser. Excel workbooks are converted to
 * CSV first and then take the identical path, so there is exactly one parsing
 * code path. `xlsx` is already a dependency (the export routes use it) and is
 * loaded dynamically, so it stays out of the bundle unless someone actually
 * drops a workbook.
 */
async function readSpreadsheet(file: File): Promise<Array<{name:string;text:string;rows:number}>> {
  if (!/\.xlsx?$/i.test(file.name)) return [{name:file.name,text:await file.text(),rows:0}];
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  if (!workbook.SheetNames.length) throw new Error("This workbook is empty.");
  return workbook.SheetNames.map(name=>{const sheet=workbook.Sheets[name];return {name,text:XLSX.utils.sheet_to_csv(sheet),rows:sheet['!ref']?Math.max(0,XLSX.utils.decode_range(sheet['!ref']).e.r):0};});
}
