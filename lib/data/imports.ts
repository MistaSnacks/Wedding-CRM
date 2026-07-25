import type { WeddingScope } from "./scope";
import * as activity from "./activity";
import { customAlphabet } from "nanoid";
import { randomBytes } from "crypto";

/** Unambiguous alphabet (no 0/O/1/I/L) for human-typed invite codes. */
const codeAlphabet = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 8);

function newInviteCode(): string {
  const raw = codeAlphabet();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function newAccessToken(): string {
  return randomBytes(16).toString("hex");
}

export type ImportHouseholdInput = {
  displayName: string;
  primaryContactName?: string;
  email?: string;
  phone?: string;
  maxPartySize: number;
  plusOneSlots: number;
  preferredLocale?: string;
  tags?: string[];
  guests: Array<{ firstName: string; lastName: string; ageType?: "adult" | "child" | "infant"; relationship?: string }>;
};

export async function createRun(scope: WeddingScope, filename: string): Promise<{ id: string }> {
  const { data, error } = await scope.db
    .from("imports")
    .insert({ wedding_id: scope.weddingId, filename })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

export async function finishRun(
  scope: WeddingScope,
  id: string,
  status: "validated" | "committed" | "failed",
  stats?: unknown,
  errorReport?: unknown,
): Promise<void> {
  await scope.db
    .from("imports")
    .update({ status, stats: stats ?? null, error_report: errorReport ?? null })
    .eq("wedding_id", scope.weddingId)
    .eq("id", id);
}

/** Creates households + guests + event invites + pending responses. */
export async function commitHouseholds(
  scope: WeddingScope,
  runId: string,
  inputs: ImportHouseholdInput[],
  actorId?: string,
): Promise<{ households: number; guests: number }> {
  const { data: events } = await scope.db
    .from("events")
    .select("id")
    .eq("wedding_id", scope.weddingId);
  const eventIds = (events ?? []).map((e: { id: string }) => e.id);

  let guestCount = 0;
  for (const input of inputs) {
    const { data: hh, error } = await scope.db
      .from("households")
      .insert({
        wedding_id: scope.weddingId,
        display_name: input.displayName,
        primary_contact_name: input.primaryContactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        max_party_size: input.maxPartySize,
        plus_one_slots: input.plusOneSlots,
        preferred_locale: input.preferredLocale ?? "en",
        tags: input.tags ?? [],
        invite_code: newInviteCode(),
        access_token: newAccessToken(),
      })
      .select("id")
      .single();
    if (error) throw new Error(`household "${input.displayName}": ${error.message}`);

    const { data: guests, error: gErr } = await scope.db
      .from("guests")
      .insert(
        input.guests.map((g) => ({
          wedding_id: scope.weddingId,
          household_id: hh.id,
          first_name: g.firstName,
          last_name: g.lastName,
          age_type: g.ageType ?? "adult",
          relationship: g.relationship ?? null,
        })),
      )
      .select("id");
    if (gErr) throw new Error(`guests for "${input.displayName}": ${gErr.message}`);
    guestCount += guests?.length ?? 0;

    if (eventIds.length) {
      await scope.db.from("household_event_invites").insert(
        eventIds.map((eventId) => ({
          household_id: hh.id,
          event_id: eventId,
          wedding_id: scope.weddingId,
        })),
      );
      await scope.db.from("guest_event_responses").insert(
        (guests ?? []).flatMap((g: { id: string }) =>
          eventIds.map((eventId) => ({
            guest_id: g.id,
            event_id: eventId,
            wedding_id: scope.weddingId,
          })),
        ),
      );
    }
  }

  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "import.completed",
    payload: { runId, households: inputs.length, guests: guestCount },
  });
  return { households: inputs.length, guests: guestCount };
}
