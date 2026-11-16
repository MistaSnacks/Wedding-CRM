import { describe, expect, it } from "vitest";
import { buildGuestReport, type ReportData } from "./guest-reports";
import {
  NONE, NO_FILTERS, PRESETS, cellText, describeFilters, exportRows, fileStem, filterOptions, filterRows,
  flattenReportRows, groupRows, reportEvents, rowsForEvent, sortRows, summarize, type ReportFilters,
} from "./report-view";

const guest = (id: string, first: string, household_id: string, extra: Record<string, unknown> = {}) =>
  ({ id, first_name: first, last_name: "Test", age_type: "adult", household_id, dietary_restrictions: null, allergies: null, accessibility_needs: null, internal_notes: "PRIVATE NOTE", ...extra });

const data = {
  hhs: [
    { id: "h1", display_name: "Alvarez Family", email: "alvarez@example.com", phone: "555-0101", tags: ["Family", "Bride side"], invite_code: "SECRETCODE", access_token: "SECRETTOKEN", internal_notes: "PRIVATE NOTE",
      guests: [guest("g1", "Ana", "h1", { dietary_restrictions: "Vegetarian" }), guest("g2", "Beto", "h1", { age_type: "child" }), guest("g3", "Caro", "h1", { allergies: "Peanuts", accessibility_needs: "Wheelchair" })] },
    { id: "h2", display_name: "Nguyễn Household", email: null, phone: null, tags: ["Friends"],
      guests: [guest("g4", "Huyền", "h2"), guest("g5", "Dan", "h2", { age_type: "infant" })] },
    // Invited to the rehearsal only: must never count for the reception.
    { id: "h3", display_name: "Zed Household", email: "zed@example.com", phone: null, tags: null, guests: [guest("g6", "Zoe", "h3")] },
  ],
  events: [{ id: "e1", name: "Rehearsal" }, { id: "e2", name: "Reception" }],
  invites: [
    { household_id: "h1", event_id: "e1" }, { household_id: "h1", event_id: "e2" },
    { household_id: "h2", event_id: "e2" },
    { household_id: "h3", event_id: "e1" },
  ],
  responses: [
    { guest_id: "g1", event_id: "e1", attending: "yes", meal_option_id: "m1", responded_at: "2026-09-03T18:00:00Z" },
    { guest_id: "g1", event_id: "e2", attending: "yes", meal_option_id: "m2", responded_at: "2026-09-03T18:00:00Z" },
    { guest_id: "g2", event_id: "e2", attending: "yes", meal_option_id: "m4", responded_at: "2026-09-03T18:00:00Z" },
    // A rehearsal dish saved against the reception does not count as a reception meal.
    { guest_id: "g3", event_id: "e2", attending: "yes", meal_option_id: "m1", responded_at: "2026-09-04T03:00:00Z" },
    { guest_id: "g4", event_id: "e2", attending: "no", meal_option_id: null, responded_at: "2026-09-05T18:00:00Z" },
    { guest_id: "g6", event_id: "e1", attending: "yes", meal_option_id: "m1", responded_at: null },
  ],
  meals: [
    { id: "m1", event_id: "e1", name: "Pasta", is_active: true },
    { id: "m2", event_id: "e2", name: "Beef", is_active: true },
    { id: "m3", event_id: "e2", name: "Chicken", is_active: true },
    { id: "m4", event_id: null, name: "Kids plate", is_active: true },
    { id: "m5", event_id: "e2", name: "Retired dish", is_active: false },
  ],
  tables: [{ id: "t1", event_id: "e1", name: "Garden" }, { id: "t2", event_id: "e2", name: "Table 2" }, { id: "t10", event_id: "e2", name: "Table 10" }],
  seats: [
    { guest_id: "g1", event_id: "e1", table_id: "t1" },
    { guest_id: "g1", event_id: "e2", table_id: "t10" },
    { guest_id: "g2", event_id: "e2", table_id: "t2" },
    // A rehearsal table saved against the reception is not a reception seat.
    { guest_id: "g3", event_id: "e2", table_id: "t1" },
  ],
} as unknown as ReportData;

const all = flattenReportRows(data, { timeZone: "America/Los_Angeles" });
const reception = rowsForEvent(all, "e2");
const menu = reportEvents(data).find((e) => e.id === "e2")!.meals;
const only = (filters: Partial<ReportFilters>) => filterRows(reception, { ...NO_FILTERS, ...filters });
const names = (rows: Array<{ guest: string }>) => rows.map((r) => r.guest.split(" ")[0]);

describe("flattenReportRows", () => {
  it("makes one row per guest per invited event", () => {
    expect(all).toHaveLength(9); // e1: h1 (3) + h3 (1); e2: h1 (3) + h2 (2)
    expect(names(reception)).toEqual(["Ana", "Beto", "Caro", "Huyền", "Dan"]);
    expect(new Set(all.map((r) => r.key)).size).toBe(all.length);
  });
  it("defaults a missing answer to pending", () => {
    expect(reception.find((r) => r.guestId === "g5")).toMatchObject({ rsvp: "pending", meal: "", table: "", respondedOn: "" });
  });
  it("only counts a meal or table that belongs to the event (or to no event)", () => {
    expect(reception.find((r) => r.guestId === "g3")).toMatchObject({ rsvp: "yes", meal: "", table: "" });
    expect(reception.find((r) => r.guestId === "g2")).toMatchObject({ meal: "Kids plate", table: "Table 2" });
  });
  it("shows the reply date as a calendar day at the venue, not a raw timestamp", () => {
    expect(reception.find((r) => r.guestId === "g1")!.respondedOn).toBe("Sep 3, 2026");
    // 03:00 UTC on the 4th is still the evening of the 3rd in Los Angeles.
    expect(reception.find((r) => r.guestId === "g3")!.respondedOn).toBe("Sep 3, 2026");
  });
  it("never carries notes, invite codes or tokens", () => {
    const json = JSON.stringify(all);
    expect(json).not.toMatch(/PRIVATE NOTE|SECRETCODE|SECRETTOKEN/);
  });
  it("copes with a household that has no tags", () => {
    expect(all.find((r) => r.guestId === "g6")!.tags).toEqual([]);
  });
});

describe("summarize", () => {
  const s = summarize(reception, menu);
  it("counts answers for the event", () => {
    expect(s).toMatchObject({ invited: 5, coming: 3, notComing: 1, awaiting: 1, adults: 2, children: 1, infants: 0, noMeal: 1, noTable: 1 });
  });
  it("lists every dish on the menu, including ones nobody chose, and hides retired dishes", () => {
    expect(s.meals).toEqual([{ name: "Beef", count: 1 }, { name: "Chicken", count: 0 }, { name: "Kids plate", count: 1 }]);
  });
  it("matches the downloadable reports number for number", () => {
    for (const event of data.events) {
      const sum = summarize(rowsForEvent(all, event.id));
      expect(sum.coming).toBe(buildGuestReport(data, "attending", event.id).rows.length);
      expect(sum.notComing).toBe(buildGuestReport(data, "declined", event.id).rows.length);
      expect(sum.awaiting).toBe(buildGuestReport(data, "pending", event.id).rows.length);
      const download = Object.fromEntries(buildGuestReport(data, "meals", event.id).rows.map((r) => [r.Meal, r.Count]));
      const screen = Object.fromEntries([...sum.meals.map((m) => [m.name, m.count]), ...(sum.noMeal ? [["MISSING", sum.noMeal]] : [])]);
      expect(screen).toEqual(download);
      const caterer = buildGuestReport(data, "caterer", event.id).rows;
      expect(sum.noTable).toBe(caterer.filter((r) => r.Table === "UNASSIGNED").length);
    }
  });
  it("adds up: every invited guest is in exactly one answer", () => {
    expect(s.coming + s.notComing + s.awaiting).toBe(s.invited);
    expect(s.meals.reduce((n, m) => n + m.count, 0) + s.noMeal).toBe(s.coming);
    expect(s.adults + s.children + s.infants).toBe(s.coming);
  });
});

describe("filterRows", () => {
  it("returns everything when no filter is set", () => {
    expect(only({})).toHaveLength(5);
  });
  it("filters by answer, meal, table, age and tag", () => {
    expect(names(only({ rsvp: ["yes"] }))).toEqual(["Ana", "Beto", "Caro"]);
    expect(names(only({ rsvp: ["no", "pending"] }))).toEqual(["Huyền", "Dan"]);
    expect(names(only({ meals: ["Beef", "Kids plate"] }))).toEqual(["Ana", "Beto"]);
    expect(names(only({ table: "Table 2" }))).toEqual(["Beto"]);
    expect(names(only({ ages: ["child", "infant"] }))).toEqual(["Beto", "Dan"]);
    expect(names(only({ tag: "Friends" }))).toEqual(["Huyền", "Dan"]);
  });
  it("combines filters", () => {
    expect(names(only({ rsvp: ["yes"], meals: [NONE] }))).toEqual(["Caro"]);
    expect(names(only({ rsvp: ["yes"], table: NONE }))).toEqual(["Caro"]);
    expect(names(only({ rsvp: ["yes"], ages: ["adult"], tag: "Family", hasDietary: true }))).toEqual(["Ana", "Caro"]);
  });
  it("finds dietary notes, allergies and accessibility needs", () => {
    expect(names(only({ hasDietary: true }))).toEqual(["Ana", "Caro"]);
    expect(names(only({ hasAccessibility: true }))).toEqual(["Caro"]);
  });
  it("searches guest and household names, ignoring accents and case", () => {
    expect(names(only({ query: "huyen" }))).toEqual(["Huyền"]);
    expect(names(only({ query: "NGUYEN house" }))).toEqual(["Huyền", "Dan"]);
    expect(only({ query: "nobody" })).toEqual([]);
  });
});

describe("presets", () => {
  const preset = (key: string) => only(PRESETS.find((p) => p.key === key)!.filters);
  it("match the standard downloads", () => {
    expect(preset("everyone")).toHaveLength(5);
    expect(preset("coming")).toHaveLength(buildGuestReport(data, "attending", "e2").rows.length);
    expect(preset("not-coming")).toHaveLength(buildGuestReport(data, "declined", "e2").rows.length);
    expect(preset("awaiting")).toHaveLength(buildGuestReport(data, "pending", "e2").rows.length);
    expect(names(preset("dietary"))).toEqual(buildGuestReport(data, "dietary", "e2").rows.map((r) => String(r.Guest).split(" ")[0]));
    expect(names(preset("accessibility"))).toEqual(buildGuestReport(data, "accessibility", "e2").rows.map((r) => String(r.Guest).split(" ")[0]));
    expect(preset("seating")).toHaveLength(buildGuestReport(data, "seating", "e2").rows.length);
  });
  it("find the coming guests who still need a meal or a table", () => {
    expect(names(preset("no-meal"))).toEqual(["Caro"]);
    expect(names(preset("no-table"))).toEqual(["Caro"]);
  });
  it("have unique keys and only known columns", () => {
    expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.columns[0]).toBe("guest");
  });
});

describe("sortRows", () => {
  it("sorts by name in both directions without changing the input", () => {
    const before = names(reception);
    expect(names(sortRows(reception, { key: "guest", dir: "desc" }))).toEqual(["Huyền", "Dan", "Caro", "Beto", "Ana"]);
    expect(names(sortRows(reception, { key: "guest", dir: "asc" }))).toEqual(["Ana", "Beto", "Caro", "Dan", "Huyền"]);
    expect(names(reception)).toEqual(before);
  });
  it("orders answers coming, not coming, awaiting", () => {
    expect(sortRows(reception, { key: "rsvp", dir: "asc" }).map((r) => r.rsvp)).toEqual(["yes", "yes", "yes", "no", "pending"]);
  });
  it("orders tables naturally and keeps blanks last either way", () => {
    expect(sortRows(reception, { key: "table", dir: "asc" }).map((r) => r.table)).toEqual(["Table 2", "Table 10", "", "", ""]);
    expect(sortRows(reception, { key: "table", dir: "desc" }).map((r) => r.table)).toEqual(["Table 10", "Table 2", "", "", ""]);
  });
});

describe("groupRows", () => {
  it("returns one unnamed group when grouping is off", () => {
    expect(groupRows(reception, "none")).toMatchObject([{ label: "", guests: 5, coming: 3 }]);
  });
  it("groups by household with subtotals", () => {
    expect(groupRows(reception, "household").map((g) => [g.label, g.guests, g.coming])).toEqual([["Alvarez Family", 3, 3], ["Nguyễn Household", 2, 0]]);
  });
  it("groups by table in natural order, unseated guests last", () => {
    expect(groupRows(reception, "table").map((g) => [g.label, g.guests])).toEqual([["Table 2", 1], ["Table 10", 1], ["No table yet", 3]]);
  });
  it("groups by meal, guests without a dish last", () => {
    expect(groupRows(only({ rsvp: ["yes"] }), "meal").map((g) => [g.label, g.guests])).toEqual([["Beef", 1], ["Kids plate", 1], ["No meal chosen yet", 1]]);
  });
  it("groups by event in event order", () => {
    expect(groupRows(all, "event").map((g) => [g.label, g.guests])).toEqual([["Rehearsal", 4], ["Reception", 5]]);
  });
  it("keeps every row exactly once", () => {
    for (const by of ["household", "table", "meal", "event"] as const) {
      expect(groupRows(all, by).reduce((n, g) => n + g.rows.length, 0)).toBe(all.length);
    }
  });
});

describe("words on screen and in files", () => {
  it("describes the active filters in plain words", () => {
    expect(describeFilters(NO_FILTERS)).toEqual([]);
    expect(describeFilters({ ...NO_FILTERS, rsvp: ["yes"], meals: ["Chicken", NONE], table: NONE, ages: ["child"], hasDietary: true, query: " ana " }))
      .toEqual(["Coming", "Chicken or No meal chosen yet", "No table yet", "Children", "Has a dietary note or allergy", "Matching “ana”"]);
  });
  it("never shows a shouted status word", () => {
    const cells = reception.flatMap((r) => (["rsvp", "meal", "table", "age"] as const).map((c) => cellText(r, c)));
    expect(cells.join(" ")).not.toMatch(/MISSING|UNASSIGNED|pending|\byes\b|\bno\b/);
  });
  it("reminds about a missing meal or table only for guests who are coming", () => {
    const caro = reception.find((r) => r.guestId === "g3")!;
    const huyen = reception.find((r) => r.guestId === "g4")!;
    expect([cellText(caro, "meal"), cellText(caro, "table")]).toEqual(["No meal chosen yet", "No table yet"]);
    expect([cellText(huyen, "meal"), cellText(huyen, "table")]).toEqual(["", ""]);
  });
  it("exports exactly the chosen columns, in screen order, with friendly headers", () => {
    expect(exportRows(only({ table: "Table 2" }), ["table", "guest", "rsvp", "age"])).toEqual([{ Guest: "Beto Test", RSVP: "Coming", Table: "Table 2", "Adult or child": "Child" }]);
    expect(Object.keys(exportRows(reception, ["meal", "guest"])[0])).toEqual(["Guest", "Meal"]);
  });
  it("offers only filter choices that exist", () => {
    expect(filterOptions(reception, menu)).toEqual({ meals: ["Beef", "Chicken", "Kids plate"], tables: ["Table 2", "Table 10"], tags: ["Bride side", "Family", "Friends"], ages: ["adult", "child", "infant"] });
  });
  it("builds a safe file name", () => {
    expect(fileStem(["Reception / Dinner", "Coming", "Nguyễn"], "2026-11-16")).toBe("reception-dinner-coming-nguyen-2026-11-16");
    expect(fileStem([], "2026-11-16")).toBe("guest-report-2026-11-16");
  });
});
