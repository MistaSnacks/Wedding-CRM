"use client";
import { useMemo, useState } from "react";
import {
  addGuest,
  clampPosition,
  layoutWarnings,
  removeGuest,
  removeTable,
  setCapacity,
  setShape,
  unseat,
  assignDemo,
  type Draft,
  type LayoutTable,
} from "@/lib/venue/model";
import { addTableOfKind, duplicateTable, TABLE_KINDS, type TableKind } from "@/lib/venue/live-edit";
import { kindOf } from "@/lib/venue/seating-sync";
import GuestList from "./GuestList";
import type { DropPreview, TableHitTest } from "./drag";

export type Note = { text: string; tone: "ok" | "error" | "info" };

type Props = {
  draft: Draft;
  selected: string | null;
  canUndo: boolean;
  canRedo: boolean;
  commit: (next: Draft, note?: Note) => void;
  onSelect: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onNote: (n: Note) => void;
  onPick: (ids: string[], label: string) => void;
  hitTest: TableHitTest;
  preview: DropPreview;
  onHover: (id: string | null, ids: string[]) => void;
  onExport: (kind: "html" | "json" | "glb" | "png") => Promise<void>;
  onClose: () => void;
  /** Signed-in editor: each change saves to Seating. */
  live?: boolean;
  /** Live only: add a real guest through the Guests page's checks. */
  addGuest?: (name: string, family: string) => Promise<boolean>;
};

export default function LayoutEditor(p: Props) {
  const { draft } = p;
  const { tables, guests } = draft;
  const table = tables.find((t) => t.id === p.selected) ?? tables[0];
  const [tab, setTab] = useState<"tables" | "guests">("tables");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const warnings = useMemo(() => layoutWarnings(tables), [tables]);
  const seated = tables.reduce((n, t) => n + t.guestIds.length, 0);

  function fail(e: unknown) {
    p.onNote({ text: (e as Error).message, tone: "error" });
  }
  function commitTables(next: LayoutTable[], note?: Note) {
    p.commit({ ...draft, tables: next }, note);
    setConfirmRemove(false);
  }
  function update(patch: Partial<LayoutTable>, note?: Note) {
    const changed = { ...table, ...patch };
    commitTables(
      tables.map((t) => (t.id === table.id ? { ...changed, ...clampPosition(changed, changed.x, changed.z) } : t)),
      note,
    );
  }
  function add(kind: TableKind) {
    try {
      const { tables: next, added } = addTableOfKind(tables, kind);
      commitTables(next, { text: `${added.name} added with ${added.capacity} seats. Drag it wherever you like.`, tone: "ok" });
      p.onSelect(added.id);
      setAddOpen(false);
      setTab("tables");
    } catch (e) {
      fail(e);
    }
  }
  function duplicate() {
    try {
      const { tables: next, added } = duplicateTable(tables, table.id);
      commitTables(next, { text: `${added.name} is a copy of ${table.name}.`, tone: "ok" });
      p.onSelect(added.id);
    } catch (e) {
      fail(e);
    }
  }
  function remove() {
    try {
      const next = removeTable(tables, table.id);
      commitTables(next, {
        text: table.guestIds.length
          ? `${table.name} removed. ${table.guestIds.length} ${table.guestIds.length === 1 ? "guest needs" : "guests need"} a new seat.`
          : `${table.name} removed.`,
        tone: "ok",
      });
      p.onSelect(next[0].id);
    } catch (e) {
      fail(e);
    }
  }
  function seatGuests(tableId: string, ids: string[], label: string) {
    try {
      const next = assignDemo(tables, tableId, ids, guests);
      const name = next.find((t) => t.id === tableId)!.name;
      commitTables(next, {
        text: ids.length > 1 ? `${label} are now together at ${name}.` : `${label} is now at ${name}.`,
        tone: "ok",
      });
      p.onSelect(tableId);
    } catch (e) {
      fail(e);
    }
  }
  async function exportAs(kind: "html" | "json" | "glb" | "png") {
    setBusy(kind);
    try {
      await p.onExport(kind);
    } finally {
      setBusy(null);
    }
  }

  if (!table && !p.live) return null;
  return (
    <aside className="vl-editor venue-app" aria-label="Edit layout">
      <div className="vl-editor-head">
        <div>
          <h2>Edit layout</h2>
          <p className="vl-device">
            {p.live
              ? "Each change saves to your Seating page."
              : "Changes save on this device only. Your Seating page does not change."}
          </p>
        </div>
        <button type="button" className="vl-close" onClick={p.onClose} aria-label="Close the editor">
          ×
        </button>
      </div>

      <div className="vl-editor-actions">
        <button type="button" className="vl-add" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>
          <span aria-hidden>＋</span> Add
        </button>
        <button type="button" onClick={p.onUndo} disabled={!p.canUndo}>
          ↶ Undo
        </button>
        <button type="button" onClick={p.onRedo} disabled={!p.canRedo}>
          ↷ Redo
        </button>
      </div>
      {addOpen && (
        <div className="vl-add-menu" role="menu" aria-label="Add">
          {TABLE_KINDS.map((k) => (
            <button key={k.kind} type="button" role="menuitem" onClick={() => add(k.kind)}>
              <KindIcon kind={k.kind} />
              <span>
                <strong>{k.label}</strong>
                <small>{k.hint}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {!table ? (
        <section className="venue-card">
          <p className="venue-empty">No tables yet for this event. Use Add to place the first one.</p>
        </section>
      ) : (
      <>
      <div className="venue-segment vl-editor-tabs" role="group" aria-label="What would you like to do?">
        <button type="button" aria-pressed={tab === "tables"} className={tab === "tables" ? "active" : ""} onClick={() => setTab("tables")}>
          Arrange tables
        </button>
        <button type="button" aria-pressed={tab === "guests"} className={tab === "guests" ? "active" : ""} onClick={() => setTab("guests")}>
          Seat guests
        </button>
      </div>

      {tab === "tables" ? (
        <>
          <section className="venue-card" aria-label="Selected table">
            <label className="venue-field">
              Which table
              <select value={table.id} onChange={(e) => p.onSelect(e.target.value)}>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.guestIds.length}/{t.capacity}
                  </option>
                ))}
              </select>
            </label>
            <NameField key={table.id} value={table.name} onCommit={(name) => update({ name })} />
            <div className="venue-field">
              <span>Shape</span>
              <div className="venue-segment">
                {(
                  [
                    ["round", "round", "Round"],
                    ["long", "rect", "Long"],
                    ...(p.live ? ([["head", "rect", "Head"]] as const) : []),
                  ] as const
                ).map(([kind, shape, label]) => {
                  const on = p.live ? kindOf(table) === kind : table.shape === shape;
                  return (
                    <button
                      type="button"
                      key={kind}
                      aria-pressed={on}
                      className={on ? "active" : ""}
                      onClick={() =>
                        !on &&
                        commitTables(
                          tables.map((t) =>
                            t.id === table.id ? { ...(t.shape === shape ? t : setShape(t, shape)), kind } : t,
                          ),
                        )
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="venue-field">
              <span>Seats</span>
              <div className="venue-stepper">
                <button
                  type="button"
                  aria-label="One seat fewer"
                  disabled={table.capacity <= Math.max(1, table.guestIds.length)}
                  onClick={() => {
                    try {
                      commitTables(tables.map((t) => (t.id === table.id ? setCapacity(t, t.capacity - 1) : t)));
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  −
                </button>
                <output aria-live="polite">{table.capacity}</output>
                <button
                  type="button"
                  aria-label="One more seat"
                  disabled={table.capacity >= 16}
                  onClick={() => commitTables(tables.map((t) => (t.id === table.id ? setCapacity(t, t.capacity + 1) : t)))}
                >
                  +
                </button>
                <small className="venue-muted">{table.guestIds.length} seated</small>
              </div>
            </div>
            <div className="venue-field">
              <span>Turn</span>
              <div className="venue-row">
                <button type="button" onClick={() => update({ rotation: (table.rotation - 45 + 360) % 360 })}>
                  ↺ Turn left
                </button>
                <button type="button" onClick={() => update({ rotation: (table.rotation + 45) % 360 })}>
                  ↻ Turn right
                </button>
              </div>
            </div>
            <div className="venue-field">
              <span>Nudge</span>
              <div className="venue-nudge" aria-label="Move the table a little">
                <button type="button" aria-label="Move up" onClick={() => update({ z: table.z - 0.5 })}>
                  ↑
                </button>
                <button type="button" aria-label="Move left" onClick={() => update({ x: table.x - 0.5 })}>
                  ←
                </button>
                <button type="button" aria-label="Move right" onClick={() => update({ x: table.x + 0.5 })}>
                  →
                </button>
                <button type="button" aria-label="Move down" onClick={() => update({ z: table.z + 0.5 })}>
                  ↓
                </button>
              </div>
              <small className="venue-muted">Or just drag the table in the picture.</small>
            </div>
            <details className="venue-advanced">
              <summary>Exact position</summary>
              <div className="venue-fields">
                {(["x", "z"] as const).map((key) => (
                  <label className="venue-field" key={key}>
                    {key === "x" ? "Left to right (m)" : "Front to back (m)"}
                    <input
                      type="number"
                      step={0.25}
                      value={table[key]}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber;
                        if (Number.isFinite(n)) update({ [key]: n });
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
            <div className="venue-row">
              <button type="button" onClick={duplicate}>
                ⧉ Duplicate
              </button>
              {confirmRemove ? null : (
                <button
                  type="button"
                  className="venue-link-button venue-link-danger"
                  disabled={tables.length <= 1}
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove this table
                </button>
              )}
            </div>
            {confirmRemove && (
              <div className="venue-confirm venue-confirm-block">
                <span>
                  {table.guestIds.length
                    ? `${table.guestIds.length} ${table.guestIds.length === 1 ? "guest" : "guests"} will lose their seat. Remove ${table.name}?`
                    : `Remove ${table.name}?`}
                </span>
                <div className="venue-row">
                  <button type="button" className="venue-danger" onClick={remove}>
                    Yes, remove it
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)}>
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </section>
          <section className="venue-card" aria-label="Things to check">
            <h3>Things to check</h3>
            {warnings.length ? (
              <ul className="venue-warnings">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <p className="venue-muted">Looks good. No tables are crowding each other or the dance floor.</p>
            )}
            <p className="venue-fineprint">These are rough spacing checks, not the venue&apos;s approval.</p>
          </section>
        </>
      ) : (
        <>
          <section className="venue-card" aria-label="Selected table">
            <div className="venue-card-head">
              <div>
                <p className="venue-eyebrow">Selected table</p>
                <h2>{table.name}</h2>
              </div>
              <select aria-label="Choose a different table" value={table.id} onChange={(e) => p.onSelect(e.target.value)}>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.guestIds.length}/{t.capacity}
                  </option>
                ))}
              </select>
            </div>
            <div className="venue-seat-dots" aria-label={`${table.guestIds.length} of ${table.capacity} seats taken`}>
              {Array.from({ length: table.capacity }, (_, i) => (
                <span key={i} className={i < table.guestIds.length ? "taken" : ""} />
              ))}
            </div>
            <p className="venue-muted">
              {table.guestIds.length} of {table.capacity} seats taken
              {table.capacity - table.guestIds.length > 0 ? ` · ${table.capacity - table.guestIds.length} free` : " · full"}
            </p>
            {table.guestIds.length ? (
              <ul className="venue-seated">
                {table.guestIds.map((id) => {
                  const g = guests.find((x) => x.id === id);
                  if (!g) return null;
                  return (
                    <li key={id}>
                      <span>
                        {g.name}
                        <small>{g.household}</small>
                      </span>
                      <button
                        type="button"
                        className="venue-remove-text"
                        onClick={() => commitTables(unseat(tables, [id]), { text: `${g.name} no longer has a seat.`, tone: "info" })}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="venue-empty">No one is sitting here yet. Pick guests from the list below.</p>
            )}
          </section>
          <GuestList
            draft={draft}
            table={table}
            hitTest={p.hitTest}
            preview={p.preview}
            onHover={p.onHover}
            onDrop={seatGuests}
            onSeat={(ids, label) => seatGuests(table.id, ids, label)}
            onPick={p.onPick}
            onAddGuest={(name, family) => {
              if (p.addGuest) return p.addGuest(name, family);
              try {
                const next = addGuest(guests, name, family);
                const added = next[next.length - 1];
                p.commit({ ...draft, guests: next }, { text: `${added.name} is on the list. Find them under “Need a seat”.`, tone: "ok" });
                return true;
              } catch (e) {
                fail(e);
                return false;
              }
            }}
            onRemoveGuest={(id) => {
              const g = guests.find((x) => x.id === id);
              if (g) p.commit(removeGuest(draft, id), { text: `${g.name} was removed from the list.`, tone: "ok" });
            }}
          />
        </>
      )}
      </>
      )}

      <section className="venue-card vl-editor-foot">
        <p className="venue-muted">
          {tables.length} tables · {tables.reduce((n, t) => n + t.capacity, 0)} seats · {seated} of {guests.length} guests seated
        </p>
        {confirmReset ? (
          <div className="venue-confirm venue-confirm-block">
            <span>
              {p.live
                ? "Reload the saved plan from Seating? Saved changes stay saved."
                : "Clear your changes and go back to the tables from Seating?"}
            </span>
            <div className="venue-row">
              <button
                type="button"
                className="venue-danger"
                onClick={() => {
                  setConfirmReset(false);
                  p.onReset();
                }}
              >
                Yes, start over
              </button>
              <button type="button" onClick={() => setConfirmReset(false)}>
                Keep my plan
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="venue-link-button" onClick={() => setConfirmReset(true)}>
            {p.live ? "Reload saved plan" : "Start over"}
          </button>
        )}
        <details className="venue-team">
          <summary>Save a copy</summary>
          <div className="venue-row">
            <button type="button" onClick={() => exportAs("png")} disabled={!!busy}>
              {busy === "png" ? "Saving…" : "Picture (PNG)"}
            </button>
            <button type="button" onClick={() => exportAs("html")} disabled={!!busy}>
              {busy === "html" ? "Preparing…" : "Interactive HTML"}
            </button>
            <button type="button" onClick={() => exportAs("json")} disabled={!!busy}>
              Layout (JSON)
            </button>
            <button type="button" onClick={() => exportAs("glb")} disabled={!!busy}>
              {busy === "glb" ? "Exporting…" : "3D model (GLB)"}
            </button>
          </div>
        </details>
      </section>
    </aside>
  );
}

function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [name, setName] = useState(value);
  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(value);
      return;
    }
    if (trimmed !== value) onCommit(trimmed);
  }
  return (
    <label className="venue-field">
      Name
      <input
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

function KindIcon({ kind }: { kind: TableKind }) {
  const c = { width: 34, height: 34, viewBox: "0 0 34 34", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true };
  const chairs = (pts: [number, number][]) => pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.2} />);
  if (kind === "round")
    return (
      <svg {...c}>
        <circle cx="17" cy="17" r="8" />
        {chairs([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [17 + Math.cos(i * 0.785) * 13, 17 + Math.sin(i * 0.785) * 13]))}
      </svg>
    );
  if (kind === "long")
    return (
      <svg {...c}>
        <rect x="4" y="13" width="26" height="8" rx="1" />
        {chairs([6, 11.5, 17, 22.5, 28].flatMap((x) => [[x, 8], [x, 26]] as [number, number][]))}
      </svg>
    );
  return (
    <svg {...c}>
      <rect x="4" y="15" width="26" height="7" rx="1" />
      {chairs([7, 12, 17, 22, 27].map((x) => [x, 27]))}
      <path d="M13 9l4-4 4 4" />
    </svg>
  );
}
