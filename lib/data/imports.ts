import type { WeddingScope } from "./scope";
import type { MailingAddress } from "@/lib/csv";
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
  mailingAddress?: MailingAddress;
  internalNotes?: string;
  notInvitedEventIds?: string[];
  guests: Array<{
    firstName: string;
    lastName: string;
    ageType?: "adult" | "child" | "infant";
    relationship?: string;
    origin?: "named" | "plus_one";
    dietaryRestrictions?: string;
    mealOptionId?: string;
    attendingByEventId?: Record<string, "pending" | "yes" | "no">;
  }>;
};

export async function createRun(
  scope: WeddingScope,
  filename: string,
  status: "pending" | "validated" = "pending",
  stats?: unknown,
): Promise<{ id: string }> {
  const { data, error } = await scope.db
    .from("imports")
    .insert({ wedding_id: scope.weddingId, filename, status, stats: stats ?? null })
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

/**
 * Commits validated households through the `import_households` Postgres
 * function so the whole import runs as a single transaction — a failure
 * partway through rolls back every insert, leaving no partial households,
 * guests, invites, or live invite codes behind.
 */
export async function commitHouseholds(
  scope: WeddingScope,
  runId: string,
  inputs: ImportHouseholdInput[],
  actorId?: string,
): Promise<{ households: number; guests: number }> {
  const payload = inputs.map((input) => ({
    ...input,
    inviteCode: newInviteCode(),
    accessToken: newAccessToken(),
  }));

  const { data, error } = await scope.db.rpc("import_households", {
    p_wedding_id: scope.weddingId,
    p_run_id: runId,
    p_households: payload,
  });
  if (error) throw new Error(error.message);

  const result = data as { households: number; guests: number };
  await activity.log(scope, {
    actorType: "admin",
    actorId,
    action: "import.completed",
    payload: { runId, ...result },
  });
  return result;
}
