"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as submissions from "@/lib/data/submissions";
import * as activity from "@/lib/data/activity";
import { parseSubmission } from "@/lib/sync/sheet";
import { resolveHouseholdPatch, resolveUndo } from "@/lib/sync/apply";
import { csvReader } from "@/lib/sync/sheet";
import { configuredReader, runSync } from "@/lib/sync/run";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/** Apply this response to an existing household. */
export async function matchToHousehold(submissionId: string, householdId: string): Promise<ActionResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);

  const item = await submissions.byId(scope, submissionId);
  if (!item) return { ok: false, message: "That response is no longer in the inbox." };

  const parsed = parseSubmission(item.raw);
  const detail = await households.getDetail(scope, householdId);
  const { patch, applied, skipped } = resolveHouseholdPatch(
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

  if (Object.keys(patch).length > 0) {
    await households.update(scope, householdId, patch, admin.userId);
  }
  await submissions.markResolved(scope, submissionId, {
    status: "matched",
    householdId,
    applied,
    resolvedBy: admin.userId,
  });
  await activity.log(scope, {
    householdId,
    actorType: "admin",
    actorId: admin.userId,
    action: "sheet.matched",
    payload: { submissionId, fields: Object.keys(applied) },
  });

  revalidatePath("/admin/imports");
  const wrote = Object.keys(applied).length;
  return {
    ok: true,
    message: wrote
      ? `Added ${describeFields(Object.keys(applied))} to ${detail.display_name}.${skipped.length ? ` ${skipped.join(" ")}` : ""}`
      : `${detail.display_name} already had everything from this response.`,
  };
}

/** This is somebody who isn't on the master list yet. */
export async function createHouseholdFrom(submissionId: string): Promise<ActionResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);

  const item = await submissions.byId(scope, submissionId);
  if (!item) return { ok: false, message: "That response is no longer in the inbox." };

  const s = parseSubmission(item.raw);
  const displayName = `${s.first} ${s.last}`.trim() || s.email || "New household";

  const { id } = await households.createWithGuests(
    scope,
    {
      displayName,
      email: s.email || null,
      phone: s.phone || null,
      mailingAddress: s.address ? { raw: s.address, source: "save_the_date" } : null,
      preferredLocale: s.language,
      internalNotes: s.notes ? `[Save the Date ${s.receivedAt}] ${s.notes}` : null,
      rsvpStatus: s.optOut ? "declined" : "pending",
      guests: s.first || s.last ? [{ firstName: s.first, lastName: s.last }] : [],
    },
    admin.userId,
  );

  await submissions.markResolved(scope, submissionId, {
    status: "created",
    householdId: id,
    applied: null,
    resolvedBy: admin.userId,
  });

  revalidatePath("/admin/imports");
  revalidatePath("/admin/guests");
  return {
    ok: true,
    message: s.optOut
      ? `Added ${displayName} and marked them as not coming.`
      : `Added ${displayName} as a new household.`,
  };
}

/** Not a guest — a duplicate, a test entry, someone who filled the form by mistake. */
export async function ignoreSubmission(submissionId: string): Promise<ActionResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  await submissions.markResolved(scope, submissionId, { status: "ignored", resolvedBy: admin.userId });
  revalidatePath("/admin/imports");
  return { ok: true, message: "Filed away. It won't come back." };
}

/** Put a household back the way it was before this response was applied. */
export async function undoSubmission(submissionId: string): Promise<ActionResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);

  const item = await submissions.byId(scope, submissionId);
  if (!item) return { ok: false, message: "That response is no longer here." };

  if (item.status === "created") {
    return {
      ok: false,
      message:
        "This response created a whole household, so undo won't remove it automatically — delete it from the guest list if it shouldn't be there.",
    };
  }

  if (item.household_id && item.applied && Object.keys(item.applied).length) {
    const detail = await households.getDetail(scope, item.household_id);
    const result = resolveUndo(
      {
        email: detail.email,
        phone: detail.phone,
        mailing_address: detail.mailing_address,
        preferred_locale: detail.preferred_locale,
        internal_notes: detail.internal_notes,
        rsvp_status: detail.rsvp_status,
      },
      item.applied,
    );
    if ("declined" in result) return { ok: false, message: result.declined };
    if (Object.keys(result.patch).length) {
      await households.update(scope, item.household_id, result.patch, admin.userId);
    }
  }

  await submissions.reopen(scope, submissionId);
  revalidatePath("/admin/imports");
  return { ok: true, message: "Undone — the response is back in your inbox." };
}

/** Pull the sheet now rather than waiting for the weekly run. */
export async function syncNow(): Promise<ActionResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const reader = configuredReader();
  if (!reader) {
    return {
      ok: false,
      message: "The Save-the-Date sheet isn't connected yet, so there's nothing to check.",
    };
  }
  try {
    const result = await runSync(scope, reader, { actorId: admin.userId });
    revalidatePath("/admin/imports");
    return {
      ok: true,
      message: result.inserted
        ? `Found ${result.inserted} new response${result.inserted === 1 ? "" : "s"}.`
        : "No new responses since last time.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The check failed." };
  }
}

/** Manual fallback while the Google connection is being set up: paste a CSV export. */
export async function importSheetCsv(csv: string): Promise<ActionResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  try {
    const result = await runSync(scope, csvReader(csv), { actorId: admin.userId });
    revalidatePath("/admin/imports");
    return {
      ok: true,
      message: `Read ${result.read} rows — ${result.inserted} new, ${result.autoApplied} matched automatically, ${result.pending} waiting for you.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That file couldn't be read." };
  }
}

function describeFields(fields: string[]): string {
  const names: Record<string, string> = {
    email: "an email address",
    phone: "a phone number",
    mailing_address: "an address",
    preferred_locale: "a language preference",
    internal_notes: "a note",
    rsvp_status: "their reply",
  };
  const readable = fields.map((f) => names[f] ?? f.replace(/_/g, " "));
  if (readable.length === 1) return readable[0];
  return `${readable.slice(0, -1).join(", ")} and ${readable[readable.length - 1]}`;
}
