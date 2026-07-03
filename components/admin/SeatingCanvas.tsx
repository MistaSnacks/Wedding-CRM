"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
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
  saveTablePosition,
  setSeatingPublished,
} from "@/app/admin/(dashboard)/seating/actions";
import type { EventRow, SeatingTableRow, SeatAssignmentRow, ResponseRow, MealOptionRow } from "@/lib/types";

type HH = {
  id: string;
  displayName: string;
  guests: Array<{ id: string; name: string; ageType: string; origin: string; dietary: boolean }>;
};

export function SeatingCanvas(props: {
  event: EventRow;
  allEvents: EventRow[];
  tables: SeatingTableRow[];
  assignments: SeatAssignmentRow[];
  householdsWithGuests: HH[];
  responses: ResponseRow[];
  meals: MealOptionRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState<{ type: "guest" | "household" | "table"; label: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const assignedIds = useMemo(() => new Set(props.assignments.map((a) => a.guest_id)), [props.assignments]);
  const attendingIds = useMemo(
    () => new Set(props.responses.filter((r) => r.attending === "yes").map((r) => r.guest_id)),
    [props.responses],
  );

  const allGuests = props.householdsWithGuests.flatMap((h) => h.guests.map((g) => ({ ...g, household: h.displayName })));
  const guestById = new Map(allGuests.map((g) => [g.id, g]));

  const unassigned = props.householdsWithGuests
    .map((h) => ({ ...h, guests: h.guests.filter((g) => attendingIds.has(g.id) && !assignedIds.has(g.id)) }))
    .filter((h) => h.guests.length > 0);

  const seatedCount = props.assignments.filter((a) => attendingIds.has(a.guest_id)).length;
  const attendingCount = attendingIds.size;

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { type: "guest" | "household" | "table"; label: string } | undefined;
    if (data) setDragging(data);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const data = e.active.data.current as
      | { type: "guest"; guestId: string }
      | { type: "household"; guestIds: string[] }
      | { type: "table"; tableId: string; posX: number; posY: number }
      | undefined;
    if (!data) return;

    if (data.type === "table") {
      const nx = Math.max(0, data.posX + e.delta.x);
      const ny = Math.max(0, data.posY + e.delta.y);
      startTransition(() => saveTablePosition(data.tableId, nx, ny));
      return;
    }

    const overTable = e.over?.data.current as { tableId?: string } | undefined;
    if (!overTable?.tableId) return;
    startTransition(() =>
      data.type === "guest"
        ? assignGuest(data.guestId, props.event.id, overTable.tableId!)
        : assignHousehold(data.guestIds, props.event.id, overTable.tableId!),
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className={`flex flex-col gap-5 ${pending ? "opacity-80" : ""}`}>
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
          <div className="relative h-[640px] flex-1 overflow-hidden rounded-[14px] border border-[#e9e7da] bg-paper">
            {props.tables.map((t) => {
              const seated = props.assignments.filter((a) => a.table_id === t.id);
              return (
                <TableNode
                  key={t.id}
                  table={t}
                  seatedNames={seated.map((s) => guestById.get(s.guest_id)?.name ?? "")}
                  dietaryCount={seated.filter((s) => guestById.get(s.guest_id)?.dietary).length}
                  onUnassign={(guestId) => startTransition(() => unassignGuest(guestId, props.event.id))}
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

      <DragOverlay>
        {dragging && (
          <motion.div
            initial={{ scale: 1 }}
            animate={{ scale: 1.04 }}
            className="flex items-center gap-2 rounded-[10px] border-[1.5px] border-olive bg-white px-3.5 py-2.5 shadow-[0_12px_28px_rgba(28,35,27,0.18)]"
          >
            <span className="h-2 w-2 rounded-full bg-rose" />
            <span className="whitespace-nowrap text-[12.5px] font-semibold text-ink">{dragging.label}</span>
          </motion.div>
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
      className={`flex cursor-grab items-center gap-2.5 rounded-[9px] border border-hairline bg-paper px-3 py-2.5 ${isDragging ? "opacity-40" : ""}`}
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
      className={`cursor-grab text-[11px] font-semibold tracking-[0.08em] text-muted uppercase hover:text-rose ${isDragging ? "opacity-40" : ""}`}
    >
      {props.name}
    </div>
  );
}

function TableNode(props: {
  table: SeatingTableRow;
  seatedNames: string[];
  dietaryCount: number;
  assignments: SeatAssignmentRow[];
  guestById: Map<string, { name: string }>;
  onUnassign: (guestId: string) => void;
}) {
  const t = props.table;
  const [open, setOpen] = useState(false);
  const full = props.seatedNames.length >= t.capacity;

  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `table:${t.id}`, data: { tableId: t.id } });
  const {
    attributes,
    listeners,
    setNodeRef: dragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `tablemove:${t.id}`,
    data: { type: "table", tableId: t.id, posX: t.pos_x, posY: t.pos_y, label: t.name },
  });

  const isRect = t.shape !== "round";
  const style: React.CSSProperties = {
    left: t.pos_x,
    top: t.pos_y,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };

  return (
    <div ref={dropRef} className="absolute" style={style}>
      <div
        ref={dragRef}
        {...listeners}
        {...attributes}
        onClick={() => setOpen((o) => !o)}
        className={`flex cursor-grab flex-col items-center justify-center gap-0.5 border-[1.5px] bg-white text-center transition-shadow ${
          isRect ? "h-[96px] w-[280px] rounded-[14px]" : "h-[136px] w-[136px] rounded-full"
        } ${isOver ? "border-olive shadow-[0_0_0_4px_#e9f4e1]" : full ? "border-olive" : "border-dashed border-rose"} ${
          isDragging ? "opacity-60" : ""
        }`}
      >
        <span className="text-[13.5px] font-semibold text-ink">{t.name}</span>
        <span className={`text-[12px] font-medium ${full ? "text-olive" : "text-rose"}`}>
          {props.seatedNames.length} of {t.capacity} seated
        </span>
        {props.dietaryCount > 0 && (
          <span className="text-[10.5px] text-muted">{props.dietaryCount} dietary</span>
        )}
      </div>
      {open && props.assignments.length > 0 && (
        <div className="absolute left-full top-0 z-10 ml-2 w-[190px] rounded-[10px] border border-hairline bg-white p-2 shadow-lg">
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
