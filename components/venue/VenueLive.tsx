"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { LiveTable } from "@/lib/venue/live-data";
import type { VenuePageData } from "@/lib/venue/live-load";
import type { LoadState, PaletteId, Tier, ViewName, VenueStage } from "@/lib/venue/live-scene";
import type { Draft, LayoutTable } from "@/lib/venue/model";
import { clearDraft, clearLiveDrafts, draftFromVenue, loadDraft, saveDraft, stageTables } from "@/lib/venue/live-edit";
import { addGuestForSeating } from "@/app/admin/(dashboard)/guests/actions";
import { useSeatingSync, type SaveJob } from "./useSeatingSync";
import LayoutEditor, { type Note } from "./LayoutEditor";
import type { DropPreview } from "./drag";
import references from "@/lib/venue/references.json";
import FloorPlan from "./FloorPlan";
import Tour, { type TourStep } from "./Tour";

const PALETTE_CHIPS: { id: PaletteId; label: string; colors: string[] }[] = [
  { id: "garden", label: "Garden", colors: ["#f2eee5", "#f1c9c4", "#9fb08f", "#c8a56a"] },
  { id: "terracotta", label: "Terracotta", colors: ["#e8d8c0", "#e8893a", "#a9573a", "#b47a48"] },
  { id: "midnight", label: "Midnight", colors: ["#283043", "#fbf8f2", "#ece3d2", "#d6b46a"] },
];
/** A phone or tablet has no scroll wheel or keyboard, so its hints name touch gestures. */
const COARSE_POINTER = "(pointer: coarse)";
function watchCoarsePointer(notify: () => void) {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
const hasCoarsePointer = () => window.matchMedia(COARSE_POINTER).matches;

type Mode = ViewName | "floorplan";
const VIEWS: { id: Mode; label: string; hint: string; touchHint?: string }[] = [
  { id: "overview", label: "Look around", hint: "Drag to turn the room. Scroll to zoom.", touchHint: "Drag to turn the room. Pinch to zoom." },
  { id: "guest", label: "Guest view", hint: "Sit at a table at sunset. Walk with W A S D or the arrow keys.", touchHint: "Sit at a table at sunset. Walk with the arrows on screen." },
  { id: "garden", label: "Garden", hint: "Stand across the lake and look back at the terrace." },
  { id: "evening", label: "Evening", hint: "Sit with your guests at night." },
  { id: "plan", label: "From above", hint: "See the whole room from the top." },
  { id: "floorplan", label: "Floor plan", hint: "A flat plan of the tables." },
];
const FIRST_PERSON: Mode[] = ["guest", "garden", "evening"];
const TOUR_KEY = "venue-live-tour-v1";
const TOUR: TourStep[] = [
  {
    target: "stage",
    title: "This is the terrace",
    text: "Drag to look around. Tap any table to see who sits there.",
  },
  {
    target: "views",
    title: "Change where you stand",
    text: "Guest view puts you in a chair. Garden shows the terrace from across the lake. Floor plan is a flat map.",
  },
  {
    target: "walk",
    title: "Walk around",
    text: "Use W A S D or the arrow keys. On a phone, hold the arrows here.",
  },
  {
    target: "time",
    title: "Afternoon to night",
    text: "Slide to see the sunset and the lights at night.",
  },
  {
    target: "tools",
    title: "Try a different layout",
    text: "Edit layout lets you add, move, turn and remove tables and seat guests. Undo takes back your last change. When you are signed in, each change saves to your Seating page.",
  },
  {
    target: "guests",
    title: "Find people fast",
    text: "Guest list shows every table and who sits there. Tap a name to go to that table.",
  },
];

function timeName(t: number) {
  if (t < 30) return "Afternoon";
  if (t < 52) return "Golden hour";
  if (t < 68) return "Sunset";
  if (t < 85) return "Evening";
  return "Night";
}

function asLayoutTable(t: LiveTable): LayoutTable {
  return {
    id: t.id,
    name: t.name,
    x: t.x,
    z: t.z,
    rotation: t.rotation,
    width: t.width,
    depth: t.depth,
    shape: t.shape,
    capacity: t.capacity,
    guestIds: t.guests,
  };
}

export default function VenueLive({ venue }: { venue: VenuePageData }) {
  const router = useRouter();
  // Real tables and an owner or editor: every change saves to Seating.
  // Otherwise (signed out, sample, or view-only) nothing is written anywhere
  // except, for the sample, this browser.
  const live = venue.source === "live";
  const syncing = live && venue.canEdit;
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<VenueStage | null>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const down = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [load, setLoad] = useState<LoadState>({ progress: 0, done: false, failed: false });
  const [mode, setMode] = useState<Mode>("overview");
  const [time, setTime] = useState(38);
  const [palette, setPalette] = useState<PaletteId>("garden");
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [arrange, setArrange] = useState(false); // "Edit layout" mode
  const [roof, setRoof] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<"guests" | "photos" | null>(null);
  const [tour, setTour] = useState(false);
  const [message, setMessage] = useState("");
  const [walked, setWalked] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);

  // The layout draft: the old editor's model, saved in this browser only.
  // It starts from the real tables (or the sample) and never writes Seating.
  const [draft, setDraft] = useState<Draft>(() => draftFromVenue(venue));
  const [history, setHistory] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [pick, setPick] = useState<{ ids: string[]; label: string } | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview>(null);
  // Save only after the stored draft is loaded, so a first render (or the
  // dev double-run of effects) never overwrites it with the fresh draft.
  const [hydrated, setHydrated] = useState<string | null>(null);
  const venueKey = `${venue.source}:${venue.eventId ?? venue.eventName}`;
  useEffect(() => {
    if (live) {
      // The saved chart is the truth. Old browser copies of a real layout
      // would replace it with stale moves, so they go.
      clearLiveDrafts();
      setDraft(draftFromVenue(venue));
      setHistory([]);
      setFuture([]);
      setHydrated(venueKey);
      return;
    }
    const { draft: d, restored, migrated } = loadDraft(venue);
    setDraft(d);
    setHistory([]);
    setFuture([]);
    setHydrated(venueKey);
    if (restored)
      setMessage(migrated ? "Your earlier table moves were brought into the new editor." : "Your saved layout from this device is back.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueKey]);
  useEffect(() => {
    if (hydrated !== venueKey || live) return;
    if (!saveDraft(venue, draft)) setMessage("This browser cannot save your layout. Use Save a copy to keep it.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, hydrated]);

  // A refused save rolls the plan back at once, then reloads the saved plan
  // (a change can be half-saved), and the page shows exactly what is saved.
  const [resync, setResync] = useState(false);
  const sync = useSeatingSync({
    enabled: syncing,
    eventId: venue.eventId,
    onFailure: (job: SaveJob, detail: string) => {
      setDraft(job.before);
      setHistory([]);
      setFuture([]);
      setPick(null);
      setMessage(
        `Couldn't save that change${detail ? `: ${detail}` : "."} The plan now shows what is saved. Try again.`,
      );
      setResync(true);
      router.refresh();
    },
    onNote: (text) => setMessage(text),
  });
  useEffect(() => {
    if (!resync || sync.busy()) return;
    setResync(false);
    sync.reset();
    setDraft(draftFromVenue(venue));
    // Runs when the refreshed page data arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  const tables = useMemo(() => stageTables(draft), [draft]);
  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const seated = tables.reduce((n, t) => n + t.guests.length, 0);
  const seats = tables.reduce((n, t) => n + t.capacity, 0);

  const commit = useCallback(
    (next: Draft, note?: Note | string) => {
      if (live && !syncing) {
        setMessage("Your access is view-only, so the layout cannot change.");
        return;
      }
      if (resync) {
        setMessage("Loading the saved plan. Try again in a moment.");
        return;
      }
      setHistory((h) => [...h.slice(-29), draft]);
      setFuture([]);
      setDraft(next);
      setMessage(typeof note === "string" ? note : (note?.text ?? ""));
      if (syncing) sync.enqueue({ before: draft, after: next });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, live, syncing, resync],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function moveTable(id: string, x: number, z: number) {
    const d = draftRef.current;
    const t = d.tables.find((x) => x.id === id);
    if (!t) return;
    commitRef.current(
      { ...d, tables: d.tables.map((o) => (o.id === id ? { ...o, x, z } : o)) },
      syncing ? `${t.name} moved.` : `${t.name} moved. This change stays on this device.`,
    );
  }
  function undo() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setFuture((f) => [draft, ...f].slice(0, 30));
    setDraft(prev);
    setHistory((h) => h.slice(0, -1));
    setMessage("Undone.");
    // The inverse change: the same diff, from now back to before.
    if (syncing) sync.enqueue({ before: draft, after: prev });
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((h) => [...h.slice(-29), draft]);
    setDraft(next);
    setFuture((f) => f.slice(1));
    setMessage("Redone.");
    if (syncing) sync.enqueue({ before: draft, after: next });
  }
  function resetAll() {
    if (live) {
      // Nothing to undo: reload the saved plan from Seating.
      setPick(null);
      setMessage("Showing the saved plan from Seating.");
      setResync(true);
      router.refresh();
      return;
    }
    commit(draftFromVenue(venue), "Back to the tables from Seating.");
    clearDraft(venue);
    setPick(null);
  }
  /**
   * A real guest, made through the Guests page's own checks. A name in the
   * "family" box that matches a household on this list adds to it; any other
   * name starts a new household. Adding is not part of undo: undo never
   * deletes a guest. Seating them is a normal, undoable change.
   */
  async function addRealGuest(name: string, family: string): Promise<boolean> {
    if (!venue.eventId) return false;
    const fam = family.trim().replace(/\s+/g, " ");
    const match = fam
      ? draftRef.current.guests.find((g) => g.householdId && g.household.toLowerCase() === fam.toLowerCase())
      : undefined;
    try {
      const res = await addGuestForSeating({
        name,
        family: fam || undefined,
        householdId: match?.householdId ?? null,
        eventId: venue.eventId,
        operationId: crypto.randomUUID(),
      });
      setMessage(res.message);
      if (!res.ok || !res.guest) return false;
      if (res.seatable) {
        const g = res.guest;
        const add = (d: Draft): Draft =>
          d.guests.some((x) => x.id === g.id) ? d : { ...d, guests: [...d.guests, g] };
        setDraft(add);
        setHistory((h) => h.map(add));
        setFuture((f) => f.map(add));
      }
      return true;
    } catch {
      setMessage("Couldn't add the guest: the connection dropped. Try again.");
      return false;
    }
  }
  function selectTable(id: string | null) {
    if (id && pick) {
      seatPicked(id);
      return;
    }
    setSelected(id);
  }
  function seatPicked(id: string) {
    const pk = pick;
    if (!pk) return;
    setPick(null);
    import("@/lib/venue/model").then(({ assignDemo }) => {
      const d = draftRef.current;
      try {
        const next = assignDemo(d.tables, id, pk.ids, d.guests);
        const name = next.find((t) => t.id === id)!.name;
        commitRef.current(
          { ...d, tables: next },
          pk.ids.length > 1 ? `${pk.label} are now together at ${name}.` : `${pk.label} is now at ${name}.`,
        );
        setSelected(id);
      } catch (e) {
        setMessage((e as Error).message);
      }
    });
  }
  function hitTest(x: number, y: number) {
    if (mode === "floorplan")
      return document.elementFromPoint(x, y)?.closest(".vl-plan [data-table]")?.getAttribute("data-table") ?? null;
    const el = host.current;
    if (!el || !stage.current) return null;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    // Panels sit over the canvas; only count drops that land on the picture.
    const top = document.elementFromPoint(x, y);
    if (top && !el.contains(top) && !top.closest(".vl-labels")) return null;
    return stage.current.pick(x, y);
  }
  function previewDrop(id: string | null, ids: string[]) {
    const target = draftRef.current.tables.find((t) => t.id === id);
    if (!target) {
      setDropPreview(null);
      return;
    }
    const free = target.capacity - target.guestIds.filter((g) => !ids.includes(g)).length;
    const valid = ids.length <= free;
    const label = valid ? `Let go to seat at ${target.name}` : `${target.name} does not have room.`;
    setDropPreview((prev) => (prev?.id === id && prev.valid === valid ? prev : { id: target.id, valid, label }));
  }
  async function exportAs(kind: "html" | "json" | "glb" | "png") {
    const download = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    try {
      if (kind === "png") {
        const data = stage.current?.snapshot();
        if (!data) throw new Error("no picture");
        download(await (await fetch(data)).blob(), "benavento-layout.png");
        setMessage("Picture saved.");
      } else if (kind === "json") {
        download(
          new Blob(
            [JSON.stringify({ venue: "Benavento terrace", units: "metres", dimensions: { width: 28, depth: 28, height: 8 }, verifiedAsBuilt: false, ...draft }, null, 2)],
            { type: "application/json" },
          ),
          "venue-layout.json",
        );
        setMessage("Layout file downloaded.");
      } else if (kind === "html") {
        const { createInteractiveHtml } = await import("@/lib/venue/interactive-export");
        const html = await createInteractiveHtml(draft);
        download(new Blob([html], { type: "text/html;charset=utf-8" }), "benavento-interactive.html");
        setMessage("Interactive HTML downloaded with your layout. Open it in a browser.");
      } else {
        const [{ GLTFExporter }, { buildShell, buildFurniture, disposeObject }, THREE, { loadDetailedShell }] = await Promise.all([
          import("three/addons/exporters/GLTFExporter.js"),
          import("@/lib/venue/scene"),
          import("three"),
          import("@/lib/venue/detailed-shell"),
        ]);
        const scene = new THREE.Scene();
        const shell = await loadDetailedShell().catch(() => buildShell());
        scene.add(shell, buildFurniture(draft.tables));
        try {
          const result = await new GLTFExporter().parseAsync(scene, { binary: true });
          download(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }), "benavento-terrace-layout.glb");
          setMessage("3D model downloaded. It opens in Blender via File → Import → glTF 2.0.");
        } finally {
          disposeObject(scene);
        }
      }
    } catch {
      setMessage("That download did not work. Your layout is still saved here.");
    }
  }

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    const q = new URLSearchParams(window.location.search).get("quality");
    const tier = q === "high" || q === "medium" || q === "low" ? (q as Tier) : null;
    let saved: PaletteId | null = null;
    try {
      saved = window.localStorage.getItem("venue-live-palette") as PaletteId | null;
    } catch {
      saved = null;
    }
    import("@/lib/venue/live-scene")
      .then(({ VenueStage: Stage, PALETTES }) => {
        if (disposed) return;
        const s = new Stage(el, { reducedMotion, mobile, tier });
        stage.current = s;
        s.setTime(38);
        if (saved && saved in PALETTES) {
          s.setPalette(saved);
          setPalette(saved);
        }
        s.onTime = (t) => setTime(Math.round(t));
        s.onLoad = (st) => setLoad(st);
        s.onSelectTable = (id) => selectRef.current(id);
        s.onMoveTable = (id, x, z) => moveTable(id, x, z);
        s.onWalk = () => setWalked(true);
        s.onFrame = () => {
          for (const p of s.project()) {
            const node = labels.current.get(p.id);
            if (!node) continue;
            node.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
            node.style.visibility = p.visible ? "visible" : "hidden";
          }
        };
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      stage.current?.dispose();
      stage.current = null;
    };
    // The stage lives for the whole visit; tables flow in through setTables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage.current?.setTables(tables);
  }, [tables, ready]);
  const selectRef = useRef(selectTable);
  selectRef.current = selectTable;
  useEffect(() => {
    stage.current?.setHighlight(dropPreview?.id ?? hovered, selected);
  }, [hovered, selected, dropPreview, ready]);
  useEffect(() => {
    if (stage.current) stage.current.arrange = arrange;
  }, [arrange, ready]);
  useEffect(() => {
    stage.current?.setRoof(roof);
  }, [roof, ready]);

  // First visit: show the walkthrough once.
  useEffect(() => {
    if (!ready) return;
    let seen = true;
    try {
      seen = Boolean(window.localStorage.getItem(TOUR_KEY));
    } catch {
      /* no storage: do not nag */
    }
    if (seen || new URLSearchParams(window.location.search).has("notour")) return;
    const t = setTimeout(() => setTour(true), 1200);
    return () => clearTimeout(t);
  }, [ready]);
  function endTour() {
    setTour(false);
    try {
      window.localStorage.setItem(TOUR_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  // Keyboard walking: W A S D or arrows, Q / E to turn, Shift to hurry.
  useEffect(() => {
    const keys = new Set<string>();
    const sync = () => {
      const s = stage.current;
      if (!s) return;
      const has = (...k: string[]) => k.some((x) => keys.has(x));
      s.walk = {
        f: (has("w", "arrowup") ? 1 : 0) - (has("s", "arrowdown") ? 1 : 0),
        s: (has("d") ? 1 : 0) - (has("a") ? 1 : 0),
        t: (has("q", "arrowleft") ? 1 : 0) - (has("e", "arrowright") ? 1 : 0),
        fast: keys.has("shift"),
      };
    };
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setPanel(null);
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) return;
      if (k.startsWith("arrow")) {
        // Arrow keys on a focused button or slider keep their usual meaning.
        const el = e.target as HTMLElement | null;
        if (el && el !== document.body && el.closest("button, [role=button], a, input")) return;
        e.preventDefault();
      }
      keys.add(k);
      sync();
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      if (e.key === "Shift") keys.delete("shift");
      sync();
    };
    const clear = () => {
      keys.clear();
      sync();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Cmd/Ctrl+Z undoes a table move, as in the old editor's Undo button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "h") {
        setUiHidden((h) => !h);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function hold(f: number, s: number, t: number) {
    return {
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (stage.current) stage.current.walk = { f, s, t, fast: false };
      },
      onPointerUp: () => {
        if (stage.current) stage.current.walk = { f: 0, s: 0, t: 0, fast: false };
      },
      onPointerCancel: () => {
        if (stage.current) stage.current.walk = { f: 0, s: 0, t: 0, fast: false };
      },
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
  }

  function chooseView(v: Mode) {
    setMode(v);
    const sv: ViewName = v === "floorplan" ? "plan" : v;
    stage.current?.setView(sv);
    // Presets set the slider target at once, so the label, sky and lights agree.
    const preset = v === "evening" ? 88 : v === "guest" ? 58 : null;
    if (preset !== null) {
      stage.current?.setTime(preset, true);
      setTime(preset);
    }
  }
  function changeTime(t: number) {
    setTime(t);
    stage.current?.setTime(t);
  }
  function choosePalette(p: PaletteId) {
    setPalette(p);
    stage.current?.setPalette(p);
    try {
      window.localStorage.setItem("venue-live-palette", p);
    } catch {
      /* private mode: palette is not remembered */
    }
  }
  function goToTable(id: string) {
    setSelected(id);
    stage.current?.focusTable(id);
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: { name: string; tableId: string; table: string }[] = [];
    for (const t of tables)
      for (const g of t.guests) if (g.toLowerCase().includes(q)) out.push({ name: g, tableId: t.id, table: t.name });
    return out.slice(0, 6);
  }, [query, tables]);

  const hoverTable = hovered && hovered !== selected ? byId.get(hovered) : null;
  const selTable = selected ? byId.get(selected) : null;
  const firstPerson = FIRST_PERSON.includes(mode);
  const roofOn = roof ?? firstPerson;
  const touch = useSyncExternalStore(watchCoarsePointer, hasCoarsePointer, () => false);
  const view = VIEWS.find((v) => v.id === mode);
  const viewHint = (touch && view?.touchHint) || view?.hint || "";
  const planTables = draft.tables;

  return (
    <div
      className="vl"
      data-view={mode}
      data-arrange={arrange ? "1" : undefined}
      data-ui={uiHidden ? "hidden" : undefined}
    >
      <button
        type="button"
        className="vl-ui-toggle"
        aria-pressed={uiHidden}
        onClick={() => setUiHidden((h) => !h)}
        title="Press H to hide or show the controls"
      >
        {uiHidden ? "Show controls" : "Hide controls"}
      </button>
      <div
        ref={host}
        className="vl-stage"
        data-tour="stage"
        aria-label="3D view of the reception terrace. Use the table list or search to find a table."
        role="img"
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse" || !stage.current || e.buttons) return;
          const id = stage.current.pick(e.clientX, e.clientY);
          setHovered(id);
          setHoverPos({ x: e.clientX, y: e.clientY });
        }}
        onPointerLeave={() => setHovered(null)}
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const d = down.current;
          down.current = null;
          if (!d || !stage.current) return;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
          selectTable(stage.current.pick(e.clientX, e.clientY));
        }}
      />

      <div className="vl-labels" aria-hidden={!ready}>
        {tables.map((t) => (
          <button
            key={t.id}
            type="button"
            ref={(n) => {
              if (n) labels.current.set(t.id, n);
              else labels.current.delete(t.id);
            }}
            className={`vl-label${t.id === selected ? " is-selected" : ""}${t.id === hovered ? " is-hovered" : ""}${t.guests.length >= t.capacity ? " is-full" : ""}`}
            onClick={() => selectTable(t.id)}
            onMouseEnter={() => setHovered(t.id)}
            onMouseLeave={() => setHovered(null)}
            style={{ visibility: "hidden" }}
          >
            <span className="vl-label-name">{t.name}</span>
            <span className="vl-label-count">
              {t.guests.length} of {t.capacity}
            </span>
          </button>
        ))}
      </div>

      <header className="vl-top">
        <a className="vl-back" href="/admin/seating">
          ← Seating
        </a>
        <div className="vl-title">
          <p className="vl-eyebrow">Benavento · Terraza Panorámica</p>
          <h1>Your reception</h1>
          <p className="vl-sub">
            {tables.length} tables · {seated} of {seats} seats filled
          </p>
        </div>
        <div className="vl-top-right">
          <span className={`vl-badge ${venue.source === "sample" ? "is-sample" : "is-live"}`}>
            {venue.source === "sample"
              ? venue.signedIn
                ? "Sample tables: add tables in Seating to see yours"
                : "Sample tables: sign in to see yours"
              : `Your tables · ${venue.eventName}`}
          </span>
          {live && venue.events.length > 1 && (
            <label className="vl-event-pick">
              <span className="vl-sr">Event</span>
              <select
                value={venue.eventId}
                disabled={sync.status === "saving"}
                onChange={(e) => router.push(`/venue-preview?event=${encodeURIComponent(e.target.value)}`)}
              >
                {venue.events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {syncing && (
            <span className={`vl-save is-${sync.status}`} role="status" aria-live="polite">
              {sync.status === "saving"
                ? "Saving…"
                : sync.status === "error"
                  ? "Couldn't save, try again"
                  : sync.status === "saved"
                    ? "Saved"
                    : "Changes save to Seating"}
            </span>
          )}
          {live && !venue.canEdit && <span className="vl-save">View only</span>}
          <div className="vl-top-actions">
            <button
              type="button"
              data-tour="guests"
              aria-pressed={panel === "guests"}
              className={panel === "guests" ? "is-on" : ""}
              onClick={() => setPanel(panel === "guests" ? null : "guests")}
            >
              Guest list
            </button>
            <button
              type="button"
              aria-pressed={panel === "photos"}
              className={panel === "photos" ? "is-on" : ""}
              onClick={() => setPanel(panel === "photos" ? null : "photos")}
            >
              Venue photos
            </button>
            <button type="button" onClick={() => setTour(true)}>
              Show me around
            </button>
          </div>
        </div>
      </header>

      {ready && !load.done && (
        <div className="vl-progress" role="status">
          <span>Loading the garden and the lake…</span>
          <i style={{ width: `${Math.round(load.progress * 100)}%` }} />
        </div>
      )}
      {load.failed && (
        <p className="vl-progress is-failed" role="status">
          The detailed venue did not load. You see a simple version.
        </p>
      )}

      {hoverTable && (
        <div className="vl-hover" style={{ left: hoverPos.x + 16, top: hoverPos.y + 16 }} role="tooltip">
          <strong>{hoverTable.name}</strong>
          <span>
            {hoverTable.guests.length} of {hoverTable.capacity} seats
          </span>
          {hoverTable.guests.length ? (
            <ul>
              {hoverTable.guests.slice(0, 10).map((g, i) => (
                <li key={i}>{g}</li>
              ))}
              {hoverTable.guests.length > 10 && <li>and {hoverTable.guests.length - 10} more</li>}
            </ul>
          ) : (
            <em>No one seated yet</em>
          )}
          <small>{arrange ? "Drag to move it" : "Click to keep this open"}</small>
        </div>
      )}

      {mode === "floorplan" && (
        <section className="vl-plan" aria-label="Floor plan">
          <FloorPlan
            tables={planTables}
            selected={selected ?? ""}
            canMove={arrange}
            onSelect={(id) => selectTable(id)}
            onMove={(id, x, z) => moveTable(id, x, z)}
            dropPreview={dropPreview}
          />
          <p className="vl-plan-hint">
            {arrange ? "Drag a table to move it." : "Tap a table to see who sits there. Press Edit layout to move tables."}
          </p>
        </section>
      )}

      {panel === "guests" && (
        <aside className="vl-panel" aria-label="Guest list">
          <div className="vl-sheet-head">
            <div>
              <h2>Guest list</h2>
              <p>
                {seated} guests at {tables.length} tables
              </p>
            </div>
            <button type="button" className="vl-close" onClick={() => setPanel(null)} aria-label="Close">
              ×
            </button>
          </div>
          <GuestPanel tables={tables} selected={selected} onPick={goToTable} />
        </aside>
      )}

      {panel === "photos" && (
        <aside className="vl-panel vl-photos" aria-label="Venue photos">
          <div className="vl-sheet-head">
            <div>
              <h2>The real terrace</h2>
              <p>Photos from the venue. They belong to their owners.</p>
            </div>
            <button type="button" className="vl-close" onClick={() => setPanel(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="vl-photo-grid">
            {references
              .filter((r) => r.category === "Terrace")
              .map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noreferrer">
                  <img src={r.url} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />
                </a>
              ))}
          </div>
        </aside>
      )}

      {selTable && !arrange && (
        <aside className="vl-sheet" aria-label={`${selTable.name} guests`}>
          <div className="vl-sheet-head">
            <div>
              <h2>{selTable.name}</h2>
              <p>
                {selTable.guests.length} of {selTable.capacity} seats filled
                {selTable.capacity - selTable.guests.length > 0 &&
                  ` · ${selTable.capacity - selTable.guests.length} open`}
              </p>
            </div>
            <button type="button" className="vl-close" onClick={() => setSelected(null)} aria-label="Close">
              ×
            </button>
          </div>
          {selTable.guests.length ? (
            <ol className="vl-guests">
              {selTable.guests.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ol>
          ) : (
            <p className="vl-empty">No one is seated here yet.</p>
          )}
          <div className="vl-btn-row">
            {mode !== "plan" && mode !== "floorplan" && (
              <button type="button" onClick={() => stage.current?.focusTable(selTable.id)}>
                Go to this table
              </button>
            )}
            <a className="vl-sheet-link" href="/admin/seating">
              Change seats in Seating
            </a>
          </div>
        </aside>
      )}

      {pick && (
        <div className="vl-pick" role="status">
          <span>
            Now tap a table for <strong>{pick.label}</strong>
          </span>
          <button type="button" onClick={() => setPick(null)}>
            Cancel
          </button>
        </div>
      )}

      {arrange && (
        <LayoutEditor
          draft={draft}
          selected={selected}
          canUndo={history.length > 0}
          canRedo={future.length > 0}
          commit={(next, note) => commit(next, note)}
          onSelect={(id) => {
            setSelected(id);
            if (mode !== "plan" && mode !== "floorplan") stage.current?.focusTable(id);
          }}
          onUndo={undo}
          onRedo={redo}
          onReset={resetAll}
          onNote={(n) => setMessage(n.text)}
          onPick={(ids, label) => {
            setPick({ ids, label });
            setMessage("");
          }}
          hitTest={hitTest}
          preview={dropPreview}
          onHover={previewDrop}
          onExport={exportAs}
          onClose={() => setArrange(false)}
          live={syncing}
          addGuest={syncing ? addRealGuest : undefined}
        />
      )}

      {firstPerson && (
        <div className="vl-walk" data-tour="walk" aria-label="Walk">
          <p>{walked ? "Drag to look around." : "Walk with W A S D or the arrows. Drag to look."}</p>
          <div className="vl-pad">
            <button type="button" aria-label="Turn left" {...hold(0, 0, 1)}>
              ↺
            </button>
            <button type="button" aria-label="Walk forward" {...hold(1, 0, 0)}>
              ↑
            </button>
            <button type="button" aria-label="Turn right" {...hold(0, 0, -1)}>
              ↻
            </button>
            <button type="button" aria-label="Step left" {...hold(0, -1, 0)}>
              ←
            </button>
            <button type="button" aria-label="Walk back" {...hold(-1, 0, 0)}>
              ↓
            </button>
            <button type="button" aria-label="Step right" {...hold(0, 1, 0)}>
              →
            </button>
          </div>
        </div>
      )}

      <section className="vl-dock" aria-label="Controls">
        <div className="vl-dock-top">
          <div className="vl-views" role="group" aria-label="Choose a view" data-tour="views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={mode === v.id ? "is-on" : ""}
                aria-pressed={mode === v.id}
                onClick={() => chooseView(v.id)}
                title={v.hint}
              >
                <ViewIcon id={v.id} />
                {v.label}
              </button>
            ))}
          </div>
          <div className="vl-tools" role="group" aria-label="Tables" data-tour="tools">
            <button
              type="button"
              className={`vl-edit-btn${arrange ? " is-on" : ""}`}
              aria-pressed={arrange}
              disabled={live && !syncing}
              title={live && !syncing ? "Your access is view-only." : undefined}
              onClick={() => {
                setArrange(!arrange);
                setPanel(null);
                setPick(null);
                if (!arrange && !selected && draft.tables[0]) setSelected(draft.tables[0].id);
                setMessage(
                  arrange
                    ? ""
                    : syncing
                      ? "Drag any table to move it. Each change saves to Seating."
                      : "Drag any table to move it. Changes save on this device only.",
                );
              }}
            >
              ✎ {arrange ? "Done editing" : "Edit layout"}
            </button>
            <button type="button" onClick={undo} disabled={!history.length}>
              Undo
            </button>
            <button type="button" onClick={redo} disabled={!future.length}>
              Redo
            </button>
            <button
              type="button"
              aria-pressed={roofOn}
              onClick={() => setRoof(!roofOn)}
              title="Show or hide the roof"
            >
              {roofOn ? "Hide roof" : "Show roof"}
            </button>
          </div>
        </div>
        <label className="vl-time" data-tour="time">
          <span className="vl-row">
            <span>Time of day</span>
            <strong>{timeName(time)}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={time}
            onChange={(e) => changeTime(Number(e.target.value))}
            aria-valuetext={timeName(time)}
          />
          <span className="vl-row vl-ends">
            <span>☀ Afternoon</span>
            <span>Night ☾</span>
          </span>
        </label>
        <div className="vl-colors" role="group" aria-label="Colors">
          <span className="vl-row">
            <span>Colors</span>
          </span>
          <div className="vl-chips">
            {PALETTE_CHIPS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={palette === p.id ? "is-on" : ""}
                aria-pressed={palette === p.id}
                onClick={() => choosePalette(p.id)}
              >
                <span className="vl-swatch">
                  {p.colors.map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="vl-find">
          <label htmlFor="vl-find">Find a guest</label>
          <input
            id="vl-find"
            type="search"
            placeholder="Type a name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {matches.length > 0 && (
            <ul className="vl-results">
              {matches.map((m, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      goToTable(m.tableId);
                      setQuery("");
                    }}
                  >
                    {m.name} <span>{m.table}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && matches.length === 0 && <p className="vl-none">No one by that name is seated.</p>}
        </div>
      </section>

      <p className="vl-status" role="status">
        {dropPreview?.label || message || viewHint}
      </p>

      <p className="vl-note">
        A picture to plan with, not a measured drawing. The room is the venue's published size (28 × 28 m). Flowers,
        linens and the garden are examples.
      </p>

      {tour && <Tour steps={TOUR} onClose={endTour} />}

      {!ready && !failed && (
        <div className="vl-loading">
          <span>Setting the tables…</span>
        </div>
      )}
      {failed && (
        <div className="vl-failed">
          <p>This device could not show the 3D room. Here are your tables:</p>
          <ul>
            {tables.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong>: {t.guests.join(", ") || "no one yet"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GuestPanel({
  tables,
  selected,
  onPick,
}: {
  tables: LiveTable[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = tables
    .map((t) => ({
      t,
      guests: query && !t.name.toLowerCase().includes(query) ? t.guests.filter((g) => g.toLowerCase().includes(query)) : t.guests,
    }))
    .filter((x) => !query || x.guests.length || x.t.name.toLowerCase().includes(query));
  return (
    <>
      <input
        className="vl-panel-search"
        type="search"
        placeholder="Search names or tables"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search names or tables"
      />
      <ul className="vl-tables">
        {shown.map(({ t, guests }) => (
          <li key={t.id} className={t.id === selected ? "is-selected" : ""}>
            <button type="button" className="vl-table-head" onClick={() => onPick(t.id)}>
              <strong>{t.name}</strong>
              <span>
                {t.guests.length} of {t.capacity}
              </span>
            </button>
            {guests.length > 0 && (
              <ul>
                {guests.map((g, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => onPick(t.id)}>
                      {g}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {!shown.length && <li className="vl-empty">No one matches.</li>}
      </ul>
    </>
  );
}

function ViewIcon({ id }: { id: Mode }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    "aria-hidden": true,
  };
  if (id === "plan")
    return (
      <svg {...common}>
        <path d="M12 3v4M12 3l-2 2M12 3l2 2" />
        <rect x="4" y="9" width="16" height="11" rx="2" />
        <circle cx="9" cy="14.5" r="1.8" />
        <circle cx="15" cy="14.5" r="1.8" />
      </svg>
    );
  if (id === "floorplan")
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <circle cx="15" cy="9" r="2" />
        <rect x="7" y="14" width="10" height="3" rx="1" />
      </svg>
    );
  if (id === "evening")
    return (
      <svg {...common}>
        <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />
      </svg>
    );
  if (id === "guest")
    return (
      <svg {...common}>
        <path d="M7 21v-8h10v8M7 13V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v7M5 13h14" />
      </svg>
    );
  if (id === "garden")
    return (
      <svg {...common}>
        <path d="M12 21v-9M12 12c-3-4-7-3-8-2 3 0 5 1 8 2zM12 12c3-4 7-3 8-2-3 0-5 1-8 2zM12 12c-1-4 1-7 3-8-1 3-2 5-3 8z" />
        <path d="M3 21c3-1.5 15-1.5 18 0" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  );
}
