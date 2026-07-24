"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as guests from "@/lib/data/guests";
import * as rsvpData from "@/lib/data/rsvp";
import * as imports from "@/lib/data/imports";
import { normalizeHouseholdRules } from "@/lib/domain/invitation-rules";
import type { SubmitRsvpPayload, AgeType } from "@/lib/types";

export async function createHousehold(formData: FormData): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);

  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) redirect("/admin/guests?new=1");

  const guestNames = String(formData.get("guest_names") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [first, ...rest] = line.split(/\s+/);
      return { firstName: first, lastName: rest.join(" ") || "—" };
    });

  // A household must always be able to use what it was granted: raise
  // max_party_size so named guests + plus-one slots fit.
  const rules = normalizeHouseholdRules(
    {
      maxPartySize: Number(formData.get("max_party_size") ?? 2),
      plusOneSlots: Number(formData.get("plus_one_slots") ?? 0),
    },
    guestNames.length,
  );

  await imports.commitHouseholds(
    scope,
    "manual",
    [
      {
        displayName,
        primaryContactName: String(formData.get("primary_contact_name") ?? "") || undefined,
        email: String(formData.get("email") ?? "") || undefined,
        phone: String(formData.get("phone") ?? "") || undefined,
        maxPartySize: rules.maxPartySize,
        plusOneSlots: rules.plusOneSlots,
        preferredLocale: String(formData.get("preferred_locale") ?? "en"),
        guests: guestNames,
      },
    ],
    admin.userId,
  );

  revalidatePath("/admin/guests");
  redirect("/admin/guests");
}

export async function updateHousehold(householdId: string, formData: FormData): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const rules = normalizeHouseholdRules(
    {
      maxPartySize: Number(formData.get("max_party_size") ?? 2),
      plusOneSlots: Number(formData.get("plus_one_slots") ?? 0),
    },
    await guests.countNamed(scope, householdId),
  );
  await households.update(
    scope,
    householdId,
    {
      display_name: String(formData.get("display_name") ?? "").trim() || undefined,
      email: String(formData.get("email") ?? "") || null,
      phone: String(formData.get("phone") ?? "") || null,
      max_party_size: rules.maxPartySize,
      plus_one_slots: rules.plusOneSlots,
      internal_notes: String(formData.get("internal_notes") ?? "") || null,
    },
    admin.userId,
  );
  revalidatePath(`/admin/guests/${householdId}`);
}

export async function addGuest(householdId: string, formData: FormData): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const firstName = String(formData.get("first_name") ?? "").trim();
  if (!firstName) return;
  await guests.create(
    scope,
    {
      householdId,
      firstName,
      lastName: String(formData.get("last_name") ?? "").trim() || "—",
      ageType: (String(formData.get("age_type") ?? "adult") as AgeType) ?? "adult",
      relationship: String(formData.get("relationship") ?? "") || undefined,
    },
    admin.userId,
  );
  // The new named guest may outgrow the party-size cap — keep it consistent.
  const detail = await households.getDetail(scope, householdId);
  const rules = normalizeHouseholdRules(
    { maxPartySize: detail.max_party_size, plusOneSlots: detail.plus_one_slots },
    detail.guests.filter((g) => g.origin === "named").length,
  );
  if (rules.maxPartySize !== detail.max_party_size) {
    await households.update(scope, householdId, { max_party_size: rules.maxPartySize }, admin.userId);
  }
  revalidatePath(`/admin/guests/${householdId}`);
}

export async function deleteHousehold(householdId: string): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  await households.remove(scope, householdId, admin.userId);
  revalidatePath("/admin/guests");
  redirect("/admin/guests");
}

export async function removeGuest(householdId: string, guestId: string): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  await guests.remove(scope, guestId, admin.userId);
  revalidatePath(`/admin/guests/${householdId}`);
}

/** Admin RSVPs on a household's behalf — same rules engine, via 'admin'. */
export async function adminSetResponse(
  householdId: string,
  guestId: string,
  eventId: string,
  attending: "yes" | "no" | "pending",
  mealOptionId?: string | null,
): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const payload: SubmitRsvpPayload = {
    responses: [{ guest_id: guestId, event_id: eventId, attending, meal_option_id: mealOptionId ?? null }],
    via: "admin",
    complete: false,
  };
  await rsvpData.submit(scope, householdId, payload);
  revalidatePath(`/admin/guests/${householdId}`);
}
