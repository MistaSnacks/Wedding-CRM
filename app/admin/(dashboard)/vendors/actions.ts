"use server";

import { requireAdmin, requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as vendors from "@/lib/data/vendors";
import * as budget from "@/lib/data/budget";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { parseMoneyInput } from "@/lib/format/money";
import { safeDocumentUrl, validCalendarDay } from "@/lib/data/planning-rules";
import { z } from "zod";
import * as planning from "@/lib/data/planning";

export type VendorFormState = { ok?: boolean; message?: string };
function invalidate(id?: string) {
  revalidatePath("/admin/vendors"); revalidatePath("/admin/budget"); revalidatePath("/admin");
  if (id) revalidatePath(`/admin/vendors/${id}`);
}
export async function saveVendor(id: string | null, _state: VendorFormState, form: FormData): Promise<VendorFormState> {
  let savedId = id;
  try {
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(text("currency"));
    const priority = z.enum(["must_have", "nice_to_have", "optional"]).parse(text("priority"));
    const input: vendors.VendorInput = {
      name: text("name"), role: text("role"), status: text("status"), priority,
      categoryId: text("categoryId") || null, assignedTo: text("assignedTo"),
      contactName: text("contactName"), company: text("company"), email: text("email"), phone: text("phone"),
      website: safeDocumentUrl(text("website")), address: text("address"),
      estimatedCents: parseMoneyInput(text("estimate")), quotedCents: parseMoneyInput(text("quote")),
      contractedCents: parseMoneyInput(text("contract")), currency,
      contractSignedAt: validCalendarDay(text("signed")), bookedAt: validCalendarDay(text("booked")),
      contractUrl: safeDocumentUrl(text("contractUrl")), notes: text("notes"), syncBudget: form.get("syncBudget") === "on",
    };
    const result = id ? await vendors.update(scope, id, input, admin.userId) : await vendors.create(scope, input, admin.userId);
    savedId = result.vendor.id; invalidate(savedId);
    const messages = result.warnings.map(w => w.message);
    if (result.sync) {
      if (result.sync.writes.length) messages.push(`${result.sync.writes.length} linked budget line updated.`);
      if (result.sync.requiresConfirm) messages.push("A manually entered budget price was preserved. Review the linked line to change it.");
      if (result.sync.skipped === "ambiguous_link") messages.push("Several budget lines are linked. Update their contract amounts separately.");
    }
    if (id) return { ok: true, message: ["Vendor saved.", ...messages].join(" ") };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "The vendor could not be saved." }; }
  redirect(`/admin/vendors/${savedId}`);
}

export async function deleteVendor(id: string, typedName: string): Promise<VendorFormState> {
  try {
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    const vendor = await vendors.get(scope, id);
    if (typedName.trim() !== vendor.name) return { ok: false, message: "Type the vendor name to confirm deletion." };
    await vendors.remove(scope, id, admin.userId); invalidate(id);
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "The vendor could not be deleted." }; }
  redirect("/admin/vendors");
}

export async function linkVendorItem(vendorId: string, itemId: string, linked: boolean): Promise<VendorFormState> {
  try {
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    await vendors.get(scope, vendorId);
    const item = await budget.getItem(scope, itemId);
    if (item.vendor_id && item.vendor_id !== vendorId) throw new Error("This line is already linked to another vendor. Unlink it there first.");
    await budget.updateItem(scope, itemId, { vendorId: linked ? vendorId : null }, admin.userId);
    invalidate(vendorId); return { ok: true, message: linked ? "Budget line linked; its amount is unchanged." : "Budget line unlinked." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "The link could not be saved." }; }
}

export async function vendorDeletionImpact(id: string) {
  const admin = await requireAdmin(); return vendors.removalImpact(forWedding(admin.weddingId), id);
}

export async function addPlanningTask(_state: VendorFormState, form: FormData): Promise<VendorFormState> {
  try {
    const admin = await requireEditor();
    const text = (key: string) => String(form.get(key) ?? "").trim();
    await planning.createTask(forWedding(admin.weddingId), { title: text("title"), dueDate: text("dueDate") || null,
      vendorId: text("vendorId") || null, assignedTo: text("assignedTo"), notes: text("notes"), operationId: z.uuid().parse(text("operationId")) }, admin.userId);
    revalidatePath("/admin/vendors/tasks"); return { ok: true, message: "Task added." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "Task could not be added." }; }
}
export async function updatePlanningTask(id: string, patch: { complete?: boolean; dueDate?: string | null; title?: string; assignedTo?: string | null; notes?: string | null }): Promise<VendorFormState> {
  try {
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    const safe = z.object({ complete: z.boolean().optional(), dueDate: z.string().nullable().optional(), title: z.string().trim().min(1).max(300).optional(), assignedTo: z.string().max(200).nullable().optional(), notes: z.string().max(10000).nullable().optional() }).strict().parse(patch);
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (safe.complete !== undefined) row.completed_at = safe.complete ? new Date().toISOString() : null;
    if (safe.dueDate !== undefined) row.due_date = validCalendarDay(safe.dueDate);
    if (safe.title !== undefined) row.title = safe.title;
    if (safe.assignedTo !== undefined) row.assigned_to = safe.assignedTo;
    if (safe.notes !== undefined) row.notes = safe.notes;
    const { error } = await scope.db.from("planning_tasks").update(row).eq("wedding_id", scope.weddingId).eq("id", z.uuid().parse(id)).select("id").single();
    if (error) throw new Error(error.message);
    revalidatePath("/admin/vendors/tasks"); return { ok: true, message: "Task updated." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "Task could not be updated." }; }
}
export async function removePlanningTask(id: string): Promise<VendorFormState> {
  try {
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    const { error } = await scope.db.from("planning_tasks").delete().eq("wedding_id", scope.weddingId).eq("id", z.uuid().parse(id)).select("id").single();
    if (error) throw new Error(error.message); revalidatePath("/admin/vendors/tasks"); return { ok: true, message: "Task removed." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "Task could not be removed." }; }
}
