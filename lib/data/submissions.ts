import type { WeddingScope } from "./scope";
import type { SheetSubmissionRow, SheetSubmissionStatus } from "@/lib/types";

const COLUMNS =
  "id, wedding_id, source, row_key, raw, received_at, status, household_id, applied, resolved_by, resolved_at, created_at";

export type NewSubmission = {
  rowKey: string;
  raw: Record<string, string>;
  receivedAt: string | null;
};

/**
 * Insert the rows we have not seen before and leave every existing row exactly
 * as it is — including its status. This is what makes re-running the job safe:
 * a cron double-fire changes nothing, and a resolved submission never reopens.
 *
 * Returns how many rows were newly inserted.
 */
export async function upsertMany(scope: WeddingScope, rows: NewSubmission[]): Promise<number> {
  if (!rows.length) return 0;

  const { data: existing, error: readErr } = await scope.db
    .from("sheet_submissions")
    .select("row_key")
    .eq("wedding_id", scope.weddingId)
    .eq("source", "save_the_date");
  if (readErr) throw new Error(readErr.message);

  const seen = new Set((existing ?? []).map((r) => r.row_key as string));
  const fresh = rows.filter((r) => !seen.has(r.rowKey));
  if (!fresh.length) return 0;

  const { error } = await scope.db.from("sheet_submissions").insert(
    fresh.map((r) => ({
      wedding_id: scope.weddingId,
      source: "save_the_date" as const,
      row_key: r.rowKey,
      raw: r.raw,
      received_at: r.receivedAt,
    })),
  );
  if (error) throw new Error(error.message);
  return fresh.length;
}

/** Row keys already stored, with the state of each — the basis for "what's new". */
export async function listKeys(
  scope: WeddingScope,
): Promise<Map<string, { id: string; status: SheetSubmissionStatus }>> {
  const { data, error } = await scope.db
    .from("sheet_submissions")
    .select("id, row_key, status")
    .eq("wedding_id", scope.weddingId)
    .eq("source", "save_the_date");
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((r) => [r.row_key as string, { id: r.id as string, status: r.status as SheetSubmissionStatus }]),
  );
}

export async function countAll(scope: WeddingScope): Promise<number> {
  const { count, error } = await scope.db
    .from("sheet_submissions")
    .select("*", { count: "exact", head: true })
    .eq("wedding_id", scope.weddingId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function listByStatus(
  scope: WeddingScope,
  status: SheetSubmissionStatus,
): Promise<SheetSubmissionRow[]> {
  const { data, error } = await scope.db
    .from("sheet_submissions")
    .select(COLUMNS)
    .eq("wedding_id", scope.weddingId)
    .eq("status", status)
    .order("received_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SheetSubmissionRow[];
}

/** Resolved items that wrote something — the reversible activity list. */
export async function listApplied(scope: WeddingScope): Promise<SheetSubmissionRow[]> {
  const { data, error } = await scope.db
    .from("sheet_submissions")
    .select(COLUMNS)
    .eq("wedding_id", scope.weddingId)
    .in("status", ["matched", "created"])
    .order("resolved_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as SheetSubmissionRow[];
}

export async function byId(scope: WeddingScope, id: string): Promise<SheetSubmissionRow | null> {
  const { data, error } = await scope.db
    .from("sheet_submissions")
    .select(COLUMNS)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SheetSubmissionRow) ?? null;
}

export async function markResolved(
  scope: WeddingScope,
  id: string,
  patch: {
    status: SheetSubmissionStatus;
    householdId?: string | null;
    applied?: Record<string, { from: unknown; to: unknown }> | null;
    resolvedBy?: string | null;
  },
): Promise<void> {
  const { error } = await scope.db
    .from("sheet_submissions")
    .update({
      status: patch.status,
      household_id: patch.householdId ?? null,
      applied: patch.applied ?? null,
      resolved_by: patch.resolvedBy ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Undo returns an item to the inbox so the decision can be made again. */
export async function reopen(scope: WeddingScope, id: string): Promise<void> {
  const { error } = await scope.db
    .from("sheet_submissions")
    .update({ status: "pending", household_id: null, applied: null, resolved_by: null, resolved_at: null })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
