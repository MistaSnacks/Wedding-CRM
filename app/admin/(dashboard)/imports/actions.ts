"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as importsData from "@/lib/data/imports";
import { validateCsv, type CsvMapping, type RowError } from "@/lib/csv";

export type ValidateResult =
  | { ok: true; runId: string; households: number; guests: number; warnings: RowError[] }
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
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  const stats = {
    households: validation.households.length,
    guests: validation.households.reduce((n, h) => n + h.guests.length, 0),
  };
  const run = await importsData.createRun(scope, filename, "validated", stats);
  return { ok: true, runId: run.id, ...stats, warnings: validation.warnings };
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
  if (!validation.ok) {
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
