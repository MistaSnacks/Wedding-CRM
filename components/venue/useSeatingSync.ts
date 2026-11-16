"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  assignGuest,
  assignHousehold,
  createTable,
  editTable,
  removeTable,
  saveTablePosition,
  saveTableRotation,
  unassignGuest,
  type ActionResult,
} from "@/app/admin/(dashboard)/seating/actions";
import type { Draft } from "@/lib/venue/model";
import { diffDrafts, type SeatingOp } from "@/lib/venue/seating-sync";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** One change to save: the plan before it and after it. */
export type SaveJob = { before: Draft; after: Draft };

/**
 * Saves the 3D editor's changes to Seating through the same server actions
 * the Seating page uses. Jobs run one at a time, in order. Each job becomes
 * a list of operations (`diffDrafts`); undo is a job with the plans swapped,
 * so it sends the inverse operations.
 *
 * New tables get their real id from the server. Local ids ("table-9") map to
 * real ids in `alias`, which every later operation reads at run time.
 *
 * On the first refusal the queue stops, waiting jobs are dropped, and
 * `onFailure` gets the job that failed so the page can roll back and reload
 * the saved plan.
 */
export function useSeatingSync(opts: {
  enabled: boolean;
  eventId: string | undefined;
  onFailure: (job: SaveJob, message: string) => void;
  onNote?: (message: string) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const queue = useRef<SaveJob[]>([]);
  const running = useRef(false);
  const alias = useRef(new Map<string, string>());
  const turnWarned = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const resolve = (id: string) => alias.current.get(id) ?? id;

  const run = useCallback(async (op: SeatingOp, eventId: string) => {
    let result: ActionResult;
    switch (op.type) {
      case "create": {
        const made = await createTable(eventId, op.name, op.capacity, { shape: op.shape, posX: op.posX, posY: op.posY });
        if (made.ok && made.id) alias.current.set(op.tableId, made.id);
        result = made;
        if (made.ok && op.rotation) await turn(made.id ?? op.tableId, op.rotation);
        break;
      }
      case "edit":
        result = await editTable(resolve(op.tableId), eventId, op.name, op.capacity, op.shape);
        break;
      case "move":
        result = await saveTablePosition(resolve(op.tableId), op.posX, op.posY);
        break;
      case "turn":
        await turn(resolve(op.tableId), op.rotation);
        return;
      case "unassign":
        result = await unassignGuest(op.guestId, eventId);
        break;
      case "assign":
        result =
          op.guestIds.length === 1
            ? await assignGuest(op.guestIds[0], eventId, resolve(op.tableId))
            : await assignHousehold(op.guestIds, eventId, resolve(op.tableId));
        break;
      case "remove":
        result = await removeTable(resolve(op.tableId));
        break;
    }
    if (!result.ok) throw new Error(result.message ?? "The change was not saved.");
  }, []);

  async function turn(tableId: string, rotation: number) {
    const r = await saveTableRotation(tableId, rotation);
    if (!r.ok) throw new Error(r.message ?? "The turn was not saved.");
    if (r.persisted === false && !turnWarned.current) {
      turnWarned.current = true;
      optsRef.current.onNote?.("Turns show here but are not saved yet. Everything else saves to Seating.");
    }
  }

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setStatus("saving");
    while (queue.current.length) {
      const job = queue.current.shift()!;
      const eventId = optsRef.current.eventId;
      try {
        if (!eventId) throw new Error("Choose an event first.");
        for (const op of diffDrafts(job.before, job.after)) await run(op, eventId);
      } catch (error) {
        queue.current = [];
        running.current = false;
        setStatus("error");
        const detail = error instanceof Error && error.message ? error.message : "";
        // A rejected promise (not a refusal) means the request never finished.
        const plain = /fetch|network|failed to/i.test(detail)
          ? "The connection dropped."
          : detail;
        optsRef.current.onFailure(job, plain);
        return;
      }
    }
    running.current = false;
    setStatus("saved");
  }, [run]);

  const enqueue = useCallback(
    (job: SaveJob) => {
      if (!optsRef.current.enabled) return;
      if (diffDrafts(job.before, job.after).length === 0) return;
      queue.current.push(job);
      void pump();
    },
    [pump],
  );

  /** After the page reloads the saved plan, local ids no longer apply. */
  const reset = useCallback(() => {
    alias.current.clear();
  }, []);

  // Warn before closing the tab while a change is still on its way.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (running.current || queue.current.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  return { status, enqueue, reset, busy: () => running.current || queue.current.length > 0 };
}
