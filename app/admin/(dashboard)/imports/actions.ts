"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as importsData from "@/lib/data/imports";
import { validateCsv, type CsvMapping } from "@/lib/csv";

export type CommitResult =
  | { ok: true; households: number; guests: number }
  | { ok: false; errors: Array<{ line: number; message: string }> };

/** Server-side re-validation + atomic-ish commit of a parsed CSV. */
export async function commitCsvImport(
  filename: string,
  rows: Record<string, string>[],
  mapping: CsvMapping,
): Promise<CommitResult> {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);

  const validation = validateCsv(rows, mapping);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const run = await importsData.createRun(scope, filename);
  try {
    const result = await importsData.commitHouseholds(scope, run.id, validation.households, admin.userId);
    await importsData.finishRun(scope, run.id, "committed", result);
    revalidatePath("/admin/guests");
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    await importsData.finishRun(scope, run.id, "failed", null, { message });
    return { ok: false, errors: [{ line: 0, message }] };
  }
}
