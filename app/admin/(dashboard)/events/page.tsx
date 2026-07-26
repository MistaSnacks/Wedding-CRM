import { requireEditorPage } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as events from "@/lib/data/events";
import { EventsScreen, type EventView } from "@/components/admin/events/EventsScreen";
import type { HouseholdView } from "@/components/admin/events/InvitePicker";
import { formatWhen, toFields } from "@/components/admin/events/when";

export const dynamic = "force-dynamic";

/**
 * `requireEditorPage()` redirects a viewer to the overview. `requireEditor()`
 * is the action gate and throws — using it on a page once took down the whole
 * admin for viewer-role accounts, since there is no error boundary here.
 */
export default async function EventsPage() {
  const admin = await requireEditorPage();
  const scope = forWedding(admin.weddingId);

  const [rows, wedding, householdRows, inviteRows, replyRows, guestRows] = await Promise.all([
    events.list(scope),
    scope.db.from("weddings").select("timezone").eq("id", scope.weddingId).single(),
    scope.db
      .from("households")
      .select("id, display_name, tags, guests(first_name, last_name)")
      .eq("wedding_id", scope.weddingId)
      .order("display_name"),
    scope.db
      .from("household_event_invites")
      .select("event_id, household_id")
      .eq("wedding_id", scope.weddingId),
    scope.db
      .from("guest_event_responses")
      .select("event_id, guest_id, attending")
      .eq("wedding_id", scope.weddingId)
      .neq("attending", "pending"),
    scope.db.from("guests").select("id, household_id").eq("wedding_id", scope.weddingId),
  ]);

  const timeZone: string = wedding.data?.timezone ?? "America/Los_Angeles";

  const invitedByEvent = new Map<string, string[]>();
  const invites: Array<{ event_id: string; household_id: string }> = inviteRows.data ?? [];
  for (const invite of invites) {
    const list = invitedByEvent.get(invite.event_id);
    if (list) list.push(invite.household_id);
    else invitedByEvent.set(invite.event_id, [invite.household_id]);
  }

  // Un-inviting a household deliberately keeps the reply it already gave, so a
  // reply can outlive its invitation. Left alone that reads as a contradiction
  // — "2 invited, 3 replied" — so the card names it instead of hiding it.
  const householdOfGuest = new Map<string, string>(
    ((guestRows.data ?? []) as Array<{ id: string; household_id: string }>).map((g) => [
      g.id,
      g.household_id,
    ]),
  );
  const repliedByEvent = new Map<string, Set<string>>();
  const replies: Array<{ event_id: string; guest_id: string }> = replyRows.data ?? [];
  for (const reply of replies) {
    const household = householdOfGuest.get(reply.guest_id);
    if (household === undefined) continue;
    const set = repliedByEvent.get(reply.event_id) ?? new Set<string>();
    set.add(household);
    repliedByEvent.set(reply.event_id, set);
  }

  const householdData: Array<{
    id: string;
    display_name: string;
    tags: string[] | null;
    guests: Array<{ first_name: string; last_name: string }> | null;
  }> = householdRows.data ?? [];

  const households: HouseholdView[] = householdData.map((h) => ({
    id: h.id,
    name: h.display_name,
    people: (h.guests ?? [])
      .map((g) => `${g.first_name} ${g.last_name}`.trim())
      .join(", "),
    tags: h.tags ?? [],
  }));

  // Dates are formatted and split here, in the wedding's timezone, so no date
  // arithmetic ships to the browser and a time always means the time at the venue.
  const views: EventView[] = rows.map((event) => {
    const fields = toFields(event.starts_at, timeZone);
    const invitedIds = invitedByEvent.get(event.id) ?? [];
    const invitedSet = new Set(invitedIds);
    const repliedIds = repliedByEvent.get(event.id) ?? new Set<string>();
    return {
      id: event.id,
      name: event.name,
      whenLabel: formatWhen(event.starts_at, timeZone),
      dateField: fields.date,
      timeField: fields.time,
      endsAt: event.ends_at,
      venueName: event.venue_name ?? "",
      venueAddress: event.venue_address ?? "",
      dressCode: event.dress_code ?? "",
      everyone: event.visibility === "all",
      rsvpEnabled: event.rsvp_enabled,
      replied: event.respondedHouseholds,
      repliedNotInvited: [...repliedIds].filter((id) => !invitedSet.has(id)).length,
      invitedHouseholdIds: invitedIds,
    };
  });

  return <EventsScreen events={views} households={households} />;
}
