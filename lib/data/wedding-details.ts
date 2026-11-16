import type { WeddingScope } from "./scope";
import * as activity from "./activity";
import {
  eventsOnDay,
  moveEventToDay,
  validateWeddingDetails,
  weddingFactsFromRow,
  withLocationLine,
  type NamedEvent,
  type WeddingDetailsErrors,
  type WeddingDetailsInput,
} from "@/lib/domain/wedding-details";

/**
 * Saves the "Wedding details" card: the wedding day, the reply-by date and
 * the city line. The rules live in `lib/domain/wedding-details.ts`; this is
 * the I/O around them.
 *
 * When the day changes, the events on the old day move to the new day first
 * and the `weddings` row is written last. There is no transaction across the
 * two tables without a database function, so the order is what makes a retry
 * safe: an event that already moved is no longer on the old day, so a second
 * save moves only the rest, and the wedding day changes only once all of them
 * are done. Each move is also conditional on the start time it was read with,
 * so an edit to that event in another tab is not overwritten.
 */

export type SaveWeddingDetailsResult =
  | { ok: true; moved: string[] }
  | { ok: false; fieldErrors: WeddingDetailsErrors; needsPastConfirm: boolean }
  /** An event joined the wedding day after the page showed her the list. */
  | { ok: false; unexpectedMoves: string[] };

/** Thrown when some events moved and the rest of the save did not finish. */
export class PartialSaveError extends Error {
  constructor(
    public moved: string[],
    cause: unknown,
  ) {
    super(
      moved.length === 0
        ? "The wedding details did not save. Nothing was changed. Try again."
        : `${listNames(moved)} moved to the new day, but the rest did not save. Press Save again to finish.`,
      { cause },
    );
    this.name = "PartialSaveError";
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function saveWeddingDetails(
  scope: WeddingScope,
  input: WeddingDetailsInput,
  opts: {
    now: Date;
    actorId?: string;
    /** The events the card said would move. Any other event on the old day stops the save. */
    expectedMoves?: string[];
  },
): Promise<SaveWeddingDetailsResult> {
  const { data: row, error: readError } = await scope.db
    .from("weddings")
    .select("wedding_date, rsvp_deadline, timezone, theme")
    .eq("id", scope.weddingId)
    .single();
  if (readError) throw new Error(readError.message);
  const current = weddingFactsFromRow(row);

  const result = validateWeddingDetails(input, current, opts.now);
  if (!result.ok) return result;
  const next = result.value;

  const oldDay = current.weddingDate;
  const moved: string[] = [];
  try {
    if (oldDay !== null && oldDay !== next.weddingDate) {
      const { data, error } = await scope.db
        .from("events")
        .select("id, name, starts_at, ends_at")
        .eq("wedding_id", scope.weddingId);
      if (error) throw new Error(error.message);
      const following = eventsOnDay((data ?? []) as NamedEvent[], oldDay, current.timeZone);

      if (opts.expectedMoves) {
        const expected = new Set(opts.expectedMoves);
        const surprise = following.filter((event) => !expected.has(event.id));
        if (surprise.length > 0) return { ok: false, unexpectedMoves: surprise.map((event) => event.name) };
      }

      for (const event of following) {
        const to = moveEventToDay(event, oldDay, next.weddingDate, current.timeZone);
        const { data: changed, error: moveError } = await scope.db
          .from("events")
          .update({ starts_at: to.startsAt, ends_at: to.endsAt })
          .eq("wedding_id", scope.weddingId)
          .eq("id", event.id)
          .eq("starts_at", event.starts_at)
          .select("id");
        if (moveError) throw new Error(moveError.message);
        if ((changed ?? []).length > 0) moved.push(event.name);
      }
    }

    const { error: writeError } = await scope.db
      .from("weddings")
      .update({
        wedding_date: next.weddingDate,
        rsvp_deadline: next.rsvpDeadline,
        theme: withLocationLine(row?.theme, next.locationLine),
      })
      .eq("id", scope.weddingId);
    if (writeError) throw new Error(writeError.message);
  } catch (error) {
    throw new PartialSaveError(moved, error);
  }

  await activity.log(scope, {
    actorType: "admin",
    actorId: opts.actorId,
    action: "wedding.details_updated",
    payload: {
      from: { weddingDate: oldDay, rsvpDeadline: current.rsvpDeadline, locationLine: current.locationLine },
      to: next,
      movedEvents: moved,
    },
  });
  return { ok: true, moved };
}
