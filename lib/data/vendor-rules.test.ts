import { describe, it, expect } from "vitest";
import {
  DEFAULT_VENDOR_ROLES,
  DEFAULT_VENDOR_ROLE_NAMES,
  VENDOR_STATUSES,
  VENDOR_STATUS_ATTENTION_RANK,
  attentionRank,
  contractsOutstanding,
  effectivePrice,
  filterVendors,
  isContractOutstanding,
  isPending,
  isSecured,
  isVendorStatus,
  matchesVendorQuery,
  sortVendors,
  statusRank,
  syncPlan,
  teamRollup,
  teamRoles,
  validateVendor,
  vendorContractedCents,
  vendorCounts,
} from "./vendor-rules";
import type { VendorSearchFact, VendorStatus, SyncItemFact } from "./vendor-rules";

let seq = 0;

function vendor(overrides: Partial<VendorSearchFact> = {}): VendorSearchFact {
  seq += 1;
  return {
    id: `v-${seq}`,
    name: `Vendor ${seq}`,
    role: "Photographer",
    status: "researching",
    quoted_cents: null,
    contracted_cents: null,
    contract_signed_at: null,
    currency: "USD",
    sort_order: 0,
    ...overrides,
  };
}

function item(overrides: Partial<SyncItemFact> = {}): SyncItemFact {
  return { id: "bi-1", name: "Photography", contracted_cents: null, ...overrides };
}

/* ------------------------------------------------------------- the constant */

describe("VENDOR_STATUSES", () => {
  it("is exactly the six statuses the check constraint allows", () => {
    expect(VENDOR_STATUSES).toEqual([
      "researching",
      "contacted",
      "quoted",
      "booked",
      "completed",
      "passed",
    ]);
  });

  it("is in lifecycle order, so statusRank rises as work progresses", () => {
    expect(statusRank("researching")).toBe(0);
    expect(statusRank("contacted")).toBe(1);
    expect(statusRank("quoted")).toBe(2);
    expect(statusRank("booked")).toBe(3);
    expect(statusRank("completed")).toBe(4);
  });

  it("ranks passed last, as a terminal state rather than an achievement", () => {
    expect(statusRank("passed")).toBe(5);
  });

  it("orders attention so an unanswered quote outranks a settled booking", () => {
    expect(attentionRank("quoted")).toBeLessThan(attentionRank("contacted"));
    expect(attentionRank("contacted")).toBeLessThan(attentionRank("researching"));
    expect(attentionRank("researching")).toBeLessThan(attentionRank("booked"));
    expect(attentionRank("booked")).toBeLessThan(attentionRank("completed"));
    expect(attentionRank("completed")).toBeLessThan(attentionRank("passed"));
  });

  it("gives every status an attention rank", () => {
    for (const status of VENDOR_STATUSES) {
      expect(Number.isFinite(VENDOR_STATUS_ATTENTION_RANK[status])).toBe(true);
    }
  });

  it("narrows arbitrary text to a status", () => {
    expect(isVendorStatus("booked")).toBe(true);
    expect(isVendorStatus("Booked")).toBe(false);
    expect(isVendorStatus("archived")).toBe(false);
    expect(isVendorStatus(null)).toBe(false);
    expect(isVendorStatus(3)).toBe(false);
  });

  it("treats booked and completed as secured and nothing else", () => {
    const secured = VENDOR_STATUSES.filter(isSecured);
    expect(secured).toEqual(["booked", "completed"]);
  });

  it("treats the three early statuses as pending and excludes passed", () => {
    const pending = VENDOR_STATUSES.filter(isPending);
    expect(pending).toEqual(["researching", "contacted", "quoted"]);
    expect(isPending("passed")).toBe(false);
  });
});

/* ----------------------------------------------------------------- counting */

describe("vendorCounts", () => {
  it("reports zeros for an empty list", () => {
    expect(vendorCounts([])).toEqual({
      total: 0,
      researching: 0,
      contacted: 0,
      quoted: 0,
      booked: 0,
      completed: 0,
      passed: 0,
      secured: 0,
      pending: 0,
      contractsOutstanding: 0,
      contractsSigned: 0,
    });
  });

  it("counts each status into its own chip", () => {
    const counts = vendorCounts([
      vendor({ status: "researching" }),
      vendor({ status: "researching" }),
      vendor({ status: "contacted" }),
      vendor({ status: "quoted" }),
      vendor({ status: "booked" }),
      vendor({ status: "completed" }),
      vendor({ status: "passed" }),
    ]);
    expect(counts.total).toBe(7);
    expect(counts.researching).toBe(2);
    expect(counts.contacted).toBe(1);
    expect(counts.quoted).toBe(1);
    expect(counts.booked).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.passed).toBe(1);
  });

  it("counts secured as booked plus completed", () => {
    const counts = vendorCounts([
      vendor({ status: "booked" }),
      vendor({ status: "completed" }),
      vendor({ status: "quoted" }),
    ]);
    expect(counts.secured).toBe(2);
  });

  it("excludes passed from pending, so the card cannot only grow", () => {
    const counts = vendorCounts([
      vendor({ status: "researching" }),
      vendor({ status: "contacted" }),
      vendor({ status: "quoted" }),
      vendor({ status: "passed" }),
      vendor({ status: "passed" }),
    ]);
    expect(counts.pending).toBe(3);
    expect(counts.passed).toBe(2);
  });

  it("keeps an unknown status out of every bucket but still in the total", () => {
    const counts = vendorCounts([
      vendor({ status: "archived" as unknown as VendorStatus }),
      vendor({ status: "booked" }),
    ]);
    expect(counts.total).toBe(2);
    expect(counts.booked).toBe(1);
    expect(
      counts.researching + counts.contacted + counts.quoted + counts.booked + counts.completed + counts.passed,
    ).toBe(1);
  });
});

describe("contractsOutstanding", () => {
  it("is booked with nothing signed", () => {
    const chase = vendor({ status: "booked", contract_signed_at: null });
    expect(isContractOutstanding(chase)).toBe(true);
  });

  it("excludes a booked vendor whose contract is on file", () => {
    expect(isContractOutstanding(vendor({ status: "booked", contract_signed_at: "2026-07-01" }))).toBe(
      false,
    );
  });

  it("excludes completed vendors — chasing a signature for a finished job is noise", () => {
    expect(isContractOutstanding(vendor({ status: "completed", contract_signed_at: null }))).toBe(false);
  });

  it("excludes vendors that are not booked yet", () => {
    for (const status of ["researching", "contacted", "quoted", "passed"] as const) {
      expect(isContractOutstanding(vendor({ status, contract_signed_at: null }))).toBe(false);
    }
  });

  it("returns the rows behind the number, and the count matches vendorCounts", () => {
    const rows = [
      vendor({ id: "a", status: "booked", contract_signed_at: null }),
      vendor({ id: "b", status: "booked", contract_signed_at: "2026-06-01" }),
      vendor({ id: "c", status: "booked", contract_signed_at: null }),
      vendor({ id: "d", status: "completed", contract_signed_at: null }),
    ];
    expect(contractsOutstanding(rows).map((v) => v.id)).toEqual(["a", "c"]);
    expect(vendorCounts(rows).contractsOutstanding).toBe(2);
    expect(vendorCounts(rows).contractsSigned).toBe(1);
  });
});

describe("vendorContractedCents", () => {
  it("sums contract prices for booked and completed vendors only", () => {
    const total = vendorContractedCents([
      vendor({ status: "booked", contracted_cents: 500_000 }),
      vendor({ status: "completed", contracted_cents: 250_000 }),
      vendor({ status: "quoted", contracted_cents: 900_000 }),
      vendor({ status: "passed", contracted_cents: 100_000 }),
    ]);
    expect(total).toBe(750_000);
  });

  it("treats a booked vendor with no price as zero, not as a gap", () => {
    expect(
      vendorContractedCents([
        vendor({ status: "booked", contracted_cents: null }),
        vendor({ status: "booked", contracted_cents: 1_000 }),
      ]),
    ).toBe(1_000);
  });

  it("is zero for an empty list", () => {
    expect(vendorContractedCents([])).toBe(0);
  });
});

describe("effectivePrice", () => {
  it("prefers the contract price and says so", () => {
    expect(
      effectivePrice(vendor({ contracted_cents: 300_000, quoted_cents: 250_000, estimated_cents: 100_000 })),
    ).toEqual({ cents: 300_000, stage: "contracted" });
  });

  it("falls back to the quote and marks it as a quote", () => {
    expect(effectivePrice(vendor({ contracted_cents: null, quoted_cents: 250_000 }))).toEqual({
      cents: 250_000,
      stage: "quoted",
    });
  });

  it("falls back to the estimate last", () => {
    expect(
      effectivePrice(vendor({ contracted_cents: null, quoted_cents: null, estimated_cents: 90_000 })),
    ).toEqual({ cents: 90_000, stage: "estimated" });
  });

  it("returns null rather than zero when nothing is priced", () => {
    expect(effectivePrice(vendor())).toEqual({ cents: null, stage: null });
  });

  it("keeps a genuine zero, which is a real answer", () => {
    expect(effectivePrice(vendor({ contracted_cents: 0 }))).toEqual({ cents: 0, stage: "contracted" });
  });
});

/* --------------------------------------------------------------- team roles */

describe("DEFAULT_VENDOR_ROLES", () => {
  it("has nineteen roles, ten of them essential", () => {
    expect(DEFAULT_VENDOR_ROLES).toHaveLength(19);
    expect(DEFAULT_VENDOR_ROLES.filter((r) => r.essential)).toHaveLength(10);
  });

  it("lists the essential roles first, so the strip can slice rather than filter", () => {
    const firstOptional = DEFAULT_VENDOR_ROLES.findIndex((r) => !r.essential);
    expect(firstOptional).toBe(10);
    expect(DEFAULT_VENDOR_ROLES.slice(10).every((r) => !r.essential)).toBe(true);
  });

  it("has no duplicate role names, case-insensitively", () => {
    const keys = DEFAULT_VENDOR_ROLES.map((r) => r.name.trim().toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps every role onto one of the couple's own budget categories", () => {
    const categories = new Set([
      "Venue",
      "Food and Beverage",
      "Music + Photography",
      "Attire + Beauty",
      "Flowers + Decor",
      "Printing",
      "Gifts",
      "Hotels",
      "Misc",
      "Flights",
      "Contingency",
    ]);
    for (const role of DEFAULT_VENDOR_ROLES) {
      expect(categories.has(role.budgetCategory), `${role.name} -> ${role.budgetCategory}`).toBe(true);
    }
  });

  it("exposes the names separately for callers that want plain strings", () => {
    expect(DEFAULT_VENDOR_ROLE_NAMES).toEqual(DEFAULT_VENDOR_ROLES.map((r) => r.name));
    expect(DEFAULT_VENDOR_ROLE_NAMES).toContain("Venue");
    expect(DEFAULT_VENDOR_ROLE_NAMES).toContain("Hotel block");
  });
});

describe("teamRoles", () => {
  it("returns every suggested role as an empty slot when there are no vendors", () => {
    const roles = teamRoles([]);
    expect(roles).toHaveLength(19);
    expect(roles.every((r) => r.state === "empty")).toBe(true);
    expect(roles.every((r) => r.filled === false)).toBe(true);
    expect(roles[0].role).toBe("Venue");
  });

  it("keeps the suggested order rather than sorting alphabetically", () => {
    const roles = teamRoles([], ["Venue", "Catering", "DJ"]);
    expect(roles.map((r) => r.role)).toEqual(["Venue", "Catering", "DJ"]);
  });

  it("marks a role filled when a vendor in it is booked", () => {
    const roles = teamRoles([vendor({ role: "DJ", name: "Sonido Rosa", status: "booked" })]);
    const dj = roles.find((r) => r.role === "DJ")!;
    expect(dj.filled).toBe(true);
    expect(dj.state).toBe("filled");
    expect(dj.bookedVendorName).toBe("Sonido Rosa");
  });

  it("marks a role filled when a vendor in it is completed", () => {
    const roles = teamRoles([vendor({ role: "DJ", name: "Sonido Rosa", status: "completed" })]);
    expect(roles.find((r) => r.role === "DJ")!.filled).toBe(true);
  });

  it("reads deciding when there are candidates but nobody booked", () => {
    const roles = teamRoles([
      vendor({ role: "Photographer", status: "quoted" }),
      vendor({ role: "Photographer", status: "contacted" }),
    ]);
    const photo = roles.find((r) => r.role === "Photographer")!;
    expect(photo.state).toBe("deciding");
    expect(photo.candidateCount).toBe(2);
    expect(photo.bookedVendorName).toBeNull();
  });

  it("reports the furthest-along status in the role", () => {
    const roles = teamRoles([
      vendor({ role: "Florist & Decor", status: "researching" }),
      vendor({ role: "Florist & Decor", status: "quoted" }),
      vendor({ role: "Florist & Decor", status: "contacted" }),
    ]);
    expect(roles.find((r) => r.role === "Florist & Decor")!.status).toBe("quoted");
  });

  it("prefers completed over booked when naming the vendor in a filled role", () => {
    const roles = teamRoles([
      vendor({ role: "Catering", name: "Booked Co", status: "booked" }),
      vendor({ role: "Catering", name: "Finished Co", status: "completed" }),
    ]);
    const catering = roles.find((r) => r.role === "Catering")!;
    expect(catering.bookedVendorName).toBe("Finished Co");
    expect(catering.status).toBe("completed");
  });

  it("never lets a passed vendor fill a role", () => {
    const roles = teamRoles([vendor({ role: "Videographer", status: "passed" })]);
    const video = roles.find((r) => r.role === "Videographer")!;
    expect(video.filled).toBe(false);
    expect(video.state).toBe("empty");
    expect(video.candidateCount).toBe(0);
    expect(video.status).toBeNull();
  });

  it("keeps passed vendors visible as a count rather than dropping them", () => {
    const roles = teamRoles([
      vendor({ role: "Videographer", status: "passed" }),
      vendor({ role: "Videographer", status: "passed" }),
    ]);
    expect(roles.find((r) => r.role === "Videographer")!.passedCount).toBe(2);
  });

  it("counts only candidates, so candidateCount matches vendorIds", () => {
    const roles = teamRoles([
      vendor({ role: "DJ", status: "quoted" }),
      vendor({ role: "DJ", status: "passed" }),
    ]);
    const dj = roles.find((r) => r.role === "DJ")!;
    expect(dj.candidateCount).toBe(1);
    expect(dj.vendorIds).toHaveLength(1);
    expect(dj.passedCount).toBe(1);
  });

  it("orders vendorIds so the row needing a decision comes first", () => {
    const roles = teamRoles([
      vendor({ id: "booked", role: "DJ", status: "booked" }),
      vendor({ id: "quoted", role: "DJ", status: "quoted" }),
    ]);
    expect(roles.find((r) => r.role === "DJ")!.vendorIds).toEqual(["quoted", "booked"]);
  });

  it("matches roles case-insensitively and trimmed", () => {
    const roles = teamRoles([
      vendor({ role: "  photographer ", status: "booked", name: "Estudio Luz" }),
      vendor({ role: "PHOTOGRAPHER", status: "quoted" }),
    ]);
    const photo = roles.filter((r) => r.role.toLowerCase().trim() === "photographer");
    expect(photo).toHaveLength(1);
    expect(photo[0].candidateCount).toBe(2);
    expect(photo[0].bookedVendorName).toBe("Estudio Luz");
  });

  it("uses the vendor's own casing when one exists", () => {
    const roles = teamRoles([vendor({ role: "photographer", status: "quoted" })]);
    expect(roles.map((r) => r.role)).toContain("photographer");
    expect(roles.map((r) => r.role)).not.toContain("Photographer");
  });

  it("uses the suggested casing when the role is unused", () => {
    expect(teamRoles([]).map((r) => r.role)).toContain("Photographer");
  });

  it("lets the first vendor set the casing, so the tile does not rename itself", () => {
    const roles = teamRoles([
      vendor({ role: "photographer", status: "quoted" }),
      vendor({ role: "PhotoGrapher", status: "contacted" }),
    ]);
    expect(roles.filter((r) => r.role === "photographer")).toHaveLength(1);
  });

  it("adds a role Juliet invents, after the suggested ones", () => {
    const roles = teamRoles([vendor({ role: "Calligrapher", status: "contacted" })]);
    expect(roles).toHaveLength(20);
    expect(roles[roles.length - 1].role).toBe("Calligrapher");
    expect(roles[roles.length - 1].suggested).toBe(false);
  });

  it("sorts invented roles alphabetically among themselves", () => {
    const roles = teamRoles([
      vendor({ role: "Calligrapher", status: "contacted" }),
      vendor({ role: "Alpaca handler", status: "contacted" }),
    ]);
    const invented = roles.filter((r) => !r.suggested).map((r) => r.role);
    expect(invented).toEqual(["Alpaca handler", "Calligrapher"]);
  });

  it("carries essential and budgetCategory through for suggested roles", () => {
    const roles = teamRoles([]);
    const venue = roles.find((r) => r.role === "Venue")!;
    expect(venue.essential).toBe(true);
    expect(venue.budgetCategory).toBe("Venue");
    const hotel = roles.find((r) => r.role === "Hotel block")!;
    expect(hotel.essential).toBe(false);
    expect(hotel.budgetCategory).toBe("Hotels");
  });

  it("leaves an invented role without a budget-category hint rather than guessing", () => {
    const roles = teamRoles([vendor({ role: "Calligrapher" })]);
    const calligrapher = roles.find((r) => r.role === "Calligrapher")!;
    expect(calligrapher.budgetCategory).toBeNull();
    expect(calligrapher.essential).toBe(false);
  });

  it("buckets a vendor with no role into Other, and only then", () => {
    expect(teamRoles([]).map((r) => r.role)).not.toContain("Other");
    const roles = teamRoles([vendor({ role: null, name: "Nameless job", status: "booked" })]);
    const other = roles.find((r) => r.role === "Other")!;
    expect(other.filled).toBe(true);
    expect(other.bookedVendorName).toBe("Nameless job");
  });

  it("treats a whitespace-only role the same as no role", () => {
    const roles = teamRoles([vendor({ role: "   ", status: "quoted" })]);
    expect(roles.find((r) => r.role === "Other")!.candidateCount).toBe(1);
  });

  it("accepts a caller-supplied suggestion list", () => {
    const roles = teamRoles([vendor({ role: "DJ", status: "booked" })], ["DJ", "Taco cart"]);
    expect(roles.map((r) => r.role)).toEqual(["DJ", "Taco cart"]);
    expect(roles[1].state).toBe("empty");
  });

  it("ignores blank entries in a caller-supplied suggestion list", () => {
    expect(teamRoles([], ["Venue", "  ", ""]).map((r) => r.role)).toEqual(["Venue"]);
  });

  it("does not mutate the vendors it is given", () => {
    const rows = [vendor({ role: "DJ", status: "booked" })];
    const snapshot = JSON.parse(JSON.stringify(rows));
    teamRoles(rows);
    expect(rows).toEqual(snapshot);
  });
});

describe("teamRollup", () => {
  it("names the roles still to fill, not just how many", () => {
    const rollup = teamRollup([vendor({ role: "Venue", status: "booked" })], [
      "Venue",
      "Catering",
      "DJ",
    ]);
    expect(rollup.filled).toBe(1);
    expect(rollup.total).toBe(3);
    expect(rollup.unfilled).toEqual(["Catering", "DJ"]);
  });

  it("separates the essential unfilled roles from the optional ones", () => {
    const rollup = teamRollup([]);
    expect(rollup.unfilledEssential).toHaveLength(10);
    expect(rollup.unfilledEssential[0]).toBe("Venue");
    expect(rollup.unfilled).toHaveLength(19);
  });

  it("drops a role out of unfilled the instant a vendor in it is booked", () => {
    const before = teamRollup([vendor({ role: "DJ", status: "quoted" })]);
    const after = teamRollup([vendor({ role: "DJ", status: "booked" })]);
    expect(before.unfilled).toContain("DJ");
    expect(after.unfilled).not.toContain("DJ");
  });

  it("keeps a role in unfilled when its only vendor was passed on", () => {
    const rollup = teamRollup([vendor({ role: "DJ", status: "passed" })]);
    expect(rollup.unfilled).toContain("DJ");
    expect(rollup.empty).toBe(19);
    expect(rollup.deciding).toBe(0);
  });

  it("splits the slots into filled, deciding and empty", () => {
    const rollup = teamRollup(
      [vendor({ role: "Venue", status: "booked" }), vendor({ role: "Catering", status: "quoted" })],
      ["Venue", "Catering", "DJ"],
    );
    expect([rollup.filled, rollup.deciding, rollup.empty]).toEqual([1, 1, 1]);
  });

  it("writes the one count line both the list and the strip render", () => {
    expect(teamRollup([vendor({ role: "Venue", status: "booked" })]).label).toBe(
      "1 of 19 roles filled",
    );
  });

  it("reports a fill fraction, and never NaN when there are no roles", () => {
    expect(teamRollup([vendor({ role: "Venue", status: "booked" })], ["Venue", "DJ"]).fillFraction).toBe(
      0.5,
    );
    expect(teamRollup([], []).fillFraction).toBe(0);
    expect(teamRollup([], []).label).toBe("0 of 0 roles filled");
  });

  it("counts an invented role in the denominator", () => {
    const rollup = teamRollup([vendor({ role: "Calligrapher", status: "quoted" })]);
    expect(rollup.total).toBe(20);
    expect(rollup.unfilled).toContain("Calligrapher");
  });
});

/* ------------------------------------------------------------------- search */

describe("matchesVendorQuery", () => {
  const row = vendor({
    name: "Estudio Luz",
    role: "Photographer",
    contact_name: "Ana Ruiz",
    company: "Luz SA de CV",
    email: "ana@estudioluz.mx",
    phone: "+52 (33) 1234-5678",
    notes: "Recommended by Alison",
  });

  it("matches everything on a blank query", () => {
    expect(matchesVendorQuery("", row)).toBe(true);
    expect(matchesVendorQuery("   ", row)).toBe(true);
  });

  it("matches the name case-insensitively", () => {
    expect(matchesVendorQuery("estudio", row)).toBe(true);
  });

  it("matches the role, so typing a role finds its vendors", () => {
    expect(matchesVendorQuery("photog", row)).toBe(true);
  });

  it("matches the contact, company, email and notes", () => {
    expect(matchesVendorQuery("ruiz", row)).toBe(true);
    expect(matchesVendorQuery("de cv", row)).toBe(true);
    expect(matchesVendorQuery("estudioluz.mx", row)).toBe(true);
    expect(matchesVendorQuery("recommended", row)).toBe(true);
  });

  it("matches a phone number typed without its punctuation", () => {
    expect(matchesVendorQuery("12345678", row)).toBe(true);
  });

  it("folds accents, so Sanchez finds Sánchez", () => {
    expect(matchesVendorQuery("sanchez", vendor({ name: "Flores Sánchez" }))).toBe(true);
  });

  it("narrows on a second word rather than widening", () => {
    expect(matchesVendorQuery("estudio ruiz", row)).toBe(true);
    expect(matchesVendorQuery("estudio mariachi", row)).toBe(false);
  });

  it("does not match text that is nowhere in the row", () => {
    expect(matchesVendorQuery("taco", row)).toBe(false);
  });

  it("searches precomputed text the shell hands it", () => {
    expect(matchesVendorQuery("guadalajara", vendor({ searchText: "Av. Chapultepec, Guadalajara" }))).toBe(
      true,
    );
  });

  it("copes with a row that has none of the optional fields", () => {
    expect(matchesVendorQuery("vendor", vendor({ role: null }))).toBe(true);
  });
});

describe("filterVendors", () => {
  const rows = [
    vendor({ id: "a", name: "Estudio Luz", role: "Photographer", status: "quoted" }),
    vendor({ id: "b", name: "Sonido Rosa", role: "DJ", status: "booked", contract_signed_at: null }),
    vendor({ id: "c", name: "Flores Sol", role: "Florist & Decor", status: "passed" }),
    vendor({ id: "d", name: "Hacienda", role: "Venue", status: "booked", contract_signed_at: "2026-06-01" }),
  ];

  it("returns everything with no filter at all", () => {
    expect(filterVendors(rows)).toHaveLength(4);
    expect(filterVendors(rows, {})).toHaveLength(4);
  });

  it("treats 'all' as no filter", () => {
    expect(filterVendors(rows, { status: "all", role: "all" })).toHaveLength(4);
  });

  it("filters by status", () => {
    expect(filterVendors(rows, { status: "booked" }).map((v) => v.id)).toEqual(["b", "d"]);
  });

  it("filters by role, case-insensitively", () => {
    expect(filterVendors(rows, { role: "dj" }).map((v) => v.id)).toEqual(["b"]);
  });

  it("filters vendors with no role under Other", () => {
    const withNull = [...rows, vendor({ id: "e", role: null })];
    expect(filterVendors(withNull, { role: "Other" }).map((v) => v.id)).toEqual(["e"]);
  });

  it("filters by search text", () => {
    expect(filterVendors(rows, { q: "sol" }).map((v) => v.id)).toEqual(["c"]);
  });

  it("combines status and search", () => {
    expect(filterVendors(rows, { status: "booked", q: "hacienda" }).map((v) => v.id)).toEqual(["d"]);
  });

  it("unsignedOnly returns exactly the contracts-outstanding set", () => {
    expect(filterVendors(rows, { unsignedOnly: true })).toEqual(contractsOutstanding(rows));
  });

  it("ignores unsignedOnly when it is false", () => {
    expect(filterVendors(rows, { unsignedOnly: false })).toHaveLength(4);
  });

  it("returns an empty array rather than throwing when nothing matches", () => {
    expect(filterVendors(rows, { status: "completed" })).toEqual([]);
  });

  it("does not mutate the array it is given", () => {
    const copy = [...rows];
    filterVendors(rows, { status: "booked" });
    expect(rows).toEqual(copy);
  });
});

describe("sortVendors", () => {
  it("sorts by name, case-insensitively", () => {
    const rows = [vendor({ name: "zamora" }), vendor({ name: "Alba" }), vendor({ name: "Mireles" })];
    expect(sortVendors(rows, "name").map((v) => v.name)).toEqual(["Alba", "Mireles", "zamora"]);
  });

  it("sinks passed vendors to the bottom when sorting by name", () => {
    const rows = [
      vendor({ name: "Alba", status: "passed" }),
      vendor({ name: "Zamora", status: "quoted" }),
    ];
    expect(sortVendors(rows, "name").map((v) => v.name)).toEqual(["Zamora", "Alba"]);
  });

  it("sorts by price descending, using the effective price", () => {
    const rows = [
      vendor({ name: "Cheap", quoted_cents: 100 }),
      vendor({ name: "Dear", contracted_cents: 900 }),
      vendor({ name: "Middle", quoted_cents: 500 }),
    ];
    expect(sortVendors(rows, "cost_desc").map((v) => v.name)).toEqual(["Dear", "Middle", "Cheap"]);
  });

  it("puts unpriced vendors last rather than treating them as free", () => {
    const rows = [vendor({ name: "Unpriced" }), vendor({ name: "Priced", quoted_cents: 1 })];
    expect(sortVendors(rows, "cost_desc").map((v) => v.name)).toEqual(["Priced", "Unpriced"]);
  });

  it("sinks passed vendors below priced ones when sorting by price", () => {
    const rows = [
      vendor({ name: "Passed but dear", status: "passed", contracted_cents: 999_999 }),
      vendor({ name: "Live and cheap", status: "quoted", contracted_cents: 1 }),
    ];
    expect(sortVendors(rows, "cost_desc")[0].name).toBe("Live and cheap");
  });

  it("sorts by status so the ones needing a decision float up", () => {
    const rows = [
      vendor({ name: "D", status: "completed" }),
      vendor({ name: "A", status: "quoted" }),
      vendor({ name: "C", status: "booked" }),
      vendor({ name: "B", status: "contacted" }),
      vendor({ name: "E", status: "passed" }),
    ];
    expect(sortVendors(rows, "status").map((v) => v.name)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("sorts by role in the suggested order, not alphabetically", () => {
    const rows = [
      vendor({ name: "DJ pick", role: "DJ" }),
      vendor({ name: "Venue pick", role: "Venue" }),
      vendor({ name: "Catering pick", role: "Catering" }),
    ];
    expect(sortVendors(rows, "role").map((v) => v.name)).toEqual([
      "Venue pick",
      "Catering pick",
      "DJ pick",
    ]);
  });

  it("puts invented roles after every suggested one, alphabetically", () => {
    const rows = [
      vendor({ name: "Zebra wrangler", role: "Zebra wrangler" }),
      vendor({ name: "Calligrapher", role: "Calligrapher" }),
      vendor({ name: "Venue pick", role: "Venue" }),
    ];
    expect(sortVendors(rows, "role").map((v) => v.name)).toEqual([
      "Venue pick",
      "Calligrapher",
      "Zebra wrangler",
    ]);
  });

  it("orders within a role by attention, sinking passed", () => {
    const rows = [
      vendor({ name: "Passed one", role: "DJ", status: "passed" }),
      vendor({ name: "Booked one", role: "DJ", status: "booked" }),
      vendor({ name: "Quoted one", role: "DJ", status: "quoted" }),
    ];
    expect(sortVendors(rows, "role").map((v) => v.name)).toEqual([
      "Quoted one",
      "Booked one",
      "Passed one",
    ]);
  });

  it("is stable and total: equal names fall back to sort_order then id", () => {
    const rows = [
      vendor({ id: "z", name: "Same", sort_order: 2 }),
      vendor({ id: "a", name: "Same", sort_order: 1 }),
      vendor({ id: "b", name: "Same", sort_order: 1 }),
    ];
    expect(sortVendors(rows, "name").map((v) => v.id)).toEqual(["a", "b", "z"]);
  });

  it("never mutates the caller's array", () => {
    const rows = [vendor({ name: "B" }), vendor({ name: "A" })];
    const order = rows.map((v) => v.name);
    sortVendors(rows, "name");
    expect(rows.map((v) => v.name)).toEqual(order);
  });

  it("returns an empty array unchanged", () => {
    expect(sortVendors([], "role")).toEqual([]);
  });
});

/* ---------------------------------------------------------------- sync plan */

describe("syncPlan", () => {
  it("fills a budget line that has no contract price yet", () => {
    const plan = syncPlan(500_000, [item({ contracted_cents: null })], null);
    expect(plan.skipped).toBeNull();
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].kind).toBe("filled");
    expect(plan.changes[0].fromCents).toBeNull();
    expect(plan.changes[0].toCents).toBe(500_000);
    expect(plan.writes).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.requiresConfirm).toBe(false);
  });

  it("resyncs upward when the budget still holds the vendor's previous price", () => {
    const plan = syncPlan(600_000, [item({ contracted_cents: 500_000 })], 500_000);
    expect(plan.changes[0].kind).toBe("resynced");
    expect(plan.changes[0].fromCents).toBe(500_000);
    expect(plan.changes[0].toCents).toBe(600_000);
    expect(plan.changes[0].previousCents).toBe(500_000);
    expect(plan.writes).toHaveLength(1);
    expect(plan.requiresConfirm).toBe(false);
  });

  it("resyncs downward too — a renegotiated price is not a special case", () => {
    const plan = syncPlan(400_000, [item({ contracted_cents: 500_000 })], 500_000);
    expect(plan.changes[0].kind).toBe("resynced");
    expect(plan.changes[0].toCents).toBe(400_000);
    expect(plan.writes).toHaveLength(1);
  });

  it("resyncs when the column says this app wrote the number last", () => {
    const plan = syncPlan(600_000, [item({ contracted_cents: 500_000, contracted_source: "vendor" })]);
    expect(plan.changes[0].kind).toBe("resynced");
    expect(plan.writes).toHaveLength(1);
  });

  it("writes nothing when the budget already says exactly this", () => {
    const plan = syncPlan(500_000, [item({ contracted_cents: 500_000 })], 400_000);
    expect(plan.changes[0].kind).toBe("unchanged");
    expect(plan.writes).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.requiresConfirm).toBe(false);
  });

  it("calls a conflict when a human typed a different number on the budget side", () => {
    const plan = syncPlan(540_000, [item({ contracted_cents: 480_000 })], 500_000);
    expect(plan.changes[0].kind).toBe("conflict");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.writes).toHaveLength(0);
    expect(plan.requiresConfirm).toBe(true);
  });

  it("puts both numbers in the conflict so the UI can show them side by side", () => {
    const conflict = syncPlan(540_000, [item({ name: "Photography", contracted_cents: 480_000 })], 500_000)
      .conflicts[0];
    expect(conflict).toMatchObject({
      itemId: "bi-1",
      itemName: "Photography",
      fromCents: 480_000,
      toCents: 540_000,
      previousCents: 500_000,
      kind: "conflict",
    });
    expect(conflict.reason.length).toBeGreaterThan(0);
  });

  it("conflicts when the column says a human typed it, even without a previous price", () => {
    const plan = syncPlan(540_000, [item({ contracted_cents: 480_000, contracted_source: "manual" })]);
    expect(plan.changes[0].kind).toBe("conflict");
    expect(plan.writes).toHaveLength(0);
  });

  it("fails safe: unknown provenance and no previous price is a conflict, not a write", () => {
    const plan = syncPlan(540_000, [item({ contracted_cents: 480_000 })]);
    expect(plan.changes[0].kind).toBe("conflict");
    expect(plan.requiresConfirm).toBe(true);
  });

  it("still prefers the previous-price match over a manual source flag", () => {
    const plan = syncPlan(
      600_000,
      [item({ contracted_cents: 500_000, contracted_source: "manual" })],
      500_000,
    );
    expect(plan.changes[0].kind).toBe("resynced");
  });

  it("never blanks a budget line when the vendor's price is cleared", () => {
    const plan = syncPlan(null, [item({ contracted_cents: 500_000 })], 500_000);
    expect(plan.skipped).toBe("no_price");
    expect(plan.changes).toEqual([]);
    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.requiresConfirm).toBe(false);
  });

  it("reports no linked items rather than pretending there is nothing to do", () => {
    const plan = syncPlan(500_000, []);
    expect(plan.skipped).toBe("no_linked_items");
    expect(plan.writes).toEqual([]);
  });

  it("refuses to guess which of two linked lines she meant", () => {
    const plan = syncPlan(500_000, [
      item({ id: "bi-1", name: "Photography", contracted_cents: null }),
      item({ id: "bi-2", name: "Second shooter", contracted_cents: null }),
    ]);
    expect(plan.skipped).toBe("ambiguous_link");
    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.requiresConfirm).toBe(false);
  });

  it("still names both lines when the link is ambiguous, so the UI can say which", () => {
    const plan = syncPlan(500_000, [
      item({ id: "bi-1", name: "Photography", contracted_cents: null }),
      item({ id: "bi-2", name: "Second shooter", contracted_cents: 480_000 }),
    ]);
    expect(plan.changes.map((c) => c.itemName)).toEqual(["Photography", "Second shooter"]);
  });

  it("keeps writes empty whenever a skip reason is set", () => {
    const plans = [
      syncPlan(null, [item({ contracted_cents: null })]),
      syncPlan(500_000, []),
      syncPlan(500_000, [item({ id: "a" }), item({ id: "b" })]),
    ];
    for (const plan of plans) {
      expect(plan.skipped).not.toBeNull();
      expect(plan.writes).toEqual([]);
      expect(plan.conflicts).toEqual([]);
    }
  });

  it("treats a zero contract price as a real number, not as cleared", () => {
    const plan = syncPlan(0, [item({ contracted_cents: null })], null);
    expect(plan.skipped).toBeNull();
    expect(plan.changes[0].kind).toBe("filled");
    expect(plan.changes[0].toCents).toBe(0);
  });

  it("treats a budget line of zero as typed, not as empty", () => {
    const plan = syncPlan(500_000, [item({ contracted_cents: 0 })], null);
    expect(plan.changes[0].kind).toBe("conflict");
  });

  it("classifies every item exactly once", () => {
    const plan = syncPlan(500_000, [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })]);
    expect(plan.changes.map((c) => c.itemId)).toEqual(["a", "b", "c"]);
  });

  it("goes one direction only — no field of the plan describes a vendor write", () => {
    const plan = syncPlan(540_000, [item({ contracted_cents: 480_000 })], 500_000);
    expect(Object.keys(plan).sort()).toEqual([
      "changes",
      "conflicts",
      "requiresConfirm",
      "skipped",
      "writes",
    ]);
    expect(Object.keys(plan.changes[0]).sort()).toEqual([
      "fromCents",
      "itemId",
      "itemName",
      "kind",
      "previousCents",
      "reason",
      "toCents",
    ]);
  });

  it("never returns the same change in both writes and conflicts", () => {
    const plan = syncPlan(540_000, [item({ contracted_cents: 480_000 })], 500_000);
    for (const write of plan.writes) {
      expect(plan.conflicts).not.toContain(write);
    }
    expect(plan.writes.length + plan.conflicts.length).toBeLessThanOrEqual(plan.changes.length);
  });

  it("does not mutate the items it is given", () => {
    const items = [item({ contracted_cents: 480_000 })];
    const snapshot = JSON.parse(JSON.stringify(items));
    syncPlan(540_000, items, 500_000);
    expect(items).toEqual(snapshot);
  });
});

/* --------------------------------------------------------------- validation */

describe("validateVendor", () => {
  it("accepts a vendor with only a name", () => {
    const result = validateVendor({ name: "Estudio Luz" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Estudio Luz");
      expect(result.value.status).toBe("researching");
      expect(result.value.role).toBeNull();
      expect(result.warnings).toEqual([]);
    }
  });

  it("requires a name", () => {
    const result = validateVendor({ name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: "name", message: "Give this vendor a name." }]);
    }
  });

  it("trims the name and blanks empty optional text to null", () => {
    const result = validateVendor({ name: "  Sonido Rosa  ", role: "  ", email: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Sonido Rosa");
      expect(result.value.role).toBeNull();
      expect(result.value.email).toBeNull();
    }
  });

  it("rejects an email with no @", () => {
    const result = validateVendor({ name: "A", email: "ana.estudioluz.mx" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toEqual({
        field: "email",
        message: "That email address looks incomplete.",
      });
    }
  });

  it("accepts an email with an @", () => {
    const result = validateVendor({ name: "A", email: " ana@estudioluz.mx " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe("ana@estudioluz.mx");
  });

  it("rejects a status that is not one of the six", () => {
    const result = validateVendor({ name: "A", status: "archived" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].field).toBe("status");
  });

  it("keeps a valid status", () => {
    const result = validateVendor({ name: "A", status: "booked", contracted_cents: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("booked");
  });

  it("rejects a negative price on either column", () => {
    const result = validateVendor({ name: "A", quoted_cents: -1, contracted_cents: -2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field)).toEqual(["quoted_cents", "contracted_cents"]);
    }
  });

  it("collects every error rather than stopping at the first", () => {
    const result = validateVendor({ name: "", email: "nope", status: "archived" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(3);
  });

  it("warns, but still saves, when a booked vendor has no contract price", () => {
    const result = validateVendor({ name: "A", status: "booked" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([
        {
          field: "contracted_cents",
          message: "Booked with no contracted price — the budget total won't include this yet.",
        },
      ]);
    }
  });

  it("does not warn about a missing price before the vendor is booked", () => {
    const result = validateVendor({ name: "A", status: "quoted" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("warns, but still saves, when the contract is more than triple the quote", () => {
    const result = validateVendor({ name: "A", quoted_cents: 100_000, contracted_cents: 400_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].field).toBe("contracted_cents");
    }
  });

  it("does not warn at exactly triple the quote", () => {
    const result = validateVendor({ name: "A", quoted_cents: 100_000, contracted_cents: 300_000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("does not divide by a zero quote", () => {
    const result = validateVendor({ name: "A", quoted_cents: 0, contracted_cents: 400_000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("cannot fire both warnings at once — one needs a price, the other needs none", () => {
    const noPrice = validateVendor({ name: "A", status: "booked", quoted_cents: 1 });
    const priced = validateVendor({ name: "A", status: "booked", quoted_cents: 1, contracted_cents: 400 });
    expect(noPrice.ok && noPrice.warnings.map((w) => w.message)).toEqual([
      "Booked with no contracted price — the budget total won't include this yet.",
    ]);
    expect(priced.ok && priced.warnings).toHaveLength(1);
    expect(priced.ok && priced.warnings[0].message).toContain("three times the quote");
  });

  it("returns no value on the error branch, matching validateEvent's shape", () => {
    const result = validateVendor({ name: "" });
    expect(result.ok).toBe(false);
    expect("value" in result).toBe(false);
  });
});
