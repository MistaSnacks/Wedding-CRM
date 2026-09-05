"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addGuest,
  addTable,
  assignDemo,
  clampPosition,
  initialDraft,
  layoutWarnings,
  parseSavedDraft,
  removeGuest,
  removeTable,
  setCapacity,
  setShape,
  unseat,
  type Draft,
  type LayoutTable,
} from "@/lib/venue/model";
import GuestList from "./GuestList";
import FloorPlan from "./FloorPlan";
import Tour, { type TourStep } from "./Tour";
import type { DropPreview, TableHitTest } from "./drag";
import references from "@/lib/venue/references.json";

const Scene = dynamic(() => import("./VenueScene"), {
  ssr: false,
  loading: () => (
    <div className="venue-render venue-loading">Preparing the venue…</div>
  ),
});
const KEY = "benavento-terrace-concept-v1";
const TOUR_KEY = "benavento-terrace-tour-v1";
const TOUR: TourStep[] = [
  {
    target: "stage",
    title: "This is the terrace",
    text: "Drag to look around and scroll to zoom. Tap any table to see who's sitting there.",
  },
  {
    target: "views",
    title: "Two ways to look at it",
    text: "Floor plan shows the same tables from above. Venue photos shows the real place.",
  },
  {
    target: "table",
    title: "The table you tapped",
    text: "Everyone sitting at it shows up here. Remove takes someone off again.",
  },
  {
    target: "guests",
    title: "Give people a seat",
    text: "Guests who still need a seat are listed by family. Press Seat here, or drag a name onto any table in the picture.",
  },
  {
    target: "modes",
    title: "Move things around",
    text: "Switch to Arrange tables to drag tables, add one, rename it, or change how many seats it has.",
  },
  {
    target: "actions",
    title: "Nothing can go wrong",
    text: "Undo takes back your last change. Start over brings the example back. Everything saves on this device.",
  },
];
type View = "3d" | "plan" | "photos";
type Mode = "seat" | "arrange";
type Pick = { ids: string[]; label: string } | null;
type Message = { text: string; tone: "ok" | "error" | "info" };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function VenuePrototype() {
  const [draft, setDraft] = useState<Draft>(initialDraft),
    [selected, setSelected] = useState("table-1"),
    [view, setView] = useState<View>("3d"),
    [mode, setMode] = useState<Mode>("seat"),
    [roof, setRoof] = useState(false),
    [warmLight, setWarmLight] = useState(true),
    [history, setHistory] = useState<Draft[]>([]),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState<Message | null>(null),
    [pick, setPick] = useState<Pick>(null),
    [dropPreview, setDropPreview] = useState<DropPreview>(null),
    [exporting, setExporting] = useState(false),
    [confirmReset, setConfirmReset] = useState(false),
    [confirmRemove, setConfirmRemove] = useState(false),
    [photoFilter, setPhotoFilter] = useState("All"),
    [tour, setTour] = useState(false);
  const sceneHitTest = useRef<TableHitTest | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setDraft(parseSavedDraft(JSON.parse(raw)));
    } catch {
      setMessage({
        text: "We couldn't open your last plan, so here's a fresh example.",
        tone: "info",
      });
    }
    setReady(true);
    let seen = true;
    try {
      seen = Boolean(localStorage.getItem(TOUR_KEY));
    } catch {}
    if (!seen) {
      const t = setTimeout(() => setTour(true), 900);
      return () => clearTimeout(t);
    }
  }, []);
  function startTour() {
    setMode("seat");
    if (view === "photos") setView("3d");
    setPick(null);
    setTour(true);
  }
  function endTour() {
    setTour(false);
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch {}
  }
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(draft));
    } catch {
      setMessage({
        text: "This browser can't save your plan. Use “For the design team” to download a copy.",
        tone: "error",
      });
    }
  }, [draft, ready]);

  const { tables, guests } = draft;
  const table = tables.find((t) => t.id === selected) ?? tables[0];
  const warnings = useMemo(() => layoutWarnings(tables), [tables]);
  const seatedCount = tables.reduce((n, t) => n + t.guestIds.length, 0),
    seatCount = tables.reduce((n, t) => n + t.capacity, 0),
    unseatedCount = guests.length - seatedCount;

  function commit(next: Draft, note?: Message) {
    setHistory((h) => [...h.slice(-29), draft]);
    setDraft(next);
    setMessage(note ?? null);
    setConfirmReset(false);
    setConfirmRemove(false);
  }
  function fail(e: unknown) {
    setMessage({ text: (e as Error).message, tone: "error" });
  }
  function commitTables(next: LayoutTable[], note?: Message) {
    commit({ ...draft, tables: next }, note);
  }
  function updateTable(patch: Partial<LayoutTable>, note?: Message) {
    const changed = { ...table, ...patch };
    commitTables(
      tables.map((t) =>
        t.id === table.id
          ? { ...changed, ...clampPosition(changed, changed.x, changed.z) }
          : t,
      ),
      note,
    );
  }
  function place(id: string, x: number, z: number) {
    commitTables(
      tables.map((t) =>
        t.id === id ? { ...t, ...clampPosition(t, x, z) } : t,
      ),
    );
  }
  function seatGuests(tableId: string, ids: string[], label: string) {
    try {
      const next = assignDemo(tables, tableId, ids, guests);
      const name = next.find((t) => t.id === tableId)!.name;
      commitTables(next, {
        text:
          ids.length > 1
            ? `${label} are now together at ${name}.`
            : `${label} is now at ${name}.`,
        tone: "ok",
      });
      setSelected(tableId);
    } catch (e) {
      fail(e);
    }
  }
  function selectTable(id: string) {
    if (pick) {
      seatGuests(id, pick.ids, pick.label);
      setPick(null);
    } else setSelected(id);
  }
  function startPick(ids: string[], label: string) {
    setPick({ ids, label });
    setMessage(null);
  }
  function hitTest(x: number, y: number) {
    if (view === "3d") return sceneHitTest.current?.(x, y) ?? null;
    return (
      document
        .elementFromPoint(x, y)
        ?.closest(".venue-plan [data-table]")
        ?.getAttribute("data-table") ?? null
    );
  }
  function previewDrop(id: string | null, ids: string[]) {
    const target = tables.find((t) => t.id === id);
    if (!target) {
      setDropPreview(null);
      return;
    }
    let valid = true,
      reason = "";
    try {
      assignDemo(tables, target.id, ids, guests);
    } catch (e) {
      valid = false;
      reason = (e as Error).message;
    }
    const label = valid ? `Let go to seat at ${target.name}` : reason;
    setDropPreview((previous) =>
      previous?.id === id &&
      previous.valid === valid &&
      previous.label === label
        ? previous
        : { id: target.id, valid, label },
    );
  }
  function handleAddTable() {
    try {
      const next = addTable(tables);
      const added = next[next.length - 1];
      commitTables(next, {
        text: `${added.name} added with 8 seats. Drag it wherever you like.`,
        tone: "ok",
      });
      setSelected(added.id);
    } catch (e) {
      fail(e);
    }
  }
  function handleRemoveTable() {
    try {
      const next = removeTable(tables, table.id);
      commitTables(next, {
        text:
          table.guestIds.length > 0
            ? `${table.name} removed. ${table.guestIds.length} ${table.guestIds.length === 1 ? "guest needs" : "guests need"} a new seat.`
            : `${table.name} removed.`,
        tone: "ok",
      });
      setSelected(next[0].id);
    } catch (e) {
      fail(e);
    }
  }
  function handleAddGuest(name: string, family: string) {
    try {
      const nextGuests = addGuest(guests, name, family);
      const added = nextGuests[nextGuests.length - 1];
      commit(
        { ...draft, guests: nextGuests },
        {
          text: `${added.name} is on the list. Find them under “Need a seat”.`,
          tone: "ok",
        },
      );
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  function handleRemoveGuest(id: string) {
    const g = guests.find((g) => g.id === id);
    if (!g) return;
    commit(removeGuest(draft, id), {
      text: `${g.name} was removed from the list.`,
      tone: "ok",
    });
  }
  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setDraft(previous);
    setHistory((h) => h.slice(0, -1));
    setMessage({ text: "Undone.", tone: "info" });
  }
  function reset() {
    commit(initialDraft(), {
      text: "Back to the example plan.",
      tone: "info",
    });
    setSelected("table-1");
    setPick(null);
  }
  async function exportModel() {
    setExporting(true);
    try {
      const [
        { GLTFExporter },
        { buildShell, buildFurniture, disposeObject },
        THREE,
      ] = await Promise.all([
        import("three/addons/exporters/GLTFExporter.js"),
        import("@/lib/venue/scene"),
        import("three"),
      ]);
      const scene = new THREE.Scene();
      scene.add(buildShell(), buildFurniture(tables));
      try {
        const result = await new GLTFExporter().parseAsync(scene, {
          binary: true,
        });
        download(
          new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }),
          "benavento-terrace-concept.glb",
        );
        setMessage({
          text: "3D model downloaded. It opens in Blender via File → Import → glTF 2.0.",
          tone: "ok",
        });
      } finally {
        disposeObject(scene);
      }
    } catch {
      setMessage({
        text: "The 3D export didn't work. Your plan is still saved here.",
        tone: "error",
      });
    } finally {
      setExporting(false);
    }
  }
  function downloadLayout() {
    download(
      new Blob(
        [
          JSON.stringify(
            {
              venue: "Benavento terrace concept",
              units: "metres",
              dimensions: { width: 28, depth: 28, height: 8 },
              verifiedAsBuilt: false,
              ...draft,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "venue-layout-concept.json",
    );
    setMessage({ text: "Layout file downloaded.", tone: "ok" });
  }

  const hint = pick
    ? ""
    : mode === "arrange"
      ? view === "3d"
        ? "Drag a table to move it. Drag the empty floor to look around, scroll to zoom."
        : "Drag a table to move it."
      : view === "3d"
        ? "Tap a table to see who's sitting there. Drag to look around, scroll to zoom."
        : "Tap a table to see who's sitting there.";

  return (
    <main className="venue-app">
      <header className="venue-header">
        <div>
          <a className="venue-back" href="/admin/seating">
            ← Back to seating
          </a>
          <p className="venue-eyebrow">Benavento · Terraza Panorámica</p>
          <h1>Try out your seating plan</h1>
          <p className="venue-lede">
            Tap a table to see who's sitting there, then add guests. Your
            changes stay saved on this device.
          </p>
        </div>
        <div className="venue-header-actions" data-tour="actions">
          <button
            type="button"
            className="venue-link-button"
            onClick={startTour}
          >
            Show me around
          </button>
          <button type="button" disabled={!history.length} onClick={undo}>
            Undo
          </button>
          {confirmReset ? (
            <span className="venue-confirm">
              <span>Clear everything and go back to the example?</span>
              <button type="button" className="venue-danger" onClick={reset}>
                Yes, start over
              </button>
              <button type="button" onClick={() => setConfirmReset(false)}>
                Keep my plan
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmReset(true)}>
              Start over
            </button>
          )}
        </div>
      </header>

      <div className="venue-summary" aria-label="Plan summary">
        <div className="venue-stat">
          <strong>{tables.length}</strong>
          <span>{tables.length === 1 ? "table" : "tables"}</span>
        </div>
        <div className="venue-stat">
          <strong>{seatCount}</strong>
          <span>seats</span>
        </div>
        <div className="venue-progress-wrap">
          <div className="venue-progress-text">
            <strong>
              {seatedCount} of {guests.length}
            </strong>{" "}
            guests have a seat
            {unseatedCount > 0 ? (
              <span className="venue-needs-seat">
                {" "}
                · {unseatedCount} still need one
              </span>
            ) : (
              <span className="venue-all-set"> · everyone's placed</span>
            )}
          </div>
          <div
            className="venue-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={guests.length}
            aria-valuenow={seatedCount}
          >
            <span
              style={{
                width: `${guests.length ? (seatedCount / guests.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="venue-viewbar">
        <div
          className="venue-segment"
          role="group"
          aria-label="View"
          data-tour="views"
        >
          {(
            [
              ["3d", "3D view"],
              ["plan", "Floor plan"],
              ["photos", "Venue photos"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={view === id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "3d" && (
          <div className="venue-view-options">
            <label className="venue-check">
              <input
                type="checkbox"
                checked={roof}
                onChange={(e) => setRoof(e.target.checked)}
              />
              Show the roof
            </label>
            <label className="venue-check">
              Light
              <select
                value={warmLight ? "warm" : "day"}
                onChange={(e) => setWarmLight(e.target.value === "warm")}
              >
                <option value="warm">Evening</option>
                <option value="day">Daytime</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {view === "photos" ? (
        <section className="venue-references">
          <div className="venue-section-heading">
            <h2>Photos of the venue</h2>
            <p>
              Pictures from the venue's website and the architect's proposal, to
              help you imagine the space. They belong to their owners.
            </p>
          </div>
          <div className="venue-segment venue-chips">
            {[
              "All",
              "Terrace",
              "Grand hall",
              "General",
              "Older website",
              "Architect proposal",
            ].map((c) => (
              <button
                type="button"
                aria-pressed={photoFilter === c}
                className={photoFilter === c ? "active" : ""}
                key={c}
                onClick={() => setPhotoFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="venue-reference-grid">
            {references
              .filter(
                (r) => photoFilter === "All" || r.category === photoFilter,
              )
              .map((r) => (
                <figure key={r.url}>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    <img
                      src={r.url}
                      alt={r.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </a>
                  <figcaption>
                    <span>{r.category}</span>
                    <strong>{r.title}</strong>
                    <a href={r.source} target="_blank" rel="noreferrer">
                      View source ↗
                    </a>
                  </figcaption>
                </figure>
              ))}
          </div>
        </section>
      ) : (
        <div className="venue-workspace">
          <section className="venue-stage" aria-label="Venue" data-tour="stage">
            <div className="venue-stage-body">
              {pick && (
                <div className="venue-pick-banner" role="status">
                  <span>
                    Now tap a table for <strong>{pick.label}</strong>
                  </span>
                  <button type="button" onClick={() => setPick(null)}>
                    Cancel
                  </button>
                </div>
              )}
              {view === "3d" ? (
                <Scene
                  tables={tables}
                  selected={table.id}
                  roof={roof}
                  warmLight={warmLight}
                  move={mode === "arrange"}
                  onSelect={selectTable}
                  onMove={place}
                  dropPreview={dropPreview}
                  hitTestRef={sceneHitTest}
                />
              ) : (
                <FloorPlan
                  tables={tables}
                  selected={table.id}
                  canMove={mode === "arrange"}
                  onSelect={selectTable}
                  onMove={place}
                  dropPreview={dropPreview}
                />
              )}
            </div>
            <p className="venue-stage-hint">{hint}</p>
          </section>

          <aside className="venue-panel">
            <div
              className="venue-segment venue-modes"
              role="group"
              aria-label="What would you like to do?"
              data-tour="modes"
            >
              <button
                type="button"
                aria-pressed={mode === "seat"}
                className={mode === "seat" ? "active" : ""}
                onClick={() => {
                  setMode("seat");
                  setConfirmRemove(false);
                }}
              >
                Seat guests
              </button>
              <button
                type="button"
                aria-pressed={mode === "arrange"}
                className={mode === "arrange" ? "active" : ""}
                onClick={() => {
                  setMode("arrange");
                  setPick(null);
                }}
              >
                Arrange tables
              </button>
            </div>

            {mode === "seat" ? (
              <>
                <section
                  className="venue-card"
                  aria-label="Selected table"
                  data-tour="table"
                >
                  <div className="venue-card-head">
                    <div>
                      <p className="venue-eyebrow">Selected table</p>
                      <h2>{table.name}</h2>
                    </div>
                    <select
                      aria-label="Choose a different table"
                      value={table.id}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.guestIds.length}/{t.capacity}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    className="venue-seat-dots"
                    aria-label={`${table.guestIds.length} of ${table.capacity} seats taken`}
                  >
                    {Array.from({ length: table.capacity }, (_, i) => (
                      <span
                        key={i}
                        className={i < table.guestIds.length ? "taken" : ""}
                      />
                    ))}
                  </div>
                  <p className="venue-muted">
                    {table.guestIds.length} of {table.capacity} seats taken
                    {table.capacity - table.guestIds.length > 0
                      ? ` · ${table.capacity - table.guestIds.length} free`
                      : " · full"}
                  </p>
                  {table.guestIds.length ? (
                    <ul className="venue-seated">
                      {table.guestIds.map((id) => {
                        const g = guests.find((g) => g.id === id);
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
                              onClick={() =>
                                commitTables(unseat(tables, [id]), {
                                  text: `${g.name} no longer has a seat.`,
                                  tone: "info",
                                })
                              }
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="venue-empty">
                      No one is sitting here yet. Pick guests from the list
                      below.
                    </p>
                  )}
                </section>
                <GuestList
                  draft={draft}
                  table={table}
                  hitTest={hitTest}
                  preview={dropPreview}
                  onHover={previewDrop}
                  onDrop={seatGuests}
                  onSeat={(ids, label) => seatGuests(table.id, ids, label)}
                  onPick={startPick}
                  onAddGuest={handleAddGuest}
                  onRemoveGuest={handleRemoveGuest}
                />
              </>
            ) : (
              <>
                <section className="venue-card" aria-label="Tables">
                  <div className="venue-card-head">
                    <h3>Tables</h3>
                    <button
                      type="button"
                      className="venue-primary venue-primary-sm"
                      onClick={handleAddTable}
                    >
                      + Add a table
                    </button>
                  </div>
                  <label className="venue-field">
                    Which table
                    <select
                      value={table.id}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.guestIds.length}/{t.capacity}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NameField
                    key={table.id}
                    value={table.name}
                    onCommit={(name) => updateTable({ name })}
                  />
                  <div className="venue-field">
                    <span>Shape</span>
                    <div className="venue-segment">
                      {(
                        [
                          ["round", "Round"],
                          ["rect", "Long"],
                        ] as const
                      ).map(([shape, label]) => (
                        <button
                          type="button"
                          key={shape}
                          aria-pressed={table.shape === shape}
                          className={table.shape === shape ? "active" : ""}
                          onClick={() =>
                            table.shape !== shape &&
                            commitTables(
                              tables.map((t) =>
                                t.id === table.id ? setShape(t, shape) : t,
                              ),
                            )
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="venue-field">
                    <span>Seats</span>
                    <div className="venue-stepper">
                      <button
                        type="button"
                        aria-label="One seat fewer"
                        disabled={
                          table.capacity <= Math.max(1, table.guestIds.length)
                        }
                        onClick={() => {
                          try {
                            commitTables(
                              tables.map((t) =>
                                t.id === table.id
                                  ? setCapacity(t, t.capacity - 1)
                                  : t,
                              ),
                            );
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
                        onClick={() =>
                          commitTables(
                            tables.map((t) =>
                              t.id === table.id
                                ? setCapacity(t, t.capacity + 1)
                                : t,
                            ),
                          )
                        }
                      >
                        +
                      </button>
                      <small className="venue-muted">
                        {table.guestIds.length} seated
                      </small>
                    </div>
                  </div>
                  <div className="venue-field">
                    <span>Turn</span>
                    <div className="venue-row">
                      <button
                        type="button"
                        onClick={() =>
                          updateTable({
                            rotation: (table.rotation - 45 + 360) % 360,
                          })
                        }
                      >
                        ↺ Turn left
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateTable({ rotation: (table.rotation + 45) % 360 })
                        }
                      >
                        ↻ Turn right
                      </button>
                    </div>
                  </div>
                  <div className="venue-field">
                    <span>Nudge</span>
                    <div
                      className="venue-nudge"
                      aria-label="Move the table a little"
                    >
                      <button
                        type="button"
                        aria-label="Move up"
                        onClick={() => update(table, { z: table.z - 0.5 })}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="Move left"
                        onClick={() => update(table, { x: table.x - 0.5 })}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label="Move right"
                        onClick={() => update(table, { x: table.x + 0.5 })}
                      >
                        →
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        onClick={() => update(table, { z: table.z + 0.5 })}
                      >
                        ↓
                      </button>
                    </div>
                    <small className="venue-muted">
                      Or just drag the table in the picture.
                    </small>
                  </div>
                  <details className="venue-advanced">
                    <summary>Exact position</summary>
                    <div className="venue-fields">
                      {(["x", "z"] as const).map((key) => (
                        <label className="venue-field" key={key}>
                          {key === "x"
                            ? "Left to right (m)"
                            : "Front to back (m)"}
                          <input
                            type="number"
                            step={0.25}
                            value={table[key]}
                            onChange={(e) => {
                              const n = e.target.valueAsNumber;
                              if (Number.isFinite(n)) updateTable({ [key]: n });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                  {confirmRemove ? (
                    <div className="venue-confirm venue-confirm-block">
                      <span>
                        {table.guestIds.length
                          ? `${table.guestIds.length} ${table.guestIds.length === 1 ? "guest" : "guests"} will lose their seat. Remove ${table.name}?`
                          : `Remove ${table.name}?`}
                      </span>
                      <div className="venue-row">
                        <button
                          type="button"
                          className="venue-danger"
                          onClick={handleRemoveTable}
                        >
                          Yes, remove it
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(false)}
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="venue-link-button venue-link-danger"
                      disabled={tables.length <= 1}
                      onClick={() => setConfirmRemove(true)}
                    >
                      Remove this table
                    </button>
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
                    <p className="venue-muted">
                      Looks good. No tables are crowding each other or the dance
                      floor.
                    </p>
                  )}
                  <p className="venue-fineprint">
                    These are rough spacing checks, not the venue's approval.
                  </p>
                </section>
              </>
            )}
          </aside>
        </div>
      )}

      <p
        className={`venue-status ${message ? `is-${message.tone}` : ""}`}
        role="status"
      >
        {message?.text ?? ""}
      </p>

      {tour && <Tour steps={TOUR} onClose={endTour} />}

      <details className="venue-team">
        <summary>For the design team</summary>
        <p>
          This preview uses the venue's published terrace size (28 × 28 m, 8 m
          roof). Walls, furniture and planting are illustrative until the venue
          confirms a measured floor plan. Sample guests only; the reception's
          live seating is not changed here.
        </p>
        <div className="venue-row">
          <button type="button" onClick={downloadLayout}>
            Download layout (JSON)
          </button>
          <button type="button" onClick={exportModel} disabled={exporting}>
            {exporting ? "Exporting…" : "Export 3D model (GLB)"}
          </button>
        </div>
        <p>
          <a
            href="https://benavento.com/espacios-para-eventos/"
            target="_blank"
            rel="noreferrer"
          >
            Venue details ↗
          </a>
          {" · "}
          <a
            href="https://www.aearquitectos.mx/en/projects-1/benavento"
            target="_blank"
            rel="noreferrer"
          >
            Architect's proposal ↗
          </a>
        </p>
      </details>
    </main>
  );

  function update(t: LayoutTable, patch: Partial<LayoutTable>) {
    const changed = { ...t, ...patch };
    commitTables(
      tables.map((x) =>
        x.id === t.id
          ? { ...changed, ...clampPosition(changed, changed.x, changed.z) }
          : x,
      ),
    );
  }
}

function NameField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => void;
}) {
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
