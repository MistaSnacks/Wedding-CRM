"use server";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { hidingLeavesNoChoice, type MenuDish } from "@/lib/domain/menu-rules";
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

/** Takes a dish off the guest menu, or puts it back. Guests who chose it keep it. */
export async function setMealShown(form: FormData): Promise<{ ok: boolean; message: string }> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    const id = String(form.get("id") ?? "");
    const shown = form.get("shown") === "true";
    if (!id) return { ok: false, message: "Choose a dish first." };
    if (!shown) {
      const [dishes, events] = await Promise.all([
        scope.db.from("meal_options").select("id, event_id, is_kids_meal, is_active").eq("wedding_id", scope.weddingId),
        scope.db.from("events").select("id").eq("wedding_id", scope.weddingId).eq("rsvp_enabled", true),
      ]);
      if (dishes.error || events.error) return { ok: false, message: "The menu could not be read. Reload and try again." };
      const eventIds = (events.data ?? []).map((e) => e.id as string);
      if (hidingLeavesNoChoice((dishes.data ?? []) as MenuDish[], eventIds, id))
        return { ok: false, message: "Guests need at least one dish to pick. Show or add another dish first, then hide this one." };
    }
    const { data, error } = await scope.db
      .from("meal_options")
      .update({ is_active: shown })
      .eq("wedding_id", scope.weddingId)
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, message: error.message };
    if (!data?.length) return { ok: false, message: "That dish is no longer on the menu. Reload the page." };
    revalidatePath("/admin/meals"); revalidatePath("/rsvp", "layout");
    return { ok: true, message: shown ? "Guests can pick this dish again." : "Hidden from guests. Guests who already chose it keep it." };
  } catch (error) { unstable_rethrow(error); return { ok: false, message: "The menu change could not be confirmed. Reload to check before retrying." }; }
}
