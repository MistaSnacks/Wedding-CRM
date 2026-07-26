"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  assignGuest,
  assignHousehold,
  unassignGuest,
  createTable,
  removeTable,
  saveTablePosition,
  setSeatingPublished,
} from "@/app/admin/(dashboard)/seating/actions";
import type { EventRow, SeatingTableRow, SeatAssignmentRow, ResponseRow, MealOptionRow } from "@/lib/types";
import { MobileAssignSheet } from "@/components/admin/MobileAssignSheet";

type HH = {
  id: string;
  displayName: string;
  guests: Array<{ id: string; name: string; ageType: string; origin: string; dietary: boolean }>;
};

type DragState = { type: "guest" | "household" | "table"; label: string; count: number };

type AssignmentAction =
  | { kind: "assign"; guestIds: string[]; tableId: string; eventId: string }
  | { kind: "unassign"; guestId: string };

const GRID = 16;
const RECT_DIMS = { w: 280, h: 96 };
const ROUND_DIMS = { w: 136, h: 136 };
const POPOVER_W = 200;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

/** Below Tailwind's md breakpoint the canvas is unusable; seat people from a list instead. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export function SeatingCanvas(props: {
  event: EventRow;
  allEvents: EventRow[];
  tables: SeatingTableRow[];
  assignments: SeatAssignmentRow[];
  householdsWithGuests: HH[];
  responses: ResponseRow[];
  meals: MealOptionRow[];
}) {
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [adding, setAdding] = useState(false);
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTableDragEnd = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(0);
  // Positions live client-side so a moved table never snaps back while the save round-trips.
  const [posOverrides, setPosOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [assignments, applyAssignment] = useOptimistic(
    props.assignments,
    (state: SeatAssignmentRow[], action: AssignmentAction) => {
      if (action.kind === "unassign") return state.filter((a) => a.guest_id !== action.guestId);
      const moved = new Set(action.guestIds);
      return [
        ...state.filter((a) => !moved.has(a.guest_id)),
        ...action.guestIds.map((gid) => ({
          guest_id: gid,
          event_id: action.eventId,
          table_id: action.tableId,
          seat_number: null,
        })),
      ];
    },
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth));
    ro.observe(el);
    setCanvasW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const assignedIds = useMemo(() => new Set(assignments.map((a) => a.guest_id)), [assignments]);
  const attendingIds = useMemo(
    () => new Set(props.responses.filter((r) => r.attending === "yes").map((r) => r.guest_id)),
    [props.responses],
  );

  const allGuests = props.householdsWithGuests.flatMap((h) => h.guests.map((g) => ({ ...g, household: h.displayName })));
  const guestById = new Map(allGuests.map((g) => [g.id, g]));

  const unassigned = props.householdsWithGuests
    .map((h) => ({ ...h, guests: h.guests.filter((g) => attendingIds.has(g.id) && !assignedIds.has(g.id)) }))
    .filter((h) => h.guests.length > 0);

  const seatedCount = assignments.filter((a) => attendingIds.has(a.guest_id)).length;
  const attendingCount = attendingIds.size;

  const seatedByTable = useMemo(() => {
    const m = new Map<string, SeatAssignmentRow[]>();
    for (const a of assignments) {
      const list = m.get(a.table_id) ?? [];
      list.push(a);
      m.set(a.table_id, list);
    }
    return m;
  }, [assignments]);

  const dragCount = dragging && dragging.type !== "table" ? dragging.count : 0;
  const isMobile = useIsMobile();

  function tablePos(t: SeatingTableRow) {
    return posOverrides[t.id] ?? { x: t.pos_x, y: t.pos_y };
  }

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as
      | { type: "guest"; label: string }
      | { type: "household"; label: string; guestIds: string[] }
      | { type: "table"; label: string }
      | undefined;
    if (!data) return;
    setOpenTableId(null);
    setDragging({ type: data.type, label: data.label, count: data.type === "household" ? data.guestIds.length : 1 });
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const data = e.active.data.current as
      | { type: "guest"; guestId: string }
      | { type: "household"; guestIds: string[] }
      | { type: "table"; tableId: string }
      | undefined;
    if (!data) return;

    if (data.type === "table") {
      if (Math.abs(e.delta.x) < 2 && Math.abs(e.delta.y) < 2) return; // effectively a click — let it open the popover
      lastTableDragEnd.current = performance.now();
      const t = props.tables.find((t) => t.id === data.tableId);
      if (!t) return;
      const cur = tablePos(t);
      const dims = t.shape !== "round" ? RECT_DIMS : ROUND_DIMS;
      const canvas = canvasRef.current;
      const maxX = canvas ? Math.max(0, canvas.clientWidth - dims.w) : Infinity;
      const maxY = canvas ? Math.max(0, canvas.clientHeight - dims.h) : Infinity;
      const nx = clamp(Math.round((cur.x + e.delta.x) / GRID) * GRID, 0, maxX);
      const ny = clamp(Math.round((cur.y + e.delta.y) / GRID) * GRID, 0, maxY);
      setPosOverrides((p) => ({ ...p, [t.id]: { x: nx, y: ny } }));
      startTransition(() => saveTablePosition(t.id, nx, ny));
      return;
    }

    const overTable = e.over?.data.current as { tableId?: string } | undefined;
    if (!overTable?.tableId) return;
    const table = props.tables.find((t) => t.id === overTable.tableId);
    if (!table) return;

    const guestIds = data.type === "guest" ? [data.guestId] : data.guestIds;
    const remaining = table.capacity - (seatedByTable.get(table.id)?.length ?? 0);
    if (remaining < guestIds.length) {
      showToast(
        remaining <= 0
          ? `${table.name} is full`
          : `Only ${remaining} seat${remaining === 1 ? "" : "s"} left at ${table.name} — this group needs ${guestIds.length}`,
      );
      return;
    }

    startTransition(async () => {
      applyAssignment({ kind: "assign", guestIds, tableId: table.id, eventId: props.event.id });
      if (data.type === "guest") await assignGuest(data.guestId, props.event.id, table.id);
      else await assignHousehold(data.guestIds, props.event.id, table.id);
    });
  }

  function handleUnassign(guestId: string) {
    startTransition(async () => {
      applyAssignment({ kind: "unassign", guestId });
      await unassignGuest(guestId, props.event.id);
    });
  }

  function handleMobileAssign(guestIds: string[], tableId: string) {
    startTransition(async () => {
      applyAssignment({ kind: "assign", guestIds, tableId, eventId: props.event.id });
      await assignHousehold(guestIds, props.event.id, tableId);
    });
  }

  function handleTableClick(tableId: string) {
    // A click that lands right after a table drag is the tail of that drag, not a toggle.
    if (performance.now() - lastTableDragEnd.current < 300) return;
    setOpenTableId((cur) => (cur === tableId ? null : tableId));
  }

  if (isMobile) {
    const openTable = props.tables.find((t) => t.id === openTableId) ?? null;
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-ink">Seating — {props.event.name}</h1>
          <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
            {props.tables.length} tables · {seatedCount} of {attendingCount} attending guests seated
          </p>
        </div>
        {props.allEvents.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {props.allEvents.map((e) => (
              <Link
                key={e.id}
                href={`/admin/seating?event=${e.id}`}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium ${
                  e.id === props.event.id ? "bg-olive-deep text-cream" : "border border-[#dddbd0] text-[#4a5147]"
                }`}
              >
                {e.name}
              </Link>
            ))}
          </div>
        )}
        <p className="rounded-[10px] bg-blush px-3.5 py-3 text-[12px] leading-relaxed text-rose-deep">
          Arrange tables on a computer — here you can seat people. Tap a table to start.
        </p>
        {props.tables.map((t) => {
          const seated = seatedByTable.get(t.id) ?? [];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenTableId(t.id)}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-white/70 px-4 py-3.5 text-left active:bg-paper"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">{t.name}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-[#4a5147]">
                  {seated.length
                    ? seated.map((s) => guestById.get(s.guest_id)?.name).filter(Boolean).join(", ")
                    : "Empty"}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-[#f1f0ea] px-2.5 py-1 text-[11px] font-semibold text-[#6b7167]">
                {seated.length}/{t.capacity}
              </span>
            </button>
          );
        })}
        {!props.tables.length && (
          <p className="rounded-xl border border-hairline px-4 py-8 text-center text-[13px] text-muted">
            No tables yet — add them from a computer.
          </p>
        )}
        {openTable && (
          <MobileAssignSheet
            tableLabel={openTable.name}
            capacity={openTable.capacity}
            seated={(seatedByTable.get(openTable.id) ?? [])
              .map((a) => guestById.get(a.guest_id))
              .filter((g): g is NonNullable<typeof g> => Boolean(g))
              .map((g) => ({ id: g.id, name: g.name, ageType: g.ageType }))}
            unassigned={unassigned.map((h) => ({
              id: h.id,
              displayName: h.displayName,
              guests: h.guests.map((g) => ({ id: g.id, name: g.name, ageType: g.ageType })),
            }))}
            onAssign={(guestIds) => handleMobileAssign(guestIds, openTable.id)}
            onUnassign={handleUnassign}
            onClose={() => setOpenTableId(null)}
          />
        )}
      </div>
    );
  }

  return (
    <DndContext id="seating-dnd" sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-[22px] font-semibold text-ink">Seating — {props.event.name}</h1>
            <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
              {props.tables.length} tables · {seatedCount} of {attendingCount} attending guests seated
            </p>
          </div>

          {props.allEvents.length > 1 && (
            <div className="flex gap-1">
              {props.allEvents.map((e) => (
                <Link
                  key={e.id}
                  href={`/admin/seating?event=${e.id}`}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium ${
                    e.id === props.event.id ? "bg-olive-deep text-cream" : "border border-[#dddbd0] text-[#4a5147] hover:border-rose"
                  }`}
                >
                  {e.name}
                </Link>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => startTransition(() => setSeatingPublished(props.event.id, !props.event.seating_published_at))}
            className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${
              props.event.seating_published_at ? "bg-sage-band text-olive-deep" : "border border-[#dddbd0] text-[#6b7167]"
            }`}
          >
            <span
              className={`flex h-[17px] w-[30px] items-center rounded-full p-[2px] transition-colors ${
                props.event.seating_published_at ? "justify-end bg-olive" : "justify-start bg-[#c9c4b2]"
              }`}
            >
              <span className="h-[13px] w-[13px] rounded-full bg-white" />
            </span>
            Visible to guests
          </button>

          <Link
            href="/admin/print/escort-cards"
            className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose"
          >
            Escort cards
          </Link>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
          >
            Add table
          </button>
        </div>

        {adding && <AddTableForm eventId={props.event.id} nextNumber={props.tables.length + 1} onDone={() => setAdding(false)} />}

        <div className="flex items-start gap-4">
          <div
            ref={canvasRef}
            className="relative h-[640px] flex-1 overflow-hidden rounded-[14px] border border-[#e9e7da] bg-paper"
            style={{ backgroundImage: "radial-gradient(#e6e3d5 1px, transparent 1px)", backgroundSize: `${GRID * 2}px ${GRID * 2}px` }}
          >
            {props.tables.map((t) => {
              const seated = seatedByTable.get(t.id) ?? [];
              const pos = tablePos(t);
              const dims = t.shape !== "round" ? RECT_DIMS : ROUND_DIMS;
              return (
                <TableNode
                  key={t.id}
                  table={t}
                  pos={pos}
                  seatedNames={seated.map((s) => guestById.get(s.guest_id)?.name ?? "")}
                  dietaryCount={seated.filter((s) => guestById.get(s.guest_id)?.dietary).length}
                  dropState={
                    dragCount === 0 ? "idle" : t.capacity - seated.length >= dragCount ? "eligible" : "blocked"
                  }
                  isOpen={openTableId === t.id}
                  flip={canvasW > 0 && pos.x + dims.w + POPOVER_W + 16 > canvasW}
                  onToggle={() => handleTableClick(t.id)}
                  onUnassign={handleUnassign}
                  onDelete={() => startTransition(async () => {
                    setOpenTableId(null);
                    await removeTable(t.id);
                  })}
                  assignments={seated}
                  guestById={guestById}
                />
              );
            })}
            {!props.tables.length && (
              <p className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">
                No tables yet — click &quot;Add table&quot; to start the room.
              </p>
            )}

            <AnimatePresence>
              {toast && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="absolute left-1/2 top-3 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-cream shadow-[0_10px_24px_rgba(28,35,27,0.25)]"
                >
                  {toast}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <aside className="flex w-[280px] flex-shrink-0 flex-col gap-3 rounded-[14px] border border-hairline p-5">
            <div className="flex items-center">
              <h2 className="flex-1 text-[14.5px] font-semibold text-ink">Unassigned</h2>
              <span className="rounded-full bg-blush px-2.5 py-0.5 text-[11px] font-semibold text-rose">
                {unassigned.reduce((n, h) => n + h.guests.length, 0)}
              </span>
            </div>
            {unassigned.map((h) => (
              <div key={h.id} className="flex flex-col gap-1.5">
                <DraggableHousehold householdId={h.id} name={h.displayName} guestIds={h.guests.map((g) => g.id)} />
                {h.guests.map((g) => (
                  <DraggableGuest key={g.id} guestId={g.id} name={g.name} ageType={g.ageType} origin={g.origin} />
                ))}
              </div>
            ))}
            {!unassigned.length && (
              <p className="text-[13px] text-muted">Everyone attending has a seat. 🎉</p>
            )}
            <div className="rounded-[10px] bg-blush px-3.5 py-3 text-[12px] leading-relaxed text-rose-deep">
              Tip: drag a household name to seat everyone together.
            </div>
          </aside>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && dragging.type !== "table" && (
          <div className="flex rotate-2 items-center gap-2 rounded-[10px] border-[1.5px] border-olive bg-white px-3.5 py-2.5 shadow-[0_14px_32px_rgba(28,35,27,0.22)]">
            <span className="h-2 w-2 rounded-full bg-rose" />
            <span className="whitespace-nowrap text-[12.5px] font-semibold text-ink">{dragging.label}</span>
            {dragging.count > 1 && (
              <span className="rounded-full bg-blush px-2 py-0.5 text-[10.5px] font-semibold text-rose">{dragging.count} guests</span>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function DraggableGuest(props: { guestId: string; name: string; ageType: string; origin: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `guest:${props.guestId}`,
    data: { type: "guest", guestId: props.guestId, label: props.name },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab touch-none select-none items-center gap-2.5 rounded-[9px] border border-hairline bg-paper px-3 py-2.5 transition-colors hover:border-olive active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <span className="text-muted">⠿</span>
      <span className="flex-1 truncate text-[13px] font-medium text-ink">
        {props.name}
        {props.origin === "plus_one" && <span className="ml-1 text-[11px] text-rose">· plus one</span>}
      </span>
      <span className="text-[11.5px] text-muted capitalize">{props.ageType}</span>
    </div>
  );
}

function DraggableHousehold(props: { householdId: string; name: string; guestIds: string[] }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `household:${props.householdId}`,
    data: { type: "household", guestIds: props.guestIds, label: `${props.name} (${props.guestIds.length})` },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none select-none text-[11.5px] font-bold tracking-[0.08em] text-ink uppercase hover:text-rose active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {props.name}
    </div>
  );
}

function TableNode(props: {
  table: SeatingTableRow;
  pos: { x: number; y: number };
  seatedNames: string[];
  dietaryCount: number;
  dropState: "idle" | "eligible" | "blocked";
  isOpen: boolean;
  flip: boolean;
  onToggle: () => void;
  onUnassign: (guestId: string) => void;
  onDelete: () => void;
  assignments: SeatAssignmentRow[];
  guestById: Map<string, { name: string }>;
}) {
  const t = props.table;
  const full = props.seatedNames.length >= t.capacity;

  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `table:${t.id}`,
    data: { tableId: t.id },
  });
  const {
    attributes,
    listeners,
    setNodeRef: dragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `tablemove:${t.id}`,
    data: { type: "table", tableId: t.id, label: t.name },
  });

  const isRect = t.shape !== "round";
  const style: React.CSSProperties = {
    left: props.pos.x,
    top: props.pos.y,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    zIndex: isDragging || props.isOpen ? 10 : undefined,
  };

  const borderClass =
    props.dropState === "blocked"
      ? "border-[#d8d5c8] opacity-45"
      : props.dropState === "eligible"
        ? isOver
          ? "scale-[1.04] border-olive shadow-[0_0_0_5px_#dcedd0]"
          : "border-olive shadow-[0_0_0_3px_#eef5e6]"
        : full
          ? "border-olive"
          : "border-dashed border-rose";

  return (
    <div ref={dropRef} className="absolute" style={style}>
      <div
        ref={dragRef}
        {...listeners}
        {...attributes}
        onClick={props.onToggle}
        className={`flex cursor-grab touch-none select-none flex-col items-center justify-center gap-0.5 border-[1.5px] bg-white text-center transition-[transform,box-shadow,opacity] duration-150 active:cursor-grabbing ${
          isRect ? "h-[96px] w-[280px] rounded-[14px]" : "h-[136px] w-[136px] rounded-full"
        } ${borderClass} ${isDragging ? "opacity-60" : ""}`}
      >
        <span className="text-[13.5px] font-semibold text-ink">{t.name}</span>
        <span className={`text-[12px] font-medium ${full ? "text-olive" : "text-rose"}`}>
          {props.dropState === "eligible"
            ? `${t.capacity - props.seatedNames.length} open`
            : `${props.seatedNames.length} of ${t.capacity} seated`}
        </span>
        {props.dietaryCount > 0 && (
          <span className="text-[10.5px] text-muted">{props.dietaryCount} dietary</span>
        )}
      </div>
      {props.isOpen && (
        <div
          className={`absolute top-0 z-20 w-[200px] rounded-[10px] border border-hairline bg-white p-2 shadow-lg ${
            props.flip ? "right-full mr-2" : "left-full ml-2"
          }`}
        >
          <div className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-0.5">
            <span className="flex-1 truncate text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{t.name}</span>
            <span className="text-[10.5px] text-muted">
              {props.seatedNames.length}/{t.capacity}
            </span>
          </div>
          {props.assignments.map((a) => (
            <div key={a.guest_id} className="flex items-center gap-1.5 px-1.5 py-1">
              <span className="flex-1 truncate text-[12px] text-ink">{props.guestById.get(a.guest_id)?.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onUnassign(a.guest_id);
                }}
                className="text-[11px] font-medium text-rose hover:underline"
              >
                remove
              </button>
            </div>
          ))}
          {!props.assignments.length && (
            <>
              <p className="px-1.5 py-1 text-[12px] text-muted">No guests seated yet.</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete();
                }}
                className="mt-1 w-full rounded-[7px] px-1.5 py-1.5 text-left text-[11.5px] font-medium text-rose hover:bg-blush"
              >
                Delete table
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddTableForm(props: { eventId: string; nextNumber: number; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(`Table ${props.nextNumber}`);
  const [capacity, setCapacity] = useState(10);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-hairline bg-paper p-3.5">
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-48 rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px]" />
      <label className="flex items-center gap-2 text-[12.5px] text-[#4a5147]">
        Capacity
        <input
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
          className="w-16 rounded-lg border border-[#dddbd0] bg-white px-2 py-2 text-center text-[13px]"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await createTable(props.eventId, name, capacity);
            props.onDone();
          })
        }
        className="rounded-lg bg-olive-deep px-4 py-2 text-[12.5px] font-semibold text-cream hover:bg-rose disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={props.onDone} className="text-[12.5px] font-medium text-muted hover:text-rose">
        Cancel
      </button>
    </div>
  );
}
