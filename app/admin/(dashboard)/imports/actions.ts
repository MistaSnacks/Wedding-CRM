"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as importsData from "@/lib/data/imports";
import { validateCsv, type CsvMapping, type RowError } from "@/lib/csv";

export type ValidateResult =
  | { ok: true; runId: string; households: number; guests: number; errors: RowError[]; warnings: RowError[] }
  | { ok: false; errors: RowError[]; warnings: RowError[] };

export type CommitResult =
  | { ok: true; households: number; guests: number }
  | { ok: false; errors: RowError[] };

/** Dry run: persists an `imports` row with status 'validated', writes no domain data. */
export async function validateCsvImport(
  filename: string,
  rows: Record<string, string>[],
  mapping: CsvMapping,
): Promise<ValidateResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const context = await importsData.loadImportContext(scope);
  const validation = validateCsv(rows, mapping, context);
  // Partial import: a bad row is dropped by the engine before grouping, so the
  // households that survive are complete and valid on their own. Blocking the
  // whole file on them made twelve missing last names hold 246 guests hostage.
  // We only refuse when there is genuinely nothing to import — no name columns
  // mapped, or every row unusable.
  if (validation.households.length === 0) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  const stats = {
    households: validation.households.length,
    guests: validation.households.reduce((n, h) => n + h.guests.length, 0),
  };
  const run = await importsData.createRun(scope, filename, "validated", stats);
  return { ok: true, runId: run.id, ...stats, errors: validation.errors, warnings: validation.warnings };
}

/** Commits a previously validated run. Re-validates server-side against the same context. */
export async function commitCsvImport(
  runId: string,
  rows: Record<string, string>[],
  mapping: CsvMapping,
): Promise<CommitResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const context = await importsData.loadImportContext(scope);

  const validation = validateCsv(rows, mapping, context);
  // Same partial-import gate as the dry run above: commit the valid households
  // and leave the unusable rows behind. Only a file with nothing importable in
  // it fails outright.
  if (validation.households.length === 0) {
    await importsData.finishRun(scope, runId, "failed", null, { errors: validation.errors });
    return { ok: false, errors: validation.errors };
  }

  try {
    const result = await importsData.commitHouseholds(scope, runId, validation.households, admin.userId);
    revalidatePath("/admin/guests");
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    await importsData.finishRun(scope, runId, "failed", null, { message });
    return { ok: false, errors: [{ line: 0, message }] };
  }
}
