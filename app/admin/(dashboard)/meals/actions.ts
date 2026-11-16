"use server";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
export async function saveMeal(form: FormData): Promise<{ ok: boolean; message: string }> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    const id = String(form.get("id") ?? "") || null;
    const name = String(form.get("name") ?? "").trim();
    const eventId = String(form.get("event") ?? "") || null;
    if (!name || name.length > 120) return { ok: false, message: "Enter a meal name up to 120 characters." };
    const { error } = await scope.db.rpc("manage_meal_option", { p_wedding_id: scope.weddingId, p_id: id, p_name: name, p_event_id: eventId, p_kids: form.get("kids") === "on", p_remove: form.get("remove") === "true" });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin/meals"); revalidatePath("/rsvp", "layout");
    return { ok: true, message: "Menu saved." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: "The menu change could not be confirmed. Reload to check before retrying." }; }
}
