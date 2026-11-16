import type { LiveTable, LiveVenue } from "./live-data";
import {
  addTable,
  clampPosition,
  footprintFor,
  nextTableName,
  parseSavedDraft,
  type DemoGuest,
  type Draft,
  type LayoutTable,
} from "./model";

/*
 * Layout editing for /venue-preview. It reuses the old editor's draft model
 * (lib/venue/model.ts) so every action keeps the same rules. For the sample
 * the draft lives in this browser. For a signed-in editor the page saves each
 * change to Seating (see seating-sync.ts and components/venue/useSeatingSync.ts),
 * and the browser copy is not used.
 */

export const PLAN_VERSION = 2;
export const planKey = (source: string, event: string) => `venue-live-layout-v2:${source}:${event}`;
const v1Key = (source: string, event: string) => `venue-live-layout-v1:${source}:${event}`;

export type { TableKind } from "./seating-sync";
import type { TableKind } from "./seating-sync";
export const TABLE_KINDS: { kind: TableKind; label: string; hint: string }[] = [
  { kind: "round", label: "Round table", hint: "8 seats" },
  { kind: "long", label: "Long table", hint: "10 seats" },
  { kind: "head", label: "Head table", hint: "8 seats on one long table" },
];

/**
 * The starting draft: the real (or sample) tables and every guest who can be
 * seated. Real data is never trimmed: a cut name or capacity would be written
 * back to Seating on the next edit. The sample keeps its small limits.
 */
export function draftFromVenue(venue: LiveVenue): Draft {
  const live = venue.source === "live";
  const guests: DemoGuest[] = (live ? venue.guests : venue.guests.slice(0, 400)).map((g) => ({
    id: g.id,
    name: live ? g.name || "Guest" : g.name.slice(0, 60) || "Guest",
    household: live ? g.household : g.household.slice(0, 60),
    ...(g.householdId ? { householdId: g.householdId } : {}),
  }));
  const known = new Set(guests.map((g) => g.id));
  const seated = new Set<string>();
  const tables: LayoutTable[] = (live ? venue.tables : venue.tables.slice(0, 50)).map((t) => {
    const capacity = live ? Math.max(1, Math.round(t.capacity)) : Math.max(1, Math.min(16, Math.round(t.capacity)));
    const ids = (t.guestIds ?? []).filter((id) => known.has(id) && !seated.has(id)).slice(0, capacity);
    ids.forEach((id) => seated.add(id));
    const base: LayoutTable = {
      id: t.id,
      name: live ? t.name : t.name.slice(0, 80) || "Table",
      x: t.x,
      z: t.z,
      rotation: t.rotation,
      shape: t.shape,
      width: Math.max(0.5, Math.min(5, t.width)),
      depth: Math.max(0.5, Math.min(5, t.depth)),
      capacity,
      guestIds: ids,
      ...(t.kind ? { kind: t.kind } : {}),
    };
    return { ...base, ...clampPosition(base, base.x, base.z) };
  });
  return { tables, guests };
}

/** Table rows for the 3D stage: names come from the draft's guest list. */
export function stageTables(draft: Draft): LiveTable[] {
  const names = new Map(draft.guests.map((g) => [g.id, g.name]));
  return draft.tables.map((t) => ({
    id: t.id,
    name: t.name,
    x: t.x,
    z: t.z,
    rotation: t.rotation,
    shape: t.shape,
    width: t.width,
    depth: t.depth,
    capacity: t.capacity,
    guests: t.guestIds.map((id) => names.get(id) ?? "Guest"),
    guestIds: [...t.guestIds],
  }));
}

/**
 * Read the saved draft. Order: v2 draft, else a v1 "moved tables" record
 * applied to the fresh draft (and then removed), else the fresh draft.
 */
export function loadDraft(venue: LiveVenue): { draft: Draft; restored: boolean; migrated: boolean } {
  const fresh = draftFromVenue(venue);
  try {
    const raw = window.localStorage.getItem(planKey(venue.source, venue.eventName));
    if (raw) {
      const data = JSON.parse(raw) as { version?: number; tables?: unknown; guests?: unknown };
      if (data && data.version === PLAN_VERSION) {
        return { draft: parseSavedDraft({ tables: data.tables, guests: data.guests }), restored: true, migrated: false };
      }
    }
  } catch {
    /* unreadable: fall through to the older format or the fresh draft */
  }
  try {
    const key = v1Key(venue.source, venue.eventName);
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const moves = JSON.parse(raw) as Record<string, { x?: unknown; z?: unknown; rotation?: unknown }>;
      const tables = fresh.tables.map((t) => {
        const m = moves?.[t.id];
        if (!m || ![m.x, m.z, m.rotation].every((n) => typeof n === "number" && Number.isFinite(n))) return t;
        const moved = { ...t, rotation: m.rotation as number };
        return { ...moved, ...clampPosition(moved, m.x as number, m.z as number) };
      });
      const draft = { ...fresh, tables };
      saveDraft(venue, draft);
      window.localStorage.removeItem(key);
      return { draft, restored: true, migrated: true };
    }
  } catch {
    /* ignore a broken v1 record */
  }
  return { draft: fresh, restored: false, migrated: false };
}

export function saveDraft(venue: Pick<LiveVenue, "source" | "eventName">, draft: Draft): boolean {
  try {
    window.localStorage.setItem(
      planKey(venue.source, venue.eventName),
      JSON.stringify({ version: PLAN_VERSION, tables: draft.tables, guests: draft.guests }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Drop every browser copy of a real layout, so old moves never replace saved data. */
export function clearLiveDrafts() {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && /^venue-live-layout-v[12]:live:/.test(k)) stale.push(k);
    }
    stale.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage blocked: nothing to clear */
  }
}

export function clearDraft(venue: Pick<LiveVenue, "source" | "eventName">) {
  try {
    window.localStorage.removeItem(planKey(venue.source, venue.eventName));
  } catch {
    /* nothing saved */
  }
}

/* ------------------------------------------------------------ placement */

function envelope(t: LayoutTable) {
  return Math.hypot(t.width, t.depth) / 2 + 0.55;
}
function overlaps(a: LayoutTable, b: LayoutTable) {
  return Math.hypot(a.x - b.x, a.z - b.z) < envelope(a) + envelope(b);
}
function onDanceFloor(t: LayoutTable) {
  return Math.abs(t.x) < 4.5 + t.width / 2 && Math.abs(t.z) < 2 + t.depth / 2;
}

/** Nearest free spot to (nearX, nearZ): no overlap, not on the dance floor. */
export function freeSpot(tables: LayoutTable[], t: LayoutTable, nearX = 0, nearZ = 0) {
  const spots: { x: number; z: number }[] = [];
  for (let z = -12; z <= 12; z += 0.5) for (let x = -12; x <= 12; x += 0.5) spots.push({ x, z });
  spots.sort((a, b) => Math.hypot(a.x - nearX, a.z - nearZ) - Math.hypot(b.x - nearX, b.z - nearZ));
  for (const s of spots) {
    const c = { ...t, ...clampPosition(t, s.x, s.z) };
    if (onDanceFloor(c)) continue;
    if (tables.some((o) => o.id !== t.id && overlaps(o, c))) continue;
    return { x: c.x, z: c.z, found: true };
  }
  return { ...clampPosition(t, nearX, 12), found: false };
}

/** Add a table of a kind at the first free spot near the centre. */
export function addTableOfKind(tables: LayoutTable[], kind: TableKind): { tables: LayoutTable[]; added: LayoutTable } {
  const withRound = addTable(tables);
  let t: LayoutTable = { ...withRound[withRound.length - 1], kind };
  if (kind === "long") t = { ...t, shape: "rect", capacity: 10, ...footprintFor("rect", 10) };
  if (kind === "head") {
    const used = new Set(tables.map((x) => x.name.toLowerCase()));
    let name = "Head table";
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `Head table ${n}`;
    t = { ...t, name, shape: "rect", capacity: 8, width: 3.2, depth: 1 };
  }
  if (kind !== "round") t = { ...t, ...freeSpot(tables, t) };
  return { tables: [...tables, t], added: t };
}

/** Copy a table (shape, seats, turn; no guests) next to the original. */
export function duplicateTable(tables: LayoutTable[], id: string): { tables: LayoutTable[]; added: LayoutTable } {
  if (tables.length >= 50) throw new Error("This room already has 50 tables.");
  const src = tables.find((t) => t.id === id);
  if (!src) throw new Error("Choose a table first.");
  const ids = new Set(tables.map((t) => t.id));
  let n = tables.length + 1;
  while (ids.has(`table-${n}`)) n++;
  const copy: LayoutTable = { ...src, id: `table-${n}`, name: nextTableName(tables), guestIds: [] };
  const spot = freeSpot(tables, copy, src.x + 3, src.z);
  const added = { ...copy, x: spot.x, z: spot.z };
  return { tables: [...tables, added], added };
}
