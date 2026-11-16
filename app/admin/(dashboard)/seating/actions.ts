"use server";

import { freeTableSpot } from "@/lib/domain/table-spot";
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

/**
 * Both screens that show the chart: this page and the 3D venue editor at
 * /venue-preview. A change made on either one re-renders the other's data.
 */
function revalidateSeating() {
  revalidatePath("/admin/seating");
  revalidatePath("/venue-preview");
}

/** Turns anything thrown into one sentence, in her words where we have them. */
function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Refresh the chart to check the saved assignments.";
}

/**
 * The optional `place` lets the 3D editor create a table with its shape and
 * spot in one write; the Seating page leaves it out, as before. `id` is the
 * new table's id, which the 3D editor needs for the next change.
 */
export async function createTable(
  eventId: string,
  name: string,
  capacity: number,
  place?: { shape?: "round" | "rect" | "banquet"; posX?: number; posY?: number },
): Promise<ActionResult & { id?: string }> {
  try {
    const admin = await requireEditor();
    const shape = place?.shape;
    if (shape !== undefined && !["round", "rect", "banquet"].includes(shape))
      throw new Error("Choose a round, long or head table.");
    for (const n of [place?.posX, place?.posY])
      if (n !== undefined && !Number.isFinite(n)) throw new Error("Invalid table position");
    const scope = forWedding(admin.weddingId);
    // The 3D venue sends the spot she tapped. The list forms send none, so
    // the table takes the first free cell instead of the top-left corner.
    const spot =
      place?.posX !== undefined && place?.posY !== undefined
        ? { posX: place.posX, posY: place.posY }
        : freeTableSpot(await seating.listTables(scope, eventId));
    const row = await seating.upsertTable(scope, {
      eventId,
      name,
      capacity,
      shape,
      ...spot,
    });
    revalidateSeating();
    return { ok: true, id: row.id };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Deliberately does not revalidate the Seating page. The canvas holds dragged positions in its
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
    // Only the 3D page: revalidating /admin/seating here would re-render the
    // canvas mid-drag (see above). That page is force-dynamic, so it reads
    // the new position on its next load.
    revalidatePath("/venue-preview");
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
    revalidateSeating();
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
    await seating.assign(
      forWedding(admin.weddingId),
      guestId,
      eventId,
      tableId,
      admin.userId,
    );
    revalidateSeating();
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
    await seating.assignGroup(scope, guestIds, eventId, tableId, admin.userId);
    revalidateSeating();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function unassignGuest(
  guestId: string,
  eventId: string,
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.unassign(forWedding(admin.weddingId), guestId, eventId);
    revalidateSeating();
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
    await seating.setPublished(
      forWedding(admin.weddingId),
      eventId,
      published,
      admin.userId,
    );
    revalidateSeating();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

export async function editTable(
  tableId: string,
  eventId: string,
  name: string,
  capacity: number,
  shape: "round" | "rect" | "banquet",
): Promise<ActionResult> {
  try {
    const admin = await requireEditor();
    await seating.upsertTable(forWedding(admin.weddingId), {
      id: tableId,
      eventId,
      name,
      capacity,
      shape,
    });
    revalidateSeating();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Saves a table's turn (degrees) from the 3D venue editor. The Seating canvas
 * does not draw turns. Before migration 0020 the column does not exist; then
 * this returns `persisted: false` rather than an error, and nothing is written.
 */
export async function saveTableRotation(
  tableId: string,
  rotation: number,
): Promise<ActionResult & { persisted?: boolean }> {
  try {
    const admin = await requireEditor();
    const { persisted } = await seating.turnTable(
      forWedding(admin.weddingId),
      tableId,
      rotation,
    );
    if (persisted) revalidatePath("/venue-preview");
    return { ok: true, persisted };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: readableError(error) };
  }
}
