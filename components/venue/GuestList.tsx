"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoGuest, Draft, LayoutTable } from "@/lib/venue/model";
import type { DropPreview, TableHitTest } from "./drag";

type Drag = {
  pointerId: number;
  ids: string[];
  label: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};
type Family = {
  name: string;
  members: DemoGuest[];
  shown: DemoGuest[];
  seated: number;
};
export default function GuestList({
  draft,
  table,
  hitTest,
  preview,
  onHover,
  onDrop,
  onSeat,
  onPick,
  onAddGuest,
  onRemoveGuest,
}: {
  draft: Draft;
  /** The table that "Seat at …" buttons target. */
  table: LayoutTable;
  hitTest: TableHitTest;
  preview: DropPreview;
  onHover: (id: string | null, ids: string[]) => void;
  onDrop: (id: string, ids: string[], label: string) => void;
  onSeat: (ids: string[], label: string) => void;
  onPick: (ids: string[], label: string) => void;
  onAddGuest: (name: string, family: string) => boolean;
  onRemoveGuest: (id: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [everyone, setEveryone] = useState(false),
    [ghost, setGhost] = useState<Drag | null>(null),
    [newName, setNewName] = useState(""),
    [newFamily, setNewFamily] = useState(""),
    [adding, setAdding] = useState(false);
  const drag = useRef<Drag | null>(null);
  const cancelRef = useRef(() => {});
  function cancel() {
    drag.current = null;
    setGhost(null);
    onHover(null, []);
  }
  cancelRef.current = cancel;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    const blur = () => cancelRef.current();
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const seatOf = useMemo(() => {
    const map = new Map<string, LayoutTable>();
    for (const t of draft.tables) for (const id of t.guestIds) map.set(id, t);
    return map;
  }, [draft.tables]);
  const unseatedCount = draft.guests.filter((g) => !seatOf.has(g.id)).length;
  const families = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byName = new Map<string, Family>();
    for (const g of draft.guests) {
      let f = byName.get(g.household);
      if (!f) {
        f = { name: g.household, members: [], shown: [], seated: 0 };
        byName.set(g.household, f);
      }
      f.members.push(g);
      if (seatOf.has(g.id)) f.seated++;
    }
    const out: Family[] = [];
    for (const f of byName.values()) {
      const familyMatches = !q || f.name.toLowerCase().includes(q);
      f.shown = f.members.filter(
        (g) =>
          (everyone || !seatOf.has(g.id)) &&
          (familyMatches || g.name.toLowerCase().includes(q)),
      );
      if (f.shown.length) out.push(f);
    }
    return out;
  }, [draft.guests, seatOf, search, everyone]);
  const familyNames = useMemo(
    () => [...new Set(draft.guests.map((g) => g.household))],
    [draft.guests],
  );

  function gripHandlers(ids: string[], label: string) {
    return {
      onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
        if (e.button !== 0 || !e.isPrimary) return;
        drag.current = {
          pointerId: e.pointerId,
          ids,
          label,
          startX: e.clientX,
          startY: e.clientY,
          x: e.clientX,
          y: e.clientY,
          active: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        d.x = e.clientX;
        d.y = e.clientY;
        d.active ||= Math.hypot(d.x - d.startX, d.y - d.startY) > 6;
        if (!d.active) return;
        setGhost({ ...d });
        onHover(hitTest(d.x, d.y), d.ids);
      },
      onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const target = d.active ? hitTest(e.clientX, e.clientY) : null;
        const wasDrag = d.active;
        cancel();
        if (target) onDrop(target, d.ids, d.label);
        else if (!wasDrag) onPick(ids, label);
      },
      onPointerCancel: cancel,
      onLostPointerCapture() {
        if (drag.current) cancel();
      },
    };
  }

  function seatLabel(g: DemoGuest) {
    const at = seatOf.get(g.id);
    if (!at) return null;
    return at.id === table.id ? "At this table" : at.name;
  }

  return (
    <section
      className="venue-card venue-guests"
      aria-label="Guests"
      data-tour="guests"
    >
      <div className="venue-card-head">
        <h3>Guests</h3>
        <span className="venue-muted">
          {unseatedCount === 0
            ? "Everyone has a seat"
            : `${unseatedCount} still need a seat`}
        </span>
      </div>
      <label className="venue-search">
        <span className="venue-sr">Search guests</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or family"
        />
      </label>
      <div
        className="venue-segment"
        role="group"
        aria-label="Which guests to show"
      >
        <button
          type="button"
          aria-pressed={!everyone}
          className={!everyone ? "active" : ""}
          onClick={() => setEveryone(false)}
        >
          Need a seat
        </button>
        <button
          type="button"
          aria-pressed={everyone}
          className={everyone ? "active" : ""}
          onClick={() => setEveryone(true)}
        >
          Everyone
        </button>
      </div>
      <p className="venue-hint">
        <strong>Seat here</strong> puts someone at {table.name}. You can also
        drag a name onto any table in the picture.
      </p>
      <div className="venue-families">
        {families.map((f) => {
          const allHere = f.members.every(
            (g) => seatOf.get(g.id)?.id === table.id,
          );
          const ids = f.members.map((g) => g.id);
          return (
            <div className="venue-family" key={f.name}>
              <div className="venue-family-head">
                <button
                  type="button"
                  className="venue-grip"
                  aria-label={`Drag the ${f.name} onto a table, or tap to choose a table`}
                  {...gripHandlers(ids, f.name)}
                >
                  ⠿
                </button>
                <div className="venue-family-title">
                  <strong>{f.name}</strong>
                  <span>
                    {f.seated === f.members.length
                      ? `All ${f.members.length} seated`
                      : `${f.seated} of ${f.members.length} seated`}
                  </span>
                </div>
                {f.members.length > 1 && !allHere && (
                  <button
                    type="button"
                    className="venue-mini"
                    onClick={() => onSeat(ids, `The ${f.name}`)}
                  >
                    Seat all {f.members.length} here
                  </button>
                )}
              </div>
              <ul>
                {f.shown.map((g) => {
                  const where = seatLabel(g);
                  const here = seatOf.get(g.id)?.id === table.id;
                  return (
                    <li className="venue-guest" key={g.id}>
                      <button
                        type="button"
                        className="venue-grip"
                        aria-label={`Drag ${g.name} onto a table, or tap to choose a table`}
                        {...gripHandlers([g.id], g.name)}
                      >
                        ⠿
                      </button>
                      <div className="venue-guest-name">
                        <span>{g.name}</span>
                        <small className={where ? "" : "venue-needs-seat"}>
                          {where ?? "No seat yet"}
                        </small>
                      </div>
                      {here ? (
                        <span className="venue-seated-badge">✓ Seated</span>
                      ) : (
                        <button
                          type="button"
                          className="venue-mini"
                          onClick={() => onSeat([g.id], g.name)}
                        >
                          {where ? "Move here" : "Seat here"}
                        </button>
                      )}
                      {g.id.startsWith("guest-") && (
                        <button
                          type="button"
                          className="venue-remove"
                          aria-label={`Remove ${g.name} from the list`}
                          title="Remove from the list"
                          onClick={() => onRemoveGuest(g.id)}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {!families.length && (
          <p className="venue-empty">
            {search
              ? `No one matches “${search}”.`
              : everyone
                ? "The list is empty."
                : "Everyone has a seat. Switch to Everyone to move people around."}
          </p>
        )}
      </div>
      <div className="venue-add">
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (onAddGuest(newName, newFamily)) {
                setNewName("");
                setNewFamily("");
                setAdding(false);
              }
            }}
          >
            <label className="venue-field">
              Guest's name
              <input
                autoFocus
                value={newName}
                maxLength={60}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Aunt María"
              />
            </label>
            <label className="venue-field">
              Family or group <span className="venue-optional">optional</span>
              <input
                list="venue-family-names"
                value={newFamily}
                maxLength={60}
                onChange={(e) => setNewFamily(e.target.value)}
                placeholder="e.g. Ramírez family"
              />
              <datalist id="venue-family-names">
                {familyNames.map((n) => (
                  <option value={n} key={n} />
                ))}
              </datalist>
            </label>
            <div className="venue-row">
              <button type="submit" className="venue-primary">
                Add to the list
              </button>
              <button type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="venue-link-button"
            onClick={() => setAdding(true)}
          >
            + Add someone to the list
          </button>
        )}
      </div>
      {ghost && (
        <div
          className={`venue-drag-ghost ${preview && !preview.valid ? "invalid" : ""}`}
          style={{ left: ghost.x + 14, top: ghost.y + 14 }}
          aria-hidden="true"
        >
          <strong>{ghost.label}</strong>
          <span>{preview?.label ?? "Drop onto a table"}</span>
        </div>
      )}
      <p className="venue-sr" role="status">
        {ghost ? (preview?.label ?? "Move over a table to seat them.") : ""}
      </p>
    </section>
  );
}
