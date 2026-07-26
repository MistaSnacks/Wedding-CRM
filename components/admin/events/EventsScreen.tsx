"use client";

import { useRef, useState, useTransition } from "react";
import { EventForm } from "./EventForm";
import { InvitePicker, type HouseholdView } from "./InvitePicker";
import { DeleteEventButton } from "./DeleteEventButton";
import { reorderEvents, type EventFormState } from "@/app/admin/(dashboard)/events/actions";

/**
 * The events screen: a short, ordered list of what she's hosting.
 *
 * Deliberately not a data grid. It's the schedule card from an invitation
 * suite — the name first, then when and where, then how many people it
 * concerns — because the whole list is five rows on a good day and she reads
 * it, rather than querying it.
 *
 * Reordering is optimistic and rolls back if the write fails. Invite counts
 * come from a local copy of the invite list so a tick updates the number under
 * her cursor immediately; the server's own count follows on the next render
 * and would win if they ever disagreed.
 */

export type EventView = {
  id: string;
  name: string;
  /** Preformatted in the wedding's timezone by the page. */
  whenLabel: string | null;
  dateField: string;
  timeField: string;
  endsAt: string | null;
  venueName: string;
  venueAddress: string;
  dressCode: string;
  /** Her stated scope: everyone, or a chosen few. */
  everyone: boolean;
  rsvpEnabled: boolean;
  /** Households where at least one guest actually answered. */
  replied: number;
  /** Of those, how many are no longer on the invite list. */
  repliedNotInvited: number;
  invitedHouseholdIds: string[];
};

export function EventsScreen({
  events,
  households,
}: {
  events: EventView[];
  households: HouseholdView[];
}) {
  const [order, setOrder] = useState<string[]>(() => events.map((e) => e.id));
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<{ id: string; tab: "edit" | "invites" } | null>(null);
  const [invites, setInvites] = useState<Record<string, string[]>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const orderBeforeDrag = useRef<string[] | null>(null);

  // Local order, reconciled with the server on every render: ids that have
  // been deleted drop out, and anything new (including one just created)
  // lands at the end, which is where `create` puts it too.
  const byId = new Map(events.map((e) => [e.id, e]));
  const ordered: EventView[] = [
    ...order.map((id) => byId.get(id)).filter((e): e is EventView => e !== undefined),
    ...events.filter((e) => !order.includes(e.id)),
  ];

  const invitedIds = (event: EventView) => invites[event.id] ?? event.invitedHouseholdIds;

  function commitOrder(ids: string[], rollbackTo: string[]) {
    if (ids.join() === rollbackTo.join()) return;
    setOrder(ids);
    setOrderError(null);
    startTransition(async () => {
      const result = await reorderEvents(ids);
      if (!result.ok) {
        setOrder(rollbackTo);
        setOrderError(result.message ?? "That order didn't save.");
      }
    });
  }

  function move(id: string, delta: number) {
    const ids = ordered.map((e) => e.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    commitOrder(next, ids);
  }

  function onDragEnter(overId: string) {
    if (dragId === null || dragId === overId) return;
    const ids = ordered.map((e) => e.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
  }

  function onDragEnd() {
    const before = orderBeforeDrag.current;
    setDragId(null);
    setLiftedId(null);
    orderBeforeDrag.current = null;
    if (before) commitOrder(ordered.map((e) => e.id), before);
  }

  function afterSave(result: EventFormState) {
    setAdding(false);
    setOpen(
      result.openInvites && result.savedEventId
        ? { id: result.savedEventId, tab: "invites" }
        : null,
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold text-ink">Events</h1>
          <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
            {events.length === 0
              ? "Everything you're hosting, in the order it happens."
              : `${events.length} ${events.length === 1 ? "event" : "events"} · drag them into the order they happen`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setOpen(null);
          }}
          className="rounded-lg bg-olive-deep px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
        >
          Add event
        </button>
      </div>

      {orderError && (
        <p
          role="alert"
          className="rounded-lg border border-blush-border bg-blush px-3.5 py-2.5 text-[12.5px] text-rose-deep"
        >
          {orderError}
        </p>
      )}

      {adding && (
        <section className="rounded-2xl border border-hairline bg-white/70">
          <p className="border-b border-[#f1f0ea] px-5 pt-5 pb-3 text-[11px] font-semibold tracking-[0.12em] text-[#9aa38f] uppercase sm:px-7">
            A new event
          </p>
          <EventForm
            eventId={null}
            initial={{
              name: "",
              date: "",
              time: "",
              endsAt: null,
              venueName: "",
              venueAddress: "",
              dressCode: "",
              everyone: true,
              rsvpEnabled: true,
            }}
            repliedHouseholds={0}
            onSaved={afterSave}
            onCancel={() => setAdding(false)}
          />
        </section>
      )}

      <ul className="flex flex-col gap-3">
        {ordered.map((event, index) => {
          const selected = invitedIds(event);
          const panel = open?.id === event.id ? open.tab : null;
          const isEveryone =
            event.everyone && households.length > 0 && selected.length === households.length;
          const where = [event.venueName, event.venueAddress].filter(Boolean).join(", ");

          return (
            <li
              key={event.id}
              draggable={liftedId === event.id}
              onDragStart={() => {
                orderBeforeDrag.current = ordered.map((e) => e.id);
                setDragId(event.id);
              }}
              onDragEnter={() => onDragEnter(event.id)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={onDragEnd}
              className={`group rounded-2xl border bg-white/70 transition-all duration-200 ${
                dragId === event.id
                  ? "border-olive opacity-70 shadow-[0_12px_30px_rgba(28,35,27,0.14)]"
                  : "border-hairline"
              }`}
            >
              <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
                <Handle
                  position={`${index + 1} of ${ordered.length}`}
                  name={event.name}
                  onLift={(lifted) => setLiftedId(lifted ? event.id : null)}
                  onUp={() => move(event.id, -1)}
                  onDown={() => move(event.id, 1)}
                  canGoUp={index > 0}
                  canGoDown={index < ordered.length - 1}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <h2 className="font-display text-[23px] leading-tight font-medium text-olive-deep">
                      {event.name}
                    </h2>
                    {isEveryone && (
                      <span className="rounded-full bg-sage-band px-2.5 py-0.5 text-[10.5px] font-semibold tracking-[0.06em] text-olive-deep uppercase">
                        Everyone
                      </span>
                    )}
                    {!event.rsvpEnabled && (
                      <span className="rounded-full bg-[#f1f0ea] px-2.5 py-0.5 text-[10.5px] font-semibold tracking-[0.06em] text-[#6b7167] uppercase">
                        No RSVPs
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[13px] text-[#4a5147]">
                    {event.whenLabel === null ? (
                      <span className="text-muted italic">No date yet</span>
                    ) : (
                      event.whenLabel
                    )}
                    {where.length > 0 && <span className="text-[#c9cdbf]">{" · "}</span>}
                    {where.length > 0 && where}
                  </p>

                  {event.dressCode.length > 0 && (
                    <p className="mt-0.5 text-[12.5px] text-muted">{event.dressCode}</p>
                  )}

                  {selected.length === 0 && (
                    <p className="mt-2 text-[12.5px] font-medium text-rose-deep">
                      {"Nobody's invited to this yet, so nobody can see it or reply to it."}
                    </p>
                  )}
                </div>

                <div className="flex-shrink-0 pt-1 text-right">
                  <p className="text-[13px] text-[#4a5147]">
                    <b className="text-[15px] font-semibold text-ink tabular-nums">
                      {selected.length}
                    </b>
                    {selected.length === 1 ? " household invited" : " households invited"}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    <b className="font-semibold tabular-nums">{event.replied}</b>
                    {event.replied === 1 ? " has replied" : " have replied"}
                  </p>
                  {event.repliedNotInvited > 0 && (
                    <p className="mt-1 max-w-[19rem] text-[11.5px] leading-snug text-rose-deep">
                      {event.repliedNotInvited === 1
                        ? "Includes 1 household you've since un-invited. Their reply is kept in case they come back."
                        : `Includes ${event.repliedNotInvited} households you've since un-invited. Their replies are kept in case they come back.`}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-[#f1f0ea] px-4 py-2.5 sm:px-5">
                <PanelTab
                  active={panel === "invites"}
                  onClick={() =>
                    setOpen(panel === "invites" ? null : { id: event.id, tab: "invites" })
                  }
                >
                  {selected.length === 0 ? "Choose who's coming" : "Who's invited"}
                </PanelTab>
                <PanelTab
                  active={panel === "edit"}
                  onClick={() => setOpen(panel === "edit" ? null : { id: event.id, tab: "edit" })}
                >
                  Edit
                </PanelTab>
                <span className="flex-1" />
                <DeleteEventButton
                  eventId={event.id}
                  eventName={event.name}
                  onDeleted={() => setOpen(null)}
                />
              </div>

              {panel === "edit" && (
                <div className="border-t border-[#f1f0ea] bg-paper/50">
                  <EventForm
                    eventId={event.id}
                    initial={{
                      name: event.name,
                      date: event.dateField,
                      time: event.timeField,
                      endsAt: event.endsAt,
                      venueName: event.venueName,
                      venueAddress: event.venueAddress,
                      dressCode: event.dressCode,
                      everyone: event.everyone,
                      rsvpEnabled: event.rsvpEnabled,
                    }}
                    repliedHouseholds={event.replied}
                    onSaved={afterSave}
                    onCancel={() => setOpen(null)}
                  />
                </div>
              )}

              {panel === "invites" && (
                <div className="border-t border-[#f1f0ea] bg-paper/50">
                  <InvitePicker
                    eventId={event.id}
                    eventName={event.name}
                    households={households}
                    selected={selected}
                    onChange={(next) => setInvites((prev) => ({ ...prev, [event.id]: next }))}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {ordered.length === 0 && !adding && (
        <div className="rounded-2xl border border-hairline bg-white/60 px-7 py-12 text-center">
          <p className="font-display text-[24px] font-medium text-olive-deep">
            No events yet
          </p>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13.5px] leading-relaxed text-[#4a5147]">
            {"Add the ceremony first, then anything else you're hosting — a welcome party, a rehearsal dinner, a farewell brunch."}
          </p>
        </div>
      )}
    </div>
  );
}

function PanelTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[12.5px] font-medium transition-colors ${
        active ? "text-rose underline decoration-rose underline-offset-4" : "text-[#4a5147] hover:text-rose"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Drag handle plus two arrows. Dragging is the obvious gesture, but it is
 * mouse-only and unreachable by keyboard, so the arrows are the real control
 * and the drag is the shortcut.
 */
function Handle({
  position,
  name,
  onLift,
  onUp,
  onDown,
  canGoUp,
  canGoDown,
}: {
  position: string;
  name: string;
  onLift: (lifted: boolean) => void;
  onUp: () => void;
  onDown: () => void;
  canGoUp: boolean;
  canGoDown: boolean;
}) {
  const arrow =
    "flex h-4 w-5 items-center justify-center rounded text-[#b9bfae] opacity-0 transition-all group-hover:opacity-100 hover:bg-sage-band hover:text-olive-deep focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-0";

  return (
    <div className="flex w-5 flex-shrink-0 flex-col items-center pt-1.5">
      <button type="button" onClick={onUp} disabled={!canGoUp} aria-label={`Move ${name} earlier`} className={arrow}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <span
        onMouseDown={() => onLift(true)}
        onMouseUp={() => onLift(false)}
        title={`Drag to reorder — currently ${position}`}
        className="flex h-5 cursor-grab items-center text-[#d5d9cb] transition-colors group-hover:text-[#a8b09c] hover:!text-olive-deep active:cursor-grabbing"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="5" r="1.7" />
          <circle cx="15" cy="5" r="1.7" />
          <circle cx="9" cy="12" r="1.7" />
          <circle cx="15" cy="12" r="1.7" />
          <circle cx="9" cy="19" r="1.7" />
          <circle cx="15" cy="19" r="1.7" />
        </svg>
      </span>
      <button type="button" onClick={onDown} disabled={!canGoDown} aria-label={`Move ${name} later`} className={arrow}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
