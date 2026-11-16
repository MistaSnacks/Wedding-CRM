/**
 * The on-screen report builder's pure logic: flatten the report snapshot into
 * one row per guest per invited event, then filter, sort, group and count it.
 *
 * Counting rules are the ones `buildGuestReport` uses, so a number on screen
 * always equals the number in the matching download:
 *  - a guest only exists for an event their household is invited to;
 *  - no response row means "pending";
 *  - a meal only counts when the option belongs to that event (or to no event);
 *  - a table only counts when it belongs to that event.
 *
 * Nothing here touches the database or the DOM, and the row shape carries no
 * admin notes, invite codes or access tokens — it is safe to send to the client.
 */
import type { AgeType, Attending } from "@/lib/types";
import type { ReportData } from "./guest-reports";

export type ReportRow = {
  /** Unique per guest per event. Never shown. */
  key: string;
  guestId: string;
  householdId: string;
  guest: string;
  household: string;
  eventId: string;
  eventName: string;
  rsvp: Attending;
  /** Dish name, or "" when none is chosen for this event. */
  meal: string;
  /** Table name, or "" when not seated at this event. */
  table: string;
  ageType: AgeType;
  dietary: string;
  allergies: string;
  accessibility: string;
  email: string;
  phone: string;
  tags: string[];
  /** Instant of the reply (for sorting only), or "". */
  respondedAt: string;
  /** The reply date as people read it ("Sep 3, 2026"), or "". */
  respondedOn: string;
};

export type ReportEvent = {
  id: string;
  name: string;
  /** Dishes on offer for this event, in menu order. */
  meals: string[];
};

/** Filter value meaning "has no meal" / "has no table". */
export const NONE = "__none__";

export type ReportFilters = {
  /** Empty = any answer. */
  rsvp: Attending[];
  /** Dish names and/or `NONE`. Empty = any. */
  meals: string[];
  /** Table name, `NONE`, or "" for any. */
  table: string;
  /** Empty = any age. */
  ages: AgeType[];
  /** Household tag, or "" for any. */
  tag: string;
  hasDietary: boolean;
  hasAccessibility: boolean;
  query: string;
};

export const NO_FILTERS: ReportFilters = {
  rsvp: [],
  meals: [],
  table: "",
  ages: [],
  tag: "",
  hasDietary: false,
  hasAccessibility: false,
  query: "",
};

export type ColumnKey =
  | "guest" | "household" | "event" | "rsvp" | "meal" | "table" | "age"
  | "dietary" | "allergies" | "accessibility" | "email" | "phone" | "tags" | "responded";

export const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: "guest", label: "Guest" },
  { key: "household", label: "Household" },
  { key: "event", label: "Event" },
  { key: "rsvp", label: "RSVP" },
  { key: "meal", label: "Meal" },
  { key: "table", label: "Table" },
  { key: "age", label: "Adult or child" },
  { key: "dietary", label: "Dietary notes" },
  { key: "allergies", label: "Allergies" },
  { key: "accessibility", label: "Accessibility needs" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "tags", label: "Tags" },
  { key: "responded", label: "Replied on" },
];

export type GroupBy = "none" | "household" | "table" | "meal" | "event";

export type ReportPreset = {
  key: string;
  label: string;
  /** One plain line for the screen reader / tooltip. */
  hint: string;
  filters: Partial<ReportFilters>;
  columns: ColumnKey[];
  groupBy: GroupBy;
};

export const PRESETS: ReportPreset[] = [
  { key: "everyone", label: "Everyone invited", hint: "Every invited guest and their answer", filters: {}, columns: ["guest", "household", "rsvp", "meal", "table"], groupBy: "none" },
  { key: "coming", label: "Coming", hint: "Guests who said yes", filters: { rsvp: ["yes"] }, columns: ["guest", "household", "age", "meal", "table"], groupBy: "none" },
  { key: "not-coming", label: "Not coming", hint: "Guests who said no", filters: { rsvp: ["no"] }, columns: ["guest", "household", "responded", "email"], groupBy: "none" },
  { key: "awaiting", label: "Awaiting reply", hint: "Guests who have not answered yet", filters: { rsvp: ["pending"] }, columns: ["guest", "household", "email", "phone"], groupBy: "household" },
  { key: "meals", label: "Meal choices", hint: "What each coming guest will eat", filters: { rsvp: ["yes"] }, columns: ["guest", "household", "meal", "age", "dietary", "allergies"], groupBy: "meal" },
  { key: "dietary", label: "Dietary & allergies", hint: "Coming guests with a dietary note or an allergy", filters: { rsvp: ["yes"], hasDietary: true }, columns: ["guest", "household", "meal", "table", "dietary", "allergies"], groupBy: "none" },
  { key: "accessibility", label: "Accessibility needs", hint: "Coming guests who asked for help getting around", filters: { rsvp: ["yes"], hasAccessibility: true }, columns: ["guest", "household", "table", "accessibility", "phone"], groupBy: "none" },
  { key: "seating", label: "Seating (who sits where)", hint: "Coming guests, table by table", filters: { rsvp: ["yes"] }, columns: ["guest", "household", "table", "meal", "dietary"], groupBy: "table" },
  { key: "no-meal", label: "Coming but no meal yet", hint: "Coming guests who still need to choose a dish", filters: { rsvp: ["yes"], meals: [NONE] }, columns: ["guest", "household", "email", "phone"], groupBy: "none" },
  { key: "no-table", label: "Coming but no table yet", hint: "Coming guests who still need a seat", filters: { rsvp: ["yes"], table: NONE }, columns: ["guest", "household", "meal", "age"], groupBy: "none" },
];

export const RSVP_LABEL: Record<Attending, string> = { yes: "Coming", no: "Not coming", pending: "Awaiting reply" };
export const AGE_LABEL: Record<AgeType, string> = { adult: "Adult", child: "Child", infant: "Infant" };
export const NO_MEAL_LABEL = "No meal chosen yet";
export const NO_TABLE_LABEL = "No table yet";

const text = (value: string | null | undefined): string => (value ?? "").trim();

/** Strip accents and case so "Huyen" finds Huyền (same rule as the guest search). */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function formatDay(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(ms));
}

/** The events in display order, each with the dishes its guests can choose. */
export function reportEvents(data: Pick<ReportData, "events" | "meals">): ReportEvent[] {
  return data.events.map((event) => ({
    id: event.id,
    name: event.name,
    meals: [...new Set(
      data.meals
        .filter((m) => (!m.event_id || m.event_id === event.id) && m.is_active !== false)
        .map((m) => m.name),
    )],
  }));
}

/** One row per guest per event the guest's household is invited to. */
export function flattenReportRows(data: ReportData, options: { timeZone?: string } = {}): ReportRow[] {
  const timeZone = options.timeZone ?? "America/Los_Angeles";
  const byResponse = new Map(data.responses.map((r) => [`${r.guest_id}:${r.event_id}`, r]));
  const bySeat = new Map(data.seats.map((s) => [`${s.guest_id}:${s.event_id}`, s]));
  const byTable = new Map(data.tables.map((t) => [t.id, t]));
  const byMeal = new Map(data.meals.map((m) => [m.id, m]));
  const invites = new Set(data.invites.map((i) => `${i.household_id}:${i.event_id}`));

  const rows: ReportRow[] = [];
  for (const event of data.events) {
    for (const h of data.hhs) {
      if (!invites.has(`${h.id}:${event.id}`)) continue;
      for (const g of h.guests) {
        const response = byResponse.get(`${g.id}:${event.id}`);
        const option = byMeal.get(response?.meal_option_id ?? "");
        const seat = bySeat.get(`${g.id}:${event.id}`);
        const table = seat && byTable.get(seat.table_id);
        const respondedAt = text(response?.responded_at);
        rows.push({
          key: `${g.id}:${event.id}`,
          guestId: g.id,
          householdId: h.id,
          guest: `${text(g.first_name)} ${text(g.last_name)}`.trim(),
          household: text(h.display_name),
          eventId: event.id,
          eventName: event.name,
          rsvp: response?.attending ?? "pending",
          meal: option && (!option.event_id || option.event_id === event.id) ? option.name : "",
          table: table?.event_id === event.id ? table.name : "",
          ageType: g.age_type ?? "adult",
          dietary: text(g.dietary_restrictions),
          allergies: text(g.allergies),
          accessibility: text(g.accessibility_needs),
          email: text(h.email),
          phone: text(h.phone),
          tags: [...(h.tags ?? [])],
          respondedAt,
          respondedOn: respondedAt ? formatDay(respondedAt, timeZone) : "",
        });
      }
    }
  }
  return rows;
}

/** Rows for one event, or every row when `eventId` is null ("All events"). */
export function rowsForEvent(rows: ReportRow[], eventId: string | null): ReportRow[] {
  return eventId ? rows.filter((r) => r.eventId === eventId) : rows;
}

export function filterRows(rows: ReportRow[], filters: ReportFilters): ReportRow[] {
  const tokens = fold(filters.query).split(" ").filter(Boolean);
  return rows.filter((r) => {
    if (filters.rsvp.length && !filters.rsvp.includes(r.rsvp)) return false;
    if (filters.meals.length && !filters.meals.includes(r.meal || NONE)) return false;
    if (filters.table && (filters.table === NONE ? r.table !== "" : r.table !== filters.table)) return false;
    if (filters.ages.length && !filters.ages.includes(r.ageType)) return false;
    if (filters.tag && !r.tags.includes(filters.tag)) return false;
    if (filters.hasDietary && !r.dietary && !r.allergies) return false;
    if (filters.hasAccessibility && !r.accessibility) return false;
    if (tokens.length) {
      const hay = `${fold(r.guest)} ${fold(r.household)}`;
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

export type ReportSummary = {
  invited: number;
  coming: number;
  notComing: number;
  awaiting: number;
  /** Of those coming. */
  adults: number;
  children: number;
  infants: number;
  /** Of those coming, per dish; dishes nobody chose stay in with 0. */
  meals: Array<{ name: string; count: number }>;
  /** Coming, with no dish chosen. */
  noMeal: number;
  /** Coming, with no table. */
  noTable: number;
};

/** Counts for a set of rows. Pass the event's menu so unchosen dishes show as 0. */
export function summarize(rows: ReportRow[], menu: string[] = []): ReportSummary {
  const meals = new Map<string, number>(menu.map((name) => [name, 0]));
  const s: ReportSummary = { invited: rows.length, coming: 0, notComing: 0, awaiting: 0, adults: 0, children: 0, infants: 0, meals: [], noMeal: 0, noTable: 0 };
  for (const r of rows) {
    if (r.rsvp === "no") s.notComing += 1;
    else if (r.rsvp !== "yes") s.awaiting += 1;
    else {
      s.coming += 1;
      if (r.ageType === "child") s.children += 1;
      else if (r.ageType === "infant") s.infants += 1;
      else s.adults += 1;
      if (r.meal) meals.set(r.meal, (meals.get(r.meal) ?? 0) + 1);
      else s.noMeal += 1;
      if (!r.table) s.noTable += 1;
    }
  }
  s.meals = [...meals].map(([name, count]) => ({ name, count }));
  return s;
}

export type SortKey = ColumnKey;
export type SortState = { key: SortKey; dir: "asc" | "desc" };

const RSVP_ORDER: Record<Attending, number> = { yes: 0, no: 1, pending: 2 };
const AGE_ORDER: Record<AgeType, number> = { adult: 0, child: 1, infant: 2 };
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function sortValue(r: ReportRow, key: SortKey): string | number {
  switch (key) {
    case "guest": return r.guest;
    case "household": return r.household;
    case "event": return r.eventName;
    case "rsvp": return RSVP_ORDER[r.rsvp];
    case "meal": return r.meal;
    case "table": return r.table;
    case "age": return AGE_ORDER[r.ageType];
    case "dietary": return r.dietary;
    case "allergies": return r.allergies;
    case "accessibility": return r.accessibility;
    case "email": return r.email;
    case "phone": return r.phone;
    case "tags": return r.tags.join(", ");
    case "responded": return r.respondedAt;
  }
}

/** Stable sort. Blank text always sinks to the bottom, in either direction. */
export function sortRows(rows: ReportRow[], sort: SortState): ReportRow[] {
  const flip = sort.dir === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, sort.key) }))
    .sort((a, b) => {
      if (typeof a.value === "number" && typeof b.value === "number") {
        return (a.value - b.value) * flip || a.index - b.index;
      }
      const x = String(a.value), y = String(b.value);
      if (!x || !y) return (x ? -1 : y ? 1 : 0) || a.index - b.index;
      return collator.compare(x, y) * flip || a.index - b.index;
    })
    .map((entry) => entry.row);
}

export type ReportGroup = {
  key: string;
  label: string;
  rows: ReportRow[];
  /** Subtotals for the group header. */
  guests: number;
  coming: number;
};

/**
 * Split rows into groups, keeping the incoming row order inside each group.
 * Named groups come first in natural order ("Table 2" before "Table 10"); the
 * "no table yet" / "no meal chosen yet" group is always last.
 */
export function groupRows(rows: ReportRow[], groupBy: GroupBy): ReportGroup[] {
  if (groupBy === "none") return [{ key: "all", label: "", rows, guests: rows.length, coming: rows.filter((r) => r.rsvp === "yes").length }];
  const groups = new Map<string, ReportGroup>();
  for (const r of rows) {
    const [key, label] =
      groupBy === "household" ? [r.householdId, r.household]
      : groupBy === "event" ? [r.eventId, r.eventName]
      : groupBy === "table" ? [r.table, r.table || NO_TABLE_LABEL]
      : [r.meal, r.meal || NO_MEAL_LABEL];
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { key: key || NONE, label, rows: [], guests: 0, coming: 0 }));
    group.rows.push(r);
    group.guests += 1;
    if (r.rsvp === "yes") group.coming += 1;
  }
  const list = [...groups.values()];
  // Events keep their own display order (rows arrive event by event).
  if (groupBy === "event") return list;
  return list.sort((a, b) => (a.key === NONE ? 1 : 0) - (b.key === NONE ? 1 : 0) || collator.compare(a.label, b.label));
}

/** The active filters in plain words, e.g. ["Coming", "Chicken"]. */
export function describeFilters(filters: ReportFilters): string[] {
  const parts: string[] = [];
  if (filters.rsvp.length) parts.push(filters.rsvp.map((a) => RSVP_LABEL[a]).join(" or "));
  if (filters.meals.length) parts.push(filters.meals.map((m) => (m === NONE ? NO_MEAL_LABEL : m)).join(" or "));
  if (filters.table) parts.push(filters.table === NONE ? NO_TABLE_LABEL : filters.table);
  if (filters.ages.length) parts.push(filters.ages.map((a) => (a === "adult" ? "Adults" : a === "child" ? "Children" : "Infants")).join(" or "));
  if (filters.tag) parts.push(`Tagged “${filters.tag}”`);
  if (filters.hasDietary) parts.push("Has a dietary note or allergy");
  if (filters.hasAccessibility) parts.push("Has an accessibility need");
  if (filters.query.trim()) parts.push(`Matching “${filters.query.trim()}”`);
  return parts;
}

export function hasActiveFilters(filters: ReportFilters): boolean {
  return describeFilters(filters).length > 0;
}

/**
 * What a cell says, on screen and in the downloaded file alike. A coming guest
 * with no dish or no table gets a plain reminder; for anyone else the gap is
 * not a problem, so the cell stays empty.
 */
export function cellText(r: ReportRow, column: ColumnKey): string {
  switch (column) {
    case "guest": return r.guest;
    case "household": return r.household;
    case "event": return r.eventName;
    case "rsvp": return RSVP_LABEL[r.rsvp];
    case "meal": return r.meal || (r.rsvp === "yes" ? NO_MEAL_LABEL : "");
    case "table": return r.table || (r.rsvp === "yes" ? NO_TABLE_LABEL : "");
    case "age": return AGE_LABEL[r.ageType] ?? "";
    case "dietary": return r.dietary;
    case "allergies": return r.allergies;
    case "accessibility": return r.accessibility;
    case "email": return r.email;
    case "phone": return r.phone;
    case "tags": return r.tags.join(", ");
    case "responded": return r.respondedOn;
  }
}

/** True when the cell is a reminder ("No meal chosen yet"), not a real value. */
export function isReminder(r: ReportRow, column: ColumnKey): boolean {
  return r.rsvp === "yes" && ((column === "meal" && !r.meal) || (column === "table" && !r.table));
}

/** Spreadsheet rows for exactly the given rows and columns, in that order. */
export function exportRows(rows: ReportRow[], columns: ColumnKey[]): Array<Record<string, string>> {
  const picked = COLUMNS.filter((c) => columns.includes(c.key));
  return rows.map((r) => Object.fromEntries(picked.map((c) => [c.label, cellText(r, c.key)])));
}

/** Distinct values for the filter controls, from the rows on screen. */
export function filterOptions(rows: ReportRow[], menu: string[] = []): { meals: string[]; tables: string[]; tags: string[]; ages: AgeType[] } {
  const meals = new Set(menu);
  const tables = new Set<string>();
  const tags = new Set<string>();
  const ages = new Set<AgeType>();
  for (const r of rows) {
    if (r.meal) meals.add(r.meal);
    if (r.table) tables.add(r.table);
    for (const tag of r.tags) if (tag.trim()) tags.add(tag);
    ages.add(r.ageType);
  }
  return {
    meals: [...meals],
    tables: [...tables].sort(collator.compare),
    tags: [...tags].sort(collator.compare),
    ages: (["adult", "child", "infant"] as const).filter((a) => ages.has(a)),
  };
}

/** "reception-coming-2026-11-16" — safe for a file name on any system. */
export function fileStem(parts: string[], day: string): string {
  const slug = parts
    .map((p) => fold(p).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-")
    .slice(0, 80);
  return `${slug || "guest-report"}-${day}`;
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
