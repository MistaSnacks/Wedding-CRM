"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireEditor, type AdminContext } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as guests from "@/lib/data/guests";
import * as rsvpData from "@/lib/data/rsvp";
import {
  householdLimitError,
  postgresIdSchema,
} from "@/lib/domain/rsvp-validation";
import { z } from "zod";
import { normalizeHouseholdRules } from "@/lib/domain/invitation-rules";
import { resolveAddressUpdate } from "@/lib/domain/mailing-address";
import type { SubmitRsvpPayload, AgeType, GuestRow } from "@/lib/types";

export async function createHousehold(formData: FormData): Promise<void> {
  const admin = await requireEditor();
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) redirect("/admin/guests?new=1");
  await createHouseholdRecord(admin, formData);
  revalidatePath("/admin/guests");
  redirect("/admin/guests");
}

/**
 * The validation and write behind "New household". Shared by the Guests page
 * (which then redirects) and the 3D venue editor (which needs the new id).
 */
async function createHouseholdRecord(
  admin: AdminContext,
  formData: FormData,
): Promise<string> {
  const scope = forWedding(admin.weddingId);

  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) throw new Error("Enter a household name.");

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

  if (!guestNames.length) throw new Error("Add at least one guest name.");
  const email = String(formData.get("email") ?? "").trim();
  if (email && !z.email().safeParse(email).success)
    throw new Error("Enter a valid email address.");
  const { id } = await households.createWithGuests(
    scope,
    {
      displayName,
      primaryContactName:
        String(formData.get("primary_contact_name") ?? "") || undefined,
      email: email || undefined,
      phone: String(formData.get("phone") ?? "") || undefined,
      maxPartySize: rules.maxPartySize,
      plusOneSlots: rules.plusOneSlots,
      preferredLocale: z
        .enum(["en", "es", "vi"])
        .parse(formData.get("preferred_locale") ?? "en"),
      guests: guestNames,
      operationId: String(formData.get("operation_id") ?? crypto.randomUUID()),
    },
    admin.userId,
  );
  return id;
}

export async function updateHousehold(
  householdId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const detail = await households.getDetail(scope, householdId);
  const proposed = {
    maxPartySize: Number(formData.get("max_party_size")),
    plusOneSlots: Number(formData.get("plus_one_slots")),
  };
  const limitError = householdLimitError(
    proposed.maxPartySize,
    proposed.plusOneSlots,
    detail.guests,
  );
  if (limitError) throw new Error(limitError);
  const rules = normalizeHouseholdRules(
    proposed,
    detail.guests.filter((g) => g.origin === "named").length,
  );
  const email = z
    .union([z.literal(""), z.email()])
    .parse(String(formData.get("email") ?? ""));
  const preferred_locale = z
    .enum(["en", "es", "vi"])
    .parse(formData.get("preferred_locale") ?? detail.preferred_locale);
  // The form carries the address it was rendered with; comparing against it
  // means an untouched textarea never overwrites (or re-sources) the stored value.
  const addressUpdate = resolveAddressUpdate(
    {
      raw: String(formData.get("mailing_address_prev") ?? ""),
      source: "admin",
    },
    String(formData.get("mailing_address") ?? ""),
  );
  await households.update(
    scope,
    householdId,
    {
      display_name:
        String(formData.get("display_name") ?? "").trim() || undefined,
      email: email || null,
      primary_contact_name:
        String(formData.get("primary_contact_name") ?? "").trim() || null,
      preferred_locale,
      tags: String(formData.get("tags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      phone: String(formData.get("phone") ?? "") || null,
      max_party_size: rules.maxPartySize,
      plus_one_slots: rules.plusOneSlots,
      internal_notes: String(formData.get("internal_notes") ?? "") || null,
      ...(addressUpdate !== undefined
        ? { mailing_address: addressUpdate }
        : {}),
    },
    admin.userId,
  );
  revalidatePath(`/admin/guests/${householdId}`);
}

export async function addGuest(
  householdId: string,
  formData: FormData,
): Promise<void> {
  const admin = await requireEditor();
  const firstName = String(formData.get("first_name") ?? "").trim();
  if (!firstName) return;
  await addGuestRecord(admin, householdId, formData);
  revalidatePath(`/admin/guests/${householdId}`);
}

/** The validation and write behind "Add guest", shared with the 3D venue editor. */
async function addGuestRecord(
  admin: AdminContext,
  householdId: string,
  formData: FormData,
): Promise<GuestRow> {
  const scope = forWedding(admin.weddingId);
  const firstName = String(formData.get("first_name") ?? "").trim();
  if (!firstName) throw new Error("Enter the guest's first name.");
  const guest = await guests.create(
    scope,
    {
      householdId,
      operationId: String(formData.get("operation_id") ?? crypto.randomUUID()),
      firstName,
      lastName: String(formData.get("last_name") ?? "").trim() || "—",
      ageType:
        (String(formData.get("age_type") ?? "adult") as AgeType) ?? "adult",
      relationship: String(formData.get("relationship") ?? "") || undefined,
    },
    admin.userId,
  );
  // The new named guest may outgrow the party-size cap — keep it consistent.
  const detail = await households.getDetail(scope, householdId);
  const rules = normalizeHouseholdRules(
    {
      maxPartySize: detail.max_party_size,
      plusOneSlots: detail.plus_one_slots,
    },
    detail.guests.filter((g) => g.origin === "named").length,
  );
  if (rules.maxPartySize !== detail.max_party_size) {
    await households.update(
      scope,
      householdId,
      { max_party_size: rules.maxPartySize },
      admin.userId,
    );
  }
  return guest;
}

export async function deleteHousehold(householdId: string): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  await households.remove(scope, householdId, admin.userId);
  revalidatePath("/admin/guests");
  redirect("/admin/guests");
}

export async function removeGuest(
  householdId: string,
  guestId: string,
): Promise<void> {
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
    responses: [
      {
        guest_id: guestId,
        event_id: eventId,
        attending,
        meal_option_id: mealOptionId ?? null,
      },
    ],
    via: "admin",
    actor_id: admin.userId,
    complete: false,
  };
  await rsvpData.submit(scope, householdId, payload);
  revalidatePath(`/admin/guests/${householdId}`);
}

export type GuestActionResult = { ok: boolean; message: string };
export async function saveHouseholdForm(
  householdId: string,
  _previous: GuestActionResult | null,
  formData: FormData,
): Promise<GuestActionResult> {
  try {
    await updateHousehold(householdId, formData);
    return { ok: true, message: "Household saved." };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not save. Your changes are still here.",
    };
  }
}
export async function saveGuestForm(
  guestId: string,
  _previous: GuestActionResult | null,
  formData: FormData,
): Promise<GuestActionResult> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const parsed = z
    .object({
      first_name: z.string().trim().min(1).max(120),
      last_name: z.string().trim().min(1).max(120),
      age_type: z.enum(["adult", "child", "infant"]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: "Enter a first and last name and a valid age group.",
    };
  try {
    await guests.update(
      scope,
      guestId,
      {
        ...parsed.data,
        relationship: String(formData.get("relationship") ?? "") || null,
        is_vip: formData.get("is_vip") === "on",
        dietary_restrictions:
          String(formData.get("dietary_restrictions") ?? "") || null,
        allergies: String(formData.get("allergies") ?? "") || null,
        accessibility_needs:
          String(formData.get("accessibility_needs") ?? "") || null,
        internal_notes: String(formData.get("internal_notes") ?? "") || null,
      },
      admin.userId,
    );
    revalidatePath("/admin/guests", "layout");
    return {
      ok: true,
      message: "Guest saved. RSVP and seating history retained.",
    };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not save guest.",
    };
  }
}
export async function transferGuests(
  sourceId: string,
  _previous: GuestActionResult | null,
  formData: FormData,
): Promise<GuestActionResult> {
  const admin = await requireEditor();
  if (formData.get("reviewed") !== "on")
    return {
      ok: false,
      message: "Review the guests and destination, then confirm the move.",
    };
  const ids = formData.getAll("guest_ids").map(String);
  if (!ids.length) return { ok: false, message: "Select at least one guest." };
  const parsed = z.array(postgresIdSchema).safeParse(ids);
  if (!parsed.success)
    return { ok: false, message: "Invalid guest selection." };
  const scope = forWedding(admin.weddingId);
  const { data, error } = await scope.db.rpc("transfer_household_guests", {
    p_wedding_id: admin.weddingId,
    p_source: sourceId,
    p_target: String(formData.get("target") ?? "") || null,
    p_guest_ids: ids,
    p_new_name: String(formData.get("new_name") ?? ""),
    p_actor_id: admin.userId,
    p_operation_id: String(formData.get("operation_id")),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/guests", "layout");
  return {
    ok: true,
    message: `Guests moved. Open the destination household in the guest list. Existing RSVP links for that household are unchanged.`,
  };
}
export async function restoreHousehold(id: string): Promise<void> {
  const admin = await requireEditor();
  await households.restore(forWedding(admin.weddingId), id, admin.userId);
  revalidatePath("/admin/guests", "layout");
}

export async function createHouseholdForm(
  _previous: GuestActionResult | null,
  formData: FormData,
): Promise<GuestActionResult> {
  try {
    await createHousehold(formData);
    return { ok: true, message: "Household created." };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not create household.",
    };
  }
}
export async function addGuestForm(
  householdId: string,
  _previous: GuestActionResult | null,
  formData: FormData,
): Promise<GuestActionResult> {
  try {
    await addGuest(householdId, formData);
    return { ok: true, message: "Guest added." };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not add guest.",
    };
  }
}

export type SeatingGuestResult = {
  ok: boolean;
  message: string;
  guest?: { id: string; name: string; household: string; householdId: string };
  /** False when the guest was added but cannot sit at this event yet. */
  seatable?: boolean;
};

/**
 * "Add someone to the list" in the 3D venue editor. It uses the same writes
 * and checks as the Guests page: a chosen household gets a new guest
 * (`addGuestRecord`), otherwise a new household is made (`createHouseholdRecord`).
 *
 * Seating only accepts invited guests who said yes, so the guest is then
 * marked attending for this event, the same write as "Set response" on the
 * household page. If the household is not invited to the event, the guest
 * stays on the list and the message says why they cannot sit yet.
 */
export async function addGuestForSeating(input: {
  name: string;
  family?: string;
  householdId?: string | null;
  eventId: string;
  operationId?: string;
}): Promise<SeatingGuestResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Type the guest's name first.").max(120),
        family: z.string().trim().max(120).optional(),
        householdId: postgresIdSchema.nullish(),
        eventId: postgresIdSchema,
        operationId: postgresIdSchema.optional(),
      })
      .safeParse(input);
    if (!parsed.success)
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the guest's name." };
    const { name, family, householdId, eventId } = parsed.data;
    const operationId = parsed.data.operationId ?? crypto.randomUUID();

    const { data: event, error: eventError } = await scope.db
      .from("events")
      .select("id,name")
      .eq("wedding_id", scope.weddingId)
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (!event) return { ok: false, message: "That event is not part of this wedding." };

    const [first, ...rest] = name.replace(/\s+/g, " ").split(" ");
    let hid: string;
    let guestId: string;
    if (householdId) {
      const form = new FormData();
      form.set("first_name", first);
      form.set("last_name", rest.join(" "));
      form.set("operation_id", operationId);
      const guest = await addGuestRecord(admin, householdId, form);
      hid = householdId;
      guestId = guest.id;
    } else {
      const form = new FormData();
      form.set("display_name", family || `${rest.at(-1) ?? first} family`);
      form.set("guest_names", name);
      form.set("max_party_size", "1");
      form.set("plus_one_slots", "0");
      form.set("operation_id", operationId);
      hid = await createHouseholdRecord(admin, form);
      const { data: made, error } = await scope.db
        .from("guests")
        .select("id")
        .eq("wedding_id", scope.weddingId)
        .eq("household_id", hid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!made) throw new Error("The guest was not saved. Try again.");
      guestId = made.id;
    }

    const { data: hh } = await scope.db
      .from("households")
      .select("display_name")
      .eq("wedding_id", scope.weddingId)
      .eq("id", hid)
      .maybeSingle();
    const guest = {
      id: guestId,
      name: name.replace(/\s+/g, " "),
      household: hh?.display_name ?? family ?? "Guests",
      householdId: hid,
    };

    let seatable = true;
    try {
      await rsvpData.submit(scope, hid, {
        responses: [{ guest_id: guestId, event_id: eventId, attending: "yes", meal_option_id: null }],
        via: "admin",
        actor_id: admin.userId,
        complete: false,
      });
    } catch (error) {
      unstable_rethrow(error);
      seatable = false;
    }

    revalidatePath("/admin/guests", "layout");
    revalidatePath("/admin/seating");
    revalidatePath("/venue-preview");
    return {
      ok: true,
      guest,
      seatable,
      message: seatable
        ? `${guest.name} is on the guest list and marked as coming to ${event.name}. Find them under “Need a seat”.`
        : `${guest.name} is on the guest list, but they cannot have a seat at ${event.name} yet. Seats are only for invited guests who are coming. Open their household on the Guests page to invite them or set their reply.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not add the guest. Try again.",
    };
  }
}
