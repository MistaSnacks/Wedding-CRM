"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding, type WeddingScope } from "@/lib/data/scope";
import * as events from "@/lib/data/events";
import { EventValidationError } from "@/lib/data/events";
import type { DeletionImpact } from "@/lib/data/event-rules";
import { toInstant } from "@/components/admin/events/when";

/**
 * Server actions for event management.
 *
 * Every one of these is a write gate, so every one calls `requireEditor()` —
 * pages use `requireEditorPage()` instead, which redirects. `requireEditor`
 * throws, and there is no error boundary on this surface, so each action
 * catches and returns a sentence the screen can render rather than letting a
 * rejected promise take the page down.
 *
 * That catch-all is a trap, so every one of them opens with
 * `unstable_rethrow`. `requireEditor` → `requireAdmin` calls `redirect()` when
 * the session has lapsed, and Next implements `redirect()` (and `notFound()`)
 * by *throwing* a control-flow signal rather than an error. Swallowed, it never
 * navigates and `readableError` renders its internal message — the literal
 * string `NEXT_REDIRECT` — into the pink box on screen. Rethrown, the framework
 * completes the navigation and she lands on the sign-in page, which is what an
 * expired session is supposed to do.
 */

export type EventFormState = {
  ok: boolean;
  /** Keyed by the question it belongs under, so it renders where it matters. */
  fieldErrors?: { name?: string; when?: string; form?: string };
  savedEventId?: string;
  /** True when the next useful step is choosing who's coming. */
  openInvites?: boolean;
};

export type ActionResult = { ok: boolean; message?: string };

/** Turns anything thrown into one sentence, in her words where we have them. */
function readableError(error: unknown): string {
  if (error instanceof EventValidationError) return error.errors.map((e) => e.message).join(" ");
  if (error instanceof Error) return error.message;
  return "Something went wrong. Nothing was changed.";
}

async function householdIds(scope: WeddingScope): Promise<string[]> {
  const { data, error } = await scope.db
    .from("households")
    .select("id")
    .eq("wedding_id", scope.weddingId);
  if (error) throw new Error(error.message);
  const rows: Array<{ id: string }> = data ?? [];
  return rows.map((h) => h.id);
}

/**
 * Who this event is for, as a standing rule rather than a snapshot.
 *
 * `visibility` used to be inert, so narrowing it as a side effect of un-ticking
 * one household was harmless bookkeeping. Migration 0008 gave it teeth: it now
 * decides whether newly imported households are auto-invited. Un-inviting Aunt
 * Sue from the ceremony and "stop adding future guests to the ceremony" are
 * different intentions, and inferring the second from the first silently
 * converted a whole-guest-list event into a curated one — after which every
 * import left people out of their own ceremony.
 *
 * So it is a choice she makes, in both directions, and nothing else moves it.
 * `setInvites` is only replayed when the rule *becomes* "everyone"; re-saving
 * an event that was already "everyone" leaves the tick list alone, so an
 * exception she made by hand survives an unrelated edit to the venue.
 */
export async function setEventScope(eventId: string, everyone: boolean): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    const event = await events.get(scope, eventId);

    if ((event.visibility === "all") !== everyone) {
      await events.update(
        scope,
        eventId,
        {
          name: event.name,
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          venueName: event.venue_name,
          venueAddress: event.venue_address,
          dressCode: event.dress_code,
          visibility: everyone ? "all" : "invited_only",
          rsvpEnabled: event.rsvp_enabled,
        },
        admin.userId,
      );
    }

    if (everyone) {
      await events.setInvites(scope, eventId, await householdIds(scope), admin.userId);
    }

    revalidatePath("/admin/events");
    revalidatePath("/admin/guests");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Add or edit. `update()` replaces the whole row rather than patching it, so
 * the form posts every field — including `endsAt`, which has no input and
 * rides along hidden so that editing a name cannot blank an end time.
 */
export async function saveEvent(
  eventId: string | null,
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const { data: wedding } = await scope.db
      .from("weddings")
      .select("timezone")
      .eq("id", scope.weddingId)
      .single();
    const timeZone: string = wedding?.timezone ?? "America/Los_Angeles";

    const name = String(formData.get("name") ?? "").trim();
    const date = String(formData.get("date") ?? "").trim();
    const time = String(formData.get("time") ?? "").trim();
    const everyone = String(formData.get("everyone") ?? "yes") === "yes";
    const rsvpEnabled = String(formData.get("rsvp") ?? "yes") === "yes";

    if (name.length === 0) {
      return { ok: false, fieldErrors: { name: "This needs a name before it can be saved." } };
    }
    if (date.length === 0 && time.length > 0) {
      return {
        ok: false,
        fieldErrors: { when: "Pick a day too — a time on its own has nothing to attach to." },
      };
    }

    const startsAt = toInstant(date, time, timeZone);

    // `ends_at` has no input — it rides along hidden so an edit can't blank it.
    // Nothing in this admin can set or show it, so if she moves the start past
    // a stale end there is no field she could fix, and the save would dead-end
    // on "this event ends before it starts". The end is dropped instead: she
    // has just said when it starts, and an end before that is no longer true.
    const carriedEndsAt = String(formData.get("endsAt") ?? "") || null;
    const endsAt =
      carriedEndsAt !== null &&
      startsAt !== null &&
      Date.parse(carriedEndsAt) < Date.parse(startsAt)
        ? null
        : carriedEndsAt;

    const input = {
      name,
      startsAt,
      endsAt,
      venueName: String(formData.get("venueName") ?? ""),
      venueAddress: String(formData.get("venueAddress") ?? ""),
      dressCode: String(formData.get("dressCode") ?? ""),
      visibility: everyone ? ("all" as const) : ("invited_only" as const),
      rsvpEnabled,
    };

    const wasEveryone =
      eventId === null ? false : (await events.get(scope, eventId)).visibility === "all";

    const saved =
      eventId === null
        ? await events.create(scope, input, admin.userId)
        : await events.update(scope, eventId, input, admin.userId);

    // Only when "everyone" is newly true. Replaying it on every save would undo
    // any exception she has ticked off by hand since — un-ticking a household
    // no longer narrows the rule, so an "everyone" event can carry one.
    if (everyone && (eventId === null || !wasEveryone)) {
      await events.setInvites(scope, saved.id, await householdIds(scope), admin.userId);
    }

    revalidatePath("/admin/events");
    revalidatePath("/admin/guests");
    return {
      ok: true,
      savedEventId: saved.id,
      openInvites: !everyone && (eventId === null || wasEveryone),
    };
  } catch (error) {
    unstable_rethrow(error);
    const message = readableError(error);
    if (error instanceof EventValidationError) {
      const field = error.errors[0]?.field;
      return { ok: false, fieldErrors: field === "name" ? { name: message } : { when: message } };
    }
    return { ok: false, fieldErrors: { form: message } };
  }
}

/**
 * What deleting would destroy, read at the moment she asks rather than when
 * the page loaded — the number on the confirmation has to be the number of
 * rows the delete actually removes.
 */
export async function deletionCost(
  eventId: string,
): Promise<{ ok: boolean; message?: string; impact?: DeletionImpact }> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    return { ok: true, impact: await events.impactOf(scope, eventId) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * The most dangerous action here. The typed-name check is re-run on the server
 * against a freshly read impact, so a reply that arrived after the page
 * rendered still forces the guard instead of slipping through a confirmation
 * that was armed while the event looked empty.
 */
export async function deleteEvent(eventId: string, typedName: string): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const event = await events.get(scope, eventId);
    const impact = await events.impactOf(scope, eventId);
    const guarded = impact.replied > 0 || impact.mealsChosen > 0;

    if (guarded && typedName.trim() !== event.name.trim()) {
      return {
        ok: false,
        message: `Someone has replied to ${event.name} since this page loaded. Reload to see what deleting it would remove.`,
      };
    }

    await events.remove(scope, eventId, admin.userId);
    revalidatePath("/admin/events");
    revalidatePath("/admin/guests");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function reorderEvents(orderedIds: string[]): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    await events.reorder(scope, orderedIds, admin.userId);
    revalidatePath("/admin/events");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/** The matrix, from the event's side: the full list of who is invited. */
export async function setEventInvites(
  eventId: string,
  selectedHouseholdIds: string[],
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    await events.setInvites(scope, eventId, selectedHouseholdIds, admin.userId);
    revalidatePath("/admin/events");
    revalidatePath("/admin/guests");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * The same matrix from the household's side. It reads the event's current
 * invite list and hands back the whole list with one household added or
 * removed, so both directions go through the one tested write path.
 */
export async function setHouseholdInvite(
  householdId: string,
  eventId: string,
  invited: boolean,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);

    const current = await events.invitedHouseholdIds(scope, eventId);
    const next = invited
      ? [...new Set([...current, householdId])]
      : current.filter((id) => id !== householdId);

    await events.setInvites(scope, eventId, next, admin.userId);
    revalidatePath("/admin/events");
    revalidatePath(`/admin/guests/${householdId}`);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}
