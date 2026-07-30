"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as seating from "@/lib/data/seating";

/**
 * Server actions for the seating chart.
 *
 * Every one of these is a write gate, so every one calls `requireEditor()` —
 * pages use `requireEditorPage()` instead, which redirects. `requireEditor`
 * throws, and there is no error boundary on this surface, so each action
 * catches and returns a sentence the screen can render rather than letting a
 * rejected promise take the page down.
 *
 * Until now they returned `void` and caught nothing. The canvas is optimistic:
 * a dragged guest lands in their chair the instant you let go, and the real
 * write follows. When that write failed, the chair emptied again on the next
 * render and nothing said why — the same silent revert whether the session had
 * lapsed, the table belonged to another wedding, or the wifi dropped. The
 * result now says which, and `SeatingCanvas` puts it on one line above the room.
 *
 * That catch-all is a trap, so every one of them calls `unstable_rethrow` before
 * it reads the error. `requireEditor` → `requireAdmin` calls `redirect()` when the session has
 * lapsed, and Next implements `redirect()` (and `notFound()`) by *throwing* a
 * control-flow signal rather than an error. Swallowed, it never navigates and
 * `readableError` renders its internal message — the literal string
 * `NEXT_REDIRECT` — into the pink box on screen. Rethrown, the framework
 * completes the navigation and she lands on the sign-in page, which is what an
 * expired session is supposed to do.
 */

export type ActionResult = { ok: boolean; message?: string };

/** Turns anything thrown into one sentence, in her words where we have them. */
function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Nothing was changed.";
}

export async function createTable(
  eventId: string,
  name: string,
  capacity: number,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.upsertTable(forWedding(admin.weddingId), { eventId, name, capacity });
    revalidatePath("/admin/seating");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Deliberately does not revalidate. The canvas holds dragged positions in its
 * own state so a table never snaps back mid-drag, and a revalidation per drop
 * would re-render the whole room to tell it what it already knows.
 */
export async function saveTablePosition(
  tableId: string,
  posX: number,
  posY: number,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.moveTable(forWedding(admin.weddingId), tableId, posX, posY);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function removeTable(tableId: string): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.deleteTable(forWedding(admin.weddingId), tableId);
    revalidatePath("/admin/seating");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function assignGuest(
  guestId: string,
  eventId: string,
  tableId: string,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.assign(forWedding(admin.weddingId), guestId, eventId, tableId, admin.userId);
    revalidatePath("/admin/seating");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Seats a whole household at one table, one row at a time. A guest who fails
 * part-way leaves the ones before him seated, so the failure is reported rather
 * than swallowed: she reloads and sees who actually made it, instead of a chart
 * that quietly disagrees with the database.
 */
export async function assignHousehold(
  guestIds: string[],
  eventId: string,
  tableId: string,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    const scope = forWedding(admin.weddingId);
    for (const guestId of guestIds) {
      await seating.assign(scope, guestId, eventId, tableId, admin.userId);
    }
    revalidatePath("/admin/seating");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function unassignGuest(guestId: string, eventId: string): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.unassign(forWedding(admin.weddingId), guestId, eventId);
    revalidatePath("/admin/seating");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function setSeatingPublished(
  eventId: string,
  published: boolean,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.setPublished(forWedding(admin.weddingId), eventId, published);
    revalidatePath("/admin/seating");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}
