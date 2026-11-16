"use server";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as budget from "@/lib/data/budget";
import * as planning from "@/lib/data/planning";
import { parseMoneyInput } from "@/lib/format/money";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
export type HeadcountState = { ok?: boolean; message?: string };
export async function saveHeadcountLink(_state: HeadcountState, form: FormData): Promise<HeadcountState> {
  try {
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    const itemId = z.uuid().parse(form.get("itemId")), eventId = z.uuid().parse(form.get("eventId"));
    const ageScope = z.enum(["all","adult","child","infant"]).parse(form.get("ageScope"));
    const unitPrice = parseMoneyInput(String(form.get("unitPrice") ?? ""));
    if (unitPrice === null) throw new Error("Enter a price per attendee.");
    await budget.getItem(scope, itemId);
    const event = await scope.db.from("events").select("id").eq("wedding_id", scope.weddingId).eq("id", eventId).single();
    if (event.error) throw new Error("Choose an event in this wedding.");
    const { error } = await scope.db.from("budget_headcount_links").upsert({ item_id: itemId, wedding_id: scope.weddingId, event_id: eventId, age_scope: ageScope, unit_price_cents: unitPrice, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/budget/headcount"); return { ok: true, message: "Headcount link saved. Review its calculated estimate below before applying it." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "The link could not be saved." }; }
}
export async function acceptHeadcount(expected: planning.HeadcountProposal): Promise<HeadcountState> {
  try {
    const admin = await requireEditor(); await planning.applyHeadcount(forWedding(admin.weddingId), expected, admin.userId);
    revalidatePath("/admin/budget/headcount"); revalidatePath("/admin/budget"); revalidatePath("/admin"); return { ok: true, message: "Estimate updated. Quoted and contracted amounts were preserved." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "The estimate could not be updated." }; }
}
export async function removeHeadcountLink(itemId: string): Promise<HeadcountState> {
  try {
    const admin = await requireEditor(); const scope = forWedding(admin.weddingId);
    const { error } = await scope.db.from("budget_headcount_links").delete().eq("wedding_id", scope.weddingId).eq("item_id", z.uuid().parse(itemId));
    if (error) throw new Error(error.message); revalidatePath("/admin/budget/headcount"); return { ok: true, message: "Link removed. The last estimate is unchanged." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: error instanceof Error ? error.message : "The link could not be removed." }; }
}
