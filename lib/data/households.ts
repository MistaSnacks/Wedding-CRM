import type { WeddingScope } from "./scope";
import type {
  HouseholdRow,
  GuestRow,
  EventRow,
  ResponseRow,
  AnswerRow,
  ActivityRow,
  HouseholdFilter,
} from "@/lib/types";
import * as activity from "./activity";
import { liveResponses } from "./event-rules";

const HOUSEHOLD_COLS =
  "id, wedding_id, display_name, primary_contact_name, email, phone, mailing_address, invite_code, access_token, max_party_size, plus_one_slots, rsvp_status, preferred_locale, tags, internal_notes";

export type HouseholdWithGuests = HouseholdRow & { guests: GuestRow[] };

export type HouseholdDetail = HouseholdWithGuests & {
  events: EventRow[];
  responses: ResponseRow[];
  answers: AnswerRow[];
  activity: ActivityRow[];
};

export async function list(scope: WeddingScope): Promise<HouseholdWithGuests[]> {
  const { data, error } = await scope.db
    .from("households")
    .select(`${HOUSEHOLD_COLS}, guests(*)`)
    .eq("wedding_id", scope.weddingId)
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HouseholdWithGuests[];
}

export async function search(
  scope: WeddingScope,
  q: { text?: string; filter?: HouseholdFilter; limit?: number },
): Promise<HouseholdWithGuests[]> {
  let query = scope.db
    .from("households")
    .select(`${HOUSEHOLD_COLS}, guests(*)`)
    .eq("wedding_id", scope.weddingId)
    .order("display_name")
    .limit(q.limit ?? 200);

  if (q.text?.trim()) {
    const t = q.text.trim();
    // Match household name/email/phone; guest names matched below in JS
    query = query.or(`display_name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as unknown as HouseholdWithGuests[];

  // Guest-name text search fallback: widen to all, filter in JS
  if (q.text?.trim() && rows.length === 0) {
    const all = await list(scope);
    const t = q.text.trim().toLowerCase();
    rows = all.filter((h) =>
      h.guests.some((g) => `${g.first_name} ${g.last_name}`.toLowerCase().includes(t)),
    );
  }

  const f = q.filter ?? "all";
  if (f === "all") return rows;

  // Response-dependent filters need responses
  const needsResponses = ["attending", "missing_meal", "no_table"].includes(f);
  let responses: ResponseRow[] = [];
  let assignedGuestIds = new Set<string>();
  if (needsResponses) {
    const [{ data: r }, { data: invites }, { data: seats }] = await Promise.all([
      scope.db
        .from("guest_event_responses")
        .select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via")
        .eq("wedding_id", scope.weddingId),
      scope.db
        .from("household_event_invites")
        .select("household_id, event_id")
        .eq("wedding_id", scope.weddingId),
      scope.db.from("seat_assignments").select("guest_id").eq("wedding_id", scope.weddingId),
    ]);
    // Only invite-backed responses: a retained "yes" from an event the
    // household was since un-invited from must not surface it under
    // "attending" or "missing a meal".
    responses = liveResponses(
      (r ?? []) as ResponseRow[],
      invites ?? [],
      rows.flatMap((h) => h.guests.map((g) => ({ id: g.id, household_id: h.id }))),
    );
    assignedGuestIds = new Set((seats ?? []).map((s: { guest_id: string }) => s.guest_id));
  }
  const attendingGuestIds = new Set(
    responses.filter((r) => r.attending === "yes").map((r) => r.guest_id),
  );

  return rows.filter((h) => {
    switch (f) {
      case "pending":
        return h.rsvp_status === "pending";
      case "started":
        return h.rsvp_status === "started";
      case "declined":
        return h.rsvp_status === "declined";
      case "attending":
        return h.guests.some((g) => attendingGuestIds.has(g.id));
      case "families":
        return h.guests.length >= 3;
      case "plus_ones":
        return h.plus_one_slots > 0 || h.guests.some((g) => g.origin === "plus_one");
      case "children":
        return h.guests.some((g) => g.age_type !== "adult");
      case "missing_meal":
        return h.guests.some((g) =>
          responses.some(
            (r) => r.guest_id === g.id && r.attending === "yes" && !r.meal_option_id,
          ),
        );
      case "dietary":
        return h.guests.some((g) => g.dietary_restrictions || g.allergies);
      case "accessibility":
        return h.guests.some((g) => g.accessibility_needs);
      case "no_table":
        return h.guests.some((g) => attendingGuestIds.has(g.id) && !assignedGuestIds.has(g.id));
      case "vip":
        return h.guests.some((g) => g.is_vip) || h.tags.includes("VIP");
      default:
        return true;
    }
  });
}

export async function getDetail(scope: WeddingScope, id: string): Promise<HouseholdDetail> {
  const { data, error } = await scope.db
    .from("households")
    .select(`${HOUSEHOLD_COLS}, guests(*)`)
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const household = data as unknown as HouseholdWithGuests;

  const [{ data: invites }, { data: responses }, { data: answers }, act] = await Promise.all([
    scope.db
      .from("household_event_invites")
      .select("event_id, events(id, name, starts_at, venue_name, rsvp_enabled, seating_published_at, sort_order)")
      .eq("household_id", id),
    scope.db
      .from("guest_event_responses")
      .select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via")
      .in("guest_id", household.guests.map((g) => g.id)),
    scope.db
      .from("rsvp_answers")
      .select("question_id, household_id, guest_id, value")
      .eq("household_id", id),
    activity.forHousehold(scope, id),
  ]);

  const events = ((invites ?? []) as unknown as Array<{ events: EventRow }>)
    .map((i) => i.events)
    .sort((a, b) => a.sort_order - b.sort_order);

  return {
    ...household,
    events,
    responses: (responses ?? []) as ResponseRow[],
    answers: (answers ?? []) as AnswerRow[],
    activity: act,
  };
}

export async function byInviteCode(scope: WeddingScope, code: string): Promise<HouseholdRow | null> {
  const { data } = await scope.db
    .from("households")
    .select(HOUSEHOLD_COLS)
    .eq("wedding_id", scope.weddingId)
    .ilike("invite_code", code.trim())
    .maybeSingle();
  return (data as HouseholdRow) ?? null;
}

export async function byAccessToken(scope: WeddingScope, token: string): Promise<HouseholdRow | null> {
  const { data } = await scope.db
    .from("households")
    .select(HOUSEHOLD_COLS)
    .eq("wedding_id", scope.weddingId)
    .eq("access_token", token)
    .maybeSingle();
  return (data as HouseholdRow) ?? null;
}

/**
 * Fuzzy find for "find my invitation": trigram-ish match on household display
 * name OR any guest name, AND the email must match the household contact email
 * (case-insensitive). Returns minimal info — the caller emails a link, never
 * opens the household directly.
 */
export async function fuzzyFind(
  scope: WeddingScope,
  name: string,
  email: string,
): Promise<{ id: string; email: string; access_token: string; preferred_locale: string } | null> {
  const all = await list(scope);
  const n = name.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  if (!n || !e) return null;

  const match = all.find((h) => {
    if ((h.email ?? "").toLowerCase() !== e) return false;
    if (h.display_name.toLowerCase().includes(n)) return true;
    return h.guests.some((g) => {
      const full = `${g.first_name} ${g.last_name}`.toLowerCase();
      return full.includes(n) || n.includes(g.last_name.toLowerCase());
    });
  });

  return match && match.email
    ? { id: match.id, email: match.email, access_token: match.access_token, preferred_locale: match.preferred_locale }
    : null;
}

export async function update(
  scope: WeddingScope,
  id: string,
  patch: Partial<
    Pick<
      HouseholdRow,
      | "display_name"
      | "primary_contact_name"
      | "email"
      | "phone"
      | "max_party_size"
      | "plus_one_slots"
      | "preferred_locale"
      | "tags"
      | "internal_notes"
    >
  >,
  actorId?: string,
): Promise<void> {
  const { error } = await scope.db
    .from("households")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await activity.log(scope, {
    householdId: id,
    actorType: "admin",
    actorId,
    action: "household.updated",
    payload: { fields: Object.keys(patch) },
  });
}

export async function remove(scope: WeddingScope, id: string, actorId?: string): Promise<void> {
  const { data, error } = await scope.db
    .from("households")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("id", id)
    .select("display_name")
    .single();
  if (error) throw new Error(error.message);
  // Wedding-level log: the household's own activity rows cascade away with it.
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "household.removed",
    payload: { name: data.display_name },
  });
}

export async function setPreferredLocale(scope: WeddingScope, id: string, locale: string): Promise<void> {
  await scope.db
    .from("households")
    .update({ preferred_locale: locale })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
}
