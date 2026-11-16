import type { WeddingScope } from "./scope";
import { readAll } from "./query";
import type { SheetSubmissionRow, SheetSubmissionStatus } from "@/lib/types";

const COLUMNS =
  "id, wedding_id, source, row_key, raw, received_at, status, household_id, applied, resolved_by, resolved_at, created_at";

export type NewSubmission = {
  rowKey: string;
  raw: Record<string, string>;
  receivedAt: string | null;
};

/**
 * Atomically ingest new rows and archive/reopen changed content for human review.
 * Identical retries leave both resolved state and undo history unchanged.
 *
 * Returns how many rows were newly inserted.
 */
export async function upsertMany(scope: WeddingScope, rows: NewSubmission[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await scope.db.rpc("ingest_sheet_rows", { p_wedding: scope.weddingId, p_rows: rows });
  if (error) throw new Error(error.message);
  return data as number;
}

/**
 * Row keys already stored, with the state of each — the basis for "what's new".
 *
 * `everResolved` is what makes undo stick: an undone item goes back to
 * `pending` so it can be decided again, but the sync must not quietly re-apply
 * the decision a human just reversed.
 */
export async function listKeys(
  scope: WeddingScope,
): Promise<Map<string, { id: string; status: SheetSubmissionStatus; everResolved: boolean }>> {
  const data = await readAll<{id:string;row_key:string;status:SheetSubmissionStatus;resolved_at:string|null}>(()=>scope.db
    .from("sheet_submissions").select("id, row_key, status, resolved_at").eq("wedding_id", scope.weddingId).eq("source", "save_the_date").order("id"));
  return new Map(
    (data ?? []).map((r) => [
      r.row_key as string,
      { id: r.id as string, status: r.status as SheetSubmissionStatus, everResolved: r.resolved_at !== null },
    ]),
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
  return await readAll<SheetSubmissionRow>(()=>scope.db.from("sheet_submissions").select(COLUMNS)
    .eq("wedding_id",scope.weddingId).eq("status",status).order("received_at",{ascending:true,nullsFirst:false}).order("id"));
}

/** Resolved items that wrote something — the reversible activity list. */
export async function listApplied(scope: WeddingScope): Promise<SheetSubmissionRow[]> {
  const { data, error } = await scope.db
    .from("sheet_submissions")
    .select(COLUMNS)
    .eq("wedding_id", scope.weddingId)
    .in("status", ["matched", "created"])
    .order("resolved_at", { ascending: false })
    .limit(12);
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

/**
 * Undo returns an item to the inbox so the decision can be made again.
 *
 * `resolved_at` is deliberately left set. It is the record that a human has
 * already ruled on this row, which stops the next sync from re-applying the
 * very decision they just reversed.
 */
export async function reopen(scope: WeddingScope, id: string): Promise<void> {
  const { error } = await scope.db
    .from("sheet_submissions")
    .update({ status: "pending", household_id: null, applied: null })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** One transaction validates old values, applies data, archives history and resolves the inbox row. */
export async function resolve(scope: WeddingScope, args: { id: string; householdId?: string; action: "match"|"auto"|"undo"|"ignore"|"create"; applied?: Record<string,{from:unknown;to:unknown}>; actorId?: string; newHousehold?: Record<string,unknown>; expectedRaw?: Record<string,string> }): Promise<string | null> {
  const { data, error } = await scope.db.rpc("resolve_sheet_submission", { p_wedding: scope.weddingId, p_id: args.id,
    p_household: args.householdId ?? null, p_action: args.action, p_applied: args.applied ?? {}, p_actor: args.actorId ?? null, p_new: args.newHousehold ?? null, p_expected_raw:args.expectedRaw ?? null });
  if (error) throw new Error(error.message);
  return data as string | null;
}
export async function latestRun(scope: WeddingScope) {
 const { data, error } = await scope.db.from("sync_runs").select("state,started_at,finished_at,error,result").eq("wedding_id",scope.weddingId).order("started_at",{ascending:false}).limit(1).maybeSingle();
 if(error)throw new Error(error.message);return data;
}
