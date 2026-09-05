export const ROOM = { width: 28, depth: 28, height: 8 } as const;
export type LayoutTable = {
  id: string;
  name: string;
  x: number;
  z: number;
  rotation: number;
  width: number;
  depth: number;
  shape: "round" | "rect";
  capacity: number;
  guestIds: string[];
};
export type DemoGuest = { id: string; name: string; household: string };
/** Everything the browser keeps for the sample plan. */
export type Draft = { tables: LayoutTable[]; guests: DemoGuest[] };

const FAMILIES = [
  "Ramírez",
  "Hernández",
  "Castillo",
  "Morales",
  "Delgado",
  "Navarro",
  "Ortega",
  "Salinas",
  "Whitfield",
  "Bennett",
  "Okafor",
  "Nguyen",
  "Rossi",
  "Fischer",
  "Kaur",
  "Álvarez",
  "Peña",
  "Cárdenas",
  "Lindqvist",
  "Mendoza",
];
const FIRST_NAMES = [
  "Ana",
  "Luis",
  "Sofía",
  "Mateo",
  "Carmen",
  "Diego",
  "Lucía",
  "Andrés",
  "Valeria",
  "Javier",
  "Elena",
  "Tomás",
  "Paula",
  "Ricardo",
  "Inés",
  "Bruno",
  "Marta",
  "Sergio",
  "Clara",
  "Pablo",
  "Rosa",
  "Emilio",
  "Julia",
  "Adrián",
  "Teresa",
  "Hugo",
  "Alicia",
  "Martín",
  "Silvia",
  "Raúl",
  "Nora",
  "Iván",
  "Grace",
  "Oliver",
  "Harriet",
  "Sam",
  "Claire",
  "Owen",
  "Maggie",
  "Theo",
  "Adaeze",
  "Chidi",
  "Ngozi",
  "Emeka",
  "Linh",
  "Minh",
  "Hoa",
  "Bao",
  "Giulia",
  "Marco",
  "Chiara",
  "Luca",
  "Anna",
  "Jonas",
  "Lena",
  "Felix",
  "Priya",
  "Arjun",
  "Simran",
  "Dev",
  "Beatriz",
  "Gonzalo",
  "Pilar",
  "Nico",
  "Daniela",
  "Rodrigo",
  "Fernanda",
  "Alejandro",
  "Mariana",
  "Esteban",
  "Regina",
  "Santiago",
  "Elsa",
  "Anders",
  "Maja",
  "Erik",
  "Camila",
  "Joaquín",
  "Ximena",
  "Rafael",
];
export const demoGuests: DemoGuest[] = Array.from({ length: 80 }, (_, i) => ({
  id: `demo-${i + 1}`,
  name: `${FIRST_NAMES[i]} ${FAMILIES[Math.floor(i / 4)]}`,
  household: `${FAMILIES[Math.floor(i / 4)]} family`,
}));

export function initialTables(): LayoutTable[] {
  return Array.from({ length: 16 }, (_, i) => ({
    id: `table-${i + 1}`,
    name: i === 0 ? "Head table" : `Table ${i + 1}`,
    x: [-9, -3, 3, 9][i % 4],
    z: [-9, -4, 5, 10][Math.floor(i / 4)],
    rotation: 0,
    width: i === 0 ? 3.2 : 1.8,
    depth: i === 0 ? 1 : 1.8,
    shape: i === 0 ? "rect" : "round",
    capacity: 8,
    guestIds: demoGuests.slice(i * 4, i * 4 + 4).map((g) => g.id),
  }));
}
export function initialDraft(): Draft {
  return { tables: initialTables(), guests: demoGuests };
}
export function clampPosition(t: LayoutTable, x: number, z: number) {
  const a = (t.rotation * Math.PI) / 180;
  const halfX =
    (Math.abs(Math.cos(a)) * t.width + Math.abs(Math.sin(a)) * t.depth) / 2 +
    0.65;
  const halfZ =
    (Math.abs(Math.sin(a)) * t.width + Math.abs(Math.cos(a)) * t.depth) / 2 +
    0.65;
  return {
    x: Math.max(-14 + halfX, Math.min(14 - halfX, Math.round(x * 4) / 4)),
    z: Math.max(-14 + halfZ, Math.min(14 - halfZ, Math.round(z * 4) / 4)),
  };
}
export function assignDemo(
  tables: LayoutTable[],
  tableId: string,
  ids: string[],
  guests: DemoGuest[] = demoGuests,
): LayoutTable[] {
  const table = tables.find((t) => t.id === tableId);
  if (!table) throw new Error("Choose a table first.");
  const wanted = [...new Set(ids)];
  if (wanted.some((id) => !guests.some((g) => g.id === id)))
    throw new Error("That guest is no longer on the list.");
  const free =
    table.capacity - table.guestIds.filter((id) => !wanted.includes(id)).length;
  if (wanted.length > free)
    throw new Error(
      free <= 0
        ? `${table.name} is full.`
        : `${table.name} only has ${free} free ${free === 1 ? "seat" : "seats"} left.`,
    );
  return tables.map((t) => ({
    ...t,
    guestIds: [
      ...t.guestIds.filter((id) => !wanted.includes(id)),
      ...(t.id === tableId ? wanted : []),
    ],
  }));
}
export function unseat(tables: LayoutTable[], ids: string[]): LayoutTable[] {
  return tables.map((t) => ({
    ...t,
    guestIds: t.guestIds.filter((id) => !ids.includes(id)),
  }));
}

/** Footprint for a shape and seat count: round tables grow, long tables lengthen. */
export function footprintFor(shape: LayoutTable["shape"], capacity: number) {
  if (shape === "round") {
    const size =
      capacity <= 6 ? 1.5 : capacity <= 8 ? 1.8 : capacity <= 10 ? 2.1 : 2.4;
    return { width: size, depth: size };
  }
  const length = Math.round(Math.ceil(capacity / 2) * 6) / 10;
  return { width: Math.min(5, Math.max(1.8, length)), depth: 1 };
}
export function setShape(
  t: LayoutTable,
  shape: LayoutTable["shape"],
): LayoutTable {
  const next = { ...t, shape, ...footprintFor(shape, t.capacity) };
  return { ...next, ...clampPosition(next, next.x, next.z) };
}
export function setCapacity(t: LayoutTable, capacity: number): LayoutTable {
  const seats = Math.max(1, Math.min(16, Math.round(capacity)));
  if (seats < t.guestIds.length)
    throw new Error(
      `${t.guestIds.length} guests are already seated at ${t.name}. Move someone first.`,
    );
  const next = { ...t, capacity: seats, ...footprintFor(t.shape, seats) };
  return { ...next, ...clampPosition(next, next.x, next.z) };
}

function tooClose(a: LayoutTable, b: LayoutTable) {
  // Conservative chair-envelope check, not a certified clearance calculation.
  const ra = Math.hypot(a.width, a.depth) / 2 + 0.55,
    rb = Math.hypot(b.width, b.depth) / 2 + 0.55;
  return Math.hypot(a.x - b.x, a.z - b.z) < ra + rb;
}
function onDanceFloor(t: LayoutTable) {
  return Math.abs(t.x) < 4.5 + t.width / 2 && Math.abs(t.z) < 2 + t.depth / 2;
}
export function nextTableName(tables: LayoutTable[]) {
  const used = new Set(tables.map((t) => t.name.trim().toLowerCase()));
  let n = tables.length + 1;
  while (used.has(`table ${n}`)) n++;
  return `Table ${n}`;
}
/** Adds a round eight-seat table on the first open patch of floor. */
export function addTable(tables: LayoutTable[]): LayoutTable[] {
  if (tables.length >= 50) throw new Error("This room already has 50 tables.");
  const ids = new Set(tables.map((t) => t.id));
  let n = tables.length + 1;
  while (ids.has(`table-${n}`)) n++;
  const base: LayoutTable = {
    id: `table-${n}`,
    name: nextTableName(tables),
    x: 0,
    z: 0,
    rotation: 0,
    shape: "round",
    capacity: 8,
    guestIds: [],
    ...footprintFor("round", 8),
  };
  const spots: { x: number; z: number }[] = [];
  for (let z = -12; z <= 12; z += 1)
    for (let x = -12; x <= 12; x += 1) spots.push({ x, z });
  spots.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  let placed: LayoutTable | null = null;
  for (const spot of spots) {
    const candidate = { ...base, ...clampPosition(base, spot.x, spot.z) };
    if (onDanceFloor(candidate)) continue;
    if (tables.some((t) => tooClose(t, candidate))) continue;
    placed = candidate;
    break;
  }
  return [...tables, placed ?? { ...base, ...clampPosition(base, 0, 12) }];
}
export function removeTable(tables: LayoutTable[], id: string): LayoutTable[] {
  if (tables.length <= 1) throw new Error("Keep at least one table.");
  return tables.filter((t) => t.id !== id);
}

export function addGuest(
  guests: DemoGuest[],
  name: string,
  household?: string,
): DemoGuest[] {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("Type the guest's name first.");
  if (trimmed.length > 60) throw new Error("Please use a shorter name.");
  if (guests.length >= 400) throw new Error("The sample list is full.");
  if (guests.some((g) => g.name.toLowerCase() === trimmed.toLowerCase()))
    throw new Error(`${trimmed} is already on the list.`);
  const family = (household ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const ids = new Set(guests.map((g) => g.id));
  let n = 1;
  while (ids.has(`guest-${n}`)) n++;
  return [
    ...guests,
    {
      id: `guest-${n}`,
      name: trimmed,
      household: family || `${trimmed.split(" ").at(-1)} family`,
    },
  ];
}
export function removeGuest(draft: Draft, id: string): Draft {
  return {
    guests: draft.guests.filter((g) => g.id !== id),
    tables: unseat(draft.tables, [id]),
  };
}

export function layoutWarnings(tables: LayoutTable[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < tables.length; i++) {
    const a = tables[i];
    if (a.guestIds.length > a.capacity)
      warnings.push(`${a.name} has more guests than seats.`);
    for (const b of tables.slice(i + 1))
      if (tooClose(a, b))
        warnings.push(
          `${a.name} and ${b.name} are very close. Chairs may not fit between them.`,
        );
    if (onDanceFloor(a))
      warnings.push(`${a.name} is sitting on the dance floor.`);
  }
  return warnings;
}

export function parseGuests(value: unknown): DemoGuest[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 400)
    throw new Error("Invalid guest list.");
  const ids = new Set<string>();
  return value.map((raw) => {
    const g = raw as DemoGuest;
    if (
      !g ||
      typeof g.id !== "string" ||
      ids.has(g.id) ||
      typeof g.name !== "string" ||
      !g.name.trim() ||
      g.name.length > 60 ||
      typeof g.household !== "string" ||
      g.household.length > 60
    )
      throw new Error("Invalid guest list.");
    ids.add(g.id);
    return { id: g.id, name: g.name, household: g.household };
  });
}
export function parseDraft(
  value: unknown,
  guests: DemoGuest[] = demoGuests,
): LayoutTable[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error("Invalid layout.");
  const ids = new Set<string>(),
    seated = new Set<string>();
  return value.map((raw) => {
    const t = raw as LayoutTable;
    if (
      !t ||
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      typeof t.name !== "string" ||
      !t.name.trim() ||
      t.name.length > 80 ||
      !["round", "rect"].includes(t.shape) ||
      ![t.x, t.z, t.rotation, t.width, t.depth, t.capacity].every(
        Number.isFinite,
      ) ||
      t.width < 0.5 ||
      t.width > 5 ||
      t.depth < 0.5 ||
      t.depth > 5 ||
      !Number.isInteger(t.capacity) ||
      t.capacity < 1 ||
      t.capacity > 16 ||
      !Array.isArray(t.guestIds) ||
      t.guestIds.length > t.capacity
    )
      throw new Error("Invalid layout.");
    ids.add(t.id);
    for (const id of t.guestIds) {
      if (seated.has(id) || !guests.some((g) => g.id === id))
        throw new Error("Invalid guest assignment.");
      seated.add(id);
    }
    return {
      id: t.id,
      name: t.name,
      rotation: t.rotation,
      width: t.width,
      depth: t.depth,
      shape: t.shape,
      capacity: t.capacity,
      guestIds: [...t.guestIds],
      ...clampPosition(t, t.x, t.z),
    };
  });
}
/** Accepts the current `{ tables, guests }` shape and the older tables-only array. */
export function parseSavedDraft(value: unknown): Draft {
  if (Array.isArray(value))
    return { tables: parseDraft(value), guests: demoGuests };
  const raw = value as Partial<Draft> | null;
  if (!raw || typeof raw !== "object") throw new Error("Invalid layout.");
  const guests = parseGuests(raw.guests);
  return { guests, tables: parseDraft(raw.tables, guests) };
}
