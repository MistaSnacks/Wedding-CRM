import type { WeddingScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as submissions from "@/lib/data/submissions";
import * as activity from "@/lib/data/activity";
import { env } from "@/lib/env";
import { classify, scoreCandidates, type MatchCandidateInput } from "./match";
import { resolveHouseholdPatch } from "./apply";
import {
  SheetAccessError,
  googleSheetReader,
  parseSubmission,
  rowKey,
  type SheetReader,
} from "./sheet";

export type SyncResult = {
  read: number;
  inserted: number;
  autoApplied: number;
  pending: number;
  /** Present on a dry run: what a real run would have auto-applied. */
  preview?: Array<{ name: string; householdName: string; fields: string[] }>;
};

/**
 * A sheet that reads empty when it previously had rows is an outage — revoked
 * sharing, a renamed tab, a cleared sheet — not "no new responses". Treating it
 * as success would hide exactly the failure we most need to hear about.
 */
export function assertNotSuddenlyEmpty(rowsRead: number, knownRows: number): void {
  if (rowsRead === 0 && knownRows > 0) {
    throw new SheetAccessError(
      "The Save-the-Date sheet came back empty, but we've read responses from it before. Nothing was changed — check that the sheet is still shared with us and the tab still exists.",
      "shape",
    );
  }
}

/**
 * Whether the job may decide this row on its own.
 *
 * Yes for a row we've never seen, and for one still waiting that nobody has
 * ruled on. No for anything a human has already resolved — including a row
 * they resolved and then undid, which is back in the inbox precisely because
 * they want to decide it differently.
 */
export function isOpenForAutoApply(
  seen: { status: string; everResolved: boolean } | undefined,
): boolean {
  if (!seen) return true;
  return seen.status === "pending" && !seen.everResolved;
}

/** Everything the matcher compares against, flattened once per run. */
export async function loadCandidatePool(scope: WeddingScope): Promise<MatchCandidateInput[]> {
  const rows = await households.list(scope);
  return rows.flatMap((h) =>
    h.guests.map((g) => ({
      guestId: g.id,
      firstName: g.first_name,
      lastName: g.last_name,
      householdId: h.id,
      householdName: h.display_name,
      householdEmail: h.email,
    })),
  );
}

/**
 * Reconciles the whole sheet, every run.
 *
 * Not a delta: a delta would need durable cursor state and would silently lose
 * a week if an invocation were skipped. Vercel cron delivery is best-effort, so
 * the job is written to be re-runnable instead — `row_key` makes a second pass
 * over the same rows a no-op, a double-fire changes nothing, and a missed week
 * is picked up by the next run.
 */
export async function runSync(
  scope: WeddingScope,
  reader: SheetReader,
  opts: { actorId?: string; dryRun?: boolean } = {},
): Promise<SyncResult> {
  const rows = await reader();
  const known = await submissions.listKeys(scope);

  assertNotSuddenlyEmpty(rows.length, known.size);

  const keyed = rows.map((row) => ({ row, key: rowKey(row) }));
  const fresh = keyed.filter((r) => !known.has(r.key));

  if (!opts.dryRun && fresh.length) {
    await submissions.upsertMany(
      scope,
      fresh.map((r) => ({ rowKey: r.key, raw: r.row, receivedAt: null })),
    );
  }

  // Auto-apply considers newly-seen rows and rows still waiting that no human
  // has ever ruled on. A row someone resolved and then undid stays in the inbox
  // for them to decide again, but the job will not quietly re-apply the
  // decision they just reversed.
  const open = keyed.filter((r) => isOpenForAutoApply(known.get(r.key)));
  const ids = opts.dryRun ? new Map<string, string>() : await idsByKey(scope);
  const pool = await loadCandidatePool(scope);

  let autoApplied = 0;
  const preview: NonNullable<SyncResult["preview"]> = [];

  for (const { row, key } of open) {
    const parsed = parseSubmission(row);
    // A row too damaged to name anyone stays in the inbox as its own entry
    // rather than crashing the run.
    if (!parsed.first && !parsed.last && !parsed.email) continue;

    const decision = classify(parsed, scoreCandidates(parsed, pool), pool);
    if (decision.bucket !== "auto_email") continue;

    const detail = await households.getDetail(scope, decision.householdId);
    const { patch, applied } = resolveHouseholdPatch(
      {
        email: detail.email,
        phone: detail.phone,
        mailing_address: detail.mailing_address,
        preferred_locale: detail.preferred_locale,
        internal_notes: detail.internal_notes,
        rsvp_status: detail.rsvp_status,
      },
      parsed,
    );

    if (opts.dryRun) {
      preview.push({
        name: `${parsed.first} ${parsed.last}`.trim(),
        householdName: detail.display_name,
        fields: Object.keys(patch),
      });
      autoApplied += 1;
      continue;
    }

    if (Object.keys(patch).length > 0) {
      await households.update(scope, decision.householdId, patch, opts.actorId);
    }
    const id = ids.get(key);
    if (id) {
      await submissions.markResolved(scope, id, {
        status: "matched",
        householdId: decision.householdId,
        applied,
        resolvedBy: opts.actorId ?? null,
      });
    }
    await activity.log(scope, {
      householdId: decision.householdId,
      actorType: "system",
      action: "sheet.auto_applied",
      payload: { submissionId: id ?? null, reason: decision.reason, fields: Object.keys(applied) },
    });
    autoApplied += 1;
  }

  return {
    read: rows.length,
    inserted: opts.dryRun ? 0 : fresh.length,
    autoApplied,
    pending: opts.dryRun
      ? open.length - autoApplied
      : (await submissions.listByStatus(scope, "pending")).length,
    ...(opts.dryRun ? { preview } : {}),
  };
}

async function idsByKey(scope: WeddingScope): Promise<Map<string, string>> {
  const keys = await submissions.listKeys(scope);
  return new Map([...keys].map(([key, v]) => [key, v.id]));
}

/** The configured live reader, or null when the service account isn't set up yet. */
export function configuredReader(): SheetReader | null {
  const e = env();
  if (!e.GOOGLE_SERVICE_ACCOUNT_EMAIL || !e.GOOGLE_PRIVATE_KEY || !e.SAVE_THE_DATE_SHEET_ID) return null;
  return googleSheetReader({
    clientEmail: e.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: e.GOOGLE_PRIVATE_KEY,
    sheetId: e.SAVE_THE_DATE_SHEET_ID,
    range: e.SAVE_THE_DATE_RANGE,
  });
}
