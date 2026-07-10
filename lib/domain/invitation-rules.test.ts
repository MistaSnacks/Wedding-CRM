import { describe, it, expect } from "vitest";
import {
  validateSubmission,
  computeHouseholdStatus,
  dedupePlusOnes,
  openPlusOneSlots,
  normalizeHouseholdRules,
  type HouseholdRules,
  type KnownGuest,
  type SubmissionGuest,
  type NamedKnownGuest,
} from "./invitation-rules";

const namedOnly: HouseholdRules = { maxPartySize: 2, plusOneSlots: 0 };
const plusOne: HouseholdRules = { maxPartySize: 2, plusOneSlots: 1 };
const family: HouseholdRules = { maxPartySize: 4, plusOneSlots: 0 };

const couple: KnownGuest[] = [
  { id: "g1", origin: "named" },
  { id: "g2", origin: "named" },
];
const single: KnownGuest[] = [{ id: "g1", origin: "named" }];

const g = (guestId: string): SubmissionGuest => ({ guestId });
const p1 = (firstName = "Alex", lastName = "Rivera"): SubmissionGuest => ({
  newPlusOne: { firstName, lastName },
});

describe("validateSubmission", () => {
  it("accepts named guests within party size", () => {
    expect(validateSubmission(namedOnly, couple, [g("g1"), g("g2")])).toEqual({ ok: true });
  });

  it("rejects a plus one when no slots exist", () => {
    const r = validateSubmission(namedOnly, couple, [g("g1"), p1()]);
    expect(r).toEqual({ ok: false, code: "no_plus_one_slot" });
  });

  it("accepts exactly plusOneSlots new names", () => {
    expect(validateSubmission(plusOne, single, [g("g1"), p1()])).toEqual({ ok: true });
  });

  it("rejects slots+1 new names", () => {
    const rules: HouseholdRules = { maxPartySize: 3, plusOneSlots: 1 };
    const r = validateSubmission(rules, single, [g("g1"), p1(), p1("Sam", "Lee")]);
    expect(r).toEqual({ ok: false, code: "no_plus_one_slot" });
  });

  it("counts EXISTING plus_one guests against the slots", () => {
    const known: KnownGuest[] = [
      { id: "g1", origin: "named" },
      { id: "px", origin: "plus_one" },
    ];
    const r = validateSubmission(plusOne, known, [g("g1"), g("px"), p1()]);
    expect(r).toEqual({ ok: false, code: "no_plus_one_slot" });
  });

  it("rejects unknown guest ids", () => {
    const r = validateSubmission(family, couple, [g("g1"), g("intruder")]);
    expect(r).toEqual({ ok: false, code: "unknown_guest" });
  });

  it("rejects submissions over max party size", () => {
    const known: KnownGuest[] = [
      { id: "g1", origin: "named" },
      { id: "g2", origin: "named" },
      { id: "g3", origin: "named" },
    ];
    const rules: HouseholdRules = { maxPartySize: 2, plusOneSlots: 0 };
    const r = validateSubmission(rules, known, [g("g1"), g("g2"), g("g3")]);
    expect(r).toEqual({ ok: false, code: "over_party_size" });
  });

  it("rejects empty or whitespace plus-one names", () => {
    const r = validateSubmission(plusOne, single, [g("g1"), p1("  ", "Doe")]);
    expect(r).toEqual({ ok: false, code: "empty_name" });
  });

  it("rejects the same guest submitted twice", () => {
    const r = validateSubmission(family, couple, [g("g1"), g("g1")]);
    expect(r).toEqual({ ok: false, code: "duplicate_guest" });
  });

  it("family invitation: all four named guests accepted, no plus one", () => {
    const known: KnownGuest[] = ["a", "b", "c", "d"].map((id) => ({ id, origin: "named" as const }));
    expect(validateSubmission(family, known, known.map((k) => g(k.id)))).toEqual({ ok: true });
    expect(validateSubmission(family, known, [...known.map((k) => g(k.id)), p1()])).toEqual({
      ok: false,
      code: "no_plus_one_slot",
    });
  });
});

describe("dedupePlusOnes", () => {
  const known: NamedKnownGuest[] = [
    { id: "g1", origin: "named", firstName: "Jane", lastName: "Doe" },
    { id: "px", origin: "plus_one", firstName: "Kate", lastName: "Durkin" },
  ];

  it("re-submitted plus-one matches the existing guest (autosave idempotency)", () => {
    const r = dedupePlusOnes(known, [{ firstName: "Kate", lastName: "Durkin", responses: ["r1"] }]);
    expect(r.fresh).toHaveLength(0);
    expect(r.existing).toEqual([{ guestId: "px", responses: ["r1"] }]);
  });

  it("matches case-insensitively with whitespace", () => {
    const r = dedupePlusOnes(known, [{ firstName: " kate ", lastName: "DURKIN", responses: [] }]);
    expect(r.existing).toHaveLength(1);
  });

  it("a genuinely new name stays fresh", () => {
    const r = dedupePlusOnes(known, [{ firstName: "Sam", lastName: "Lee", responses: [] }]);
    expect(r.fresh).toHaveLength(1);
    expect(r.existing).toHaveLength(0);
  });

  it("never matches a NAMED guest, only plus_ones", () => {
    const r = dedupePlusOnes(known, [{ firstName: "Jane", lastName: "Doe", responses: [] }]);
    expect(r.fresh).toHaveLength(1);
  });

  it("two incoming with the same name claim one existing then one fresh", () => {
    const r = dedupePlusOnes(known, [
      { firstName: "Kate", lastName: "Durkin", responses: [] },
      { firstName: "Kate", lastName: "Durkin", responses: [] },
    ]);
    expect(r.existing).toHaveLength(1);
    expect(r.fresh).toHaveLength(1);
  });
});

describe("openPlusOneSlots", () => {
  it("grants the slot when party size has headroom", () => {
    expect(openPlusOneSlots({ maxPartySize: 2, plusOneSlots: 1 }, single)).toBe(1);
  });

  it("is capped by party-size headroom, not just plus_one_slots (McMath bug)", () => {
    // max_party_size 1 + plus_one_slots 1: the server would reject any new
    // plus-one, so the UI must offer zero slots.
    expect(openPlusOneSlots({ maxPartySize: 1, plusOneSlots: 1 }, single)).toBe(0);
  });

  it("counts existing plus_ones against the slots", () => {
    const known: KnownGuest[] = [
      { id: "g1", origin: "named" },
      { id: "px", origin: "plus_one" },
    ];
    expect(openPlusOneSlots({ maxPartySize: 3, plusOneSlots: 1 }, known)).toBe(0);
  });

  it("never goes negative", () => {
    expect(openPlusOneSlots({ maxPartySize: 1, plusOneSlots: 0 }, couple)).toBe(0);
  });

  it("offers multiple slots when both limits allow", () => {
    expect(openPlusOneSlots({ maxPartySize: 4, plusOneSlots: 2 }, couple)).toBe(2);
  });
});

describe("normalizeHouseholdRules", () => {
  it("raises maxPartySize to cover named guests plus granted slots", () => {
    expect(normalizeHouseholdRules({ maxPartySize: 1, plusOneSlots: 1 }, 1)).toEqual({
      maxPartySize: 2,
      plusOneSlots: 1,
    });
  });

  it("leaves a consistent config untouched", () => {
    expect(normalizeHouseholdRules({ maxPartySize: 4, plusOneSlots: 1 }, 2)).toEqual({
      maxPartySize: 4,
      plusOneSlots: 1,
    });
  });

  it("raises maxPartySize to at least the named-guest count even with no slots", () => {
    expect(normalizeHouseholdRules({ maxPartySize: 2, plusOneSlots: 0 }, 3)).toEqual({
      maxPartySize: 3,
      plusOneSlots: 0,
    });
  });

  it("floors nonsense input at a party of one", () => {
    expect(normalizeHouseholdRules({ maxPartySize: 0, plusOneSlots: 0 }, 0)).toEqual({
      maxPartySize: 1,
      plusOneSlots: 0,
    });
  });
});

describe("computeHouseholdStatus", () => {
  it("all no → declined", () => {
    expect(computeHouseholdStatus(["no", "no", "no"], false)).toBe("declined");
    expect(computeHouseholdStatus(["no", "no"], true)).toBe("declined");
  });
  it("all pending → pending", () => {
    expect(computeHouseholdStatus(["pending", "pending"], false)).toBe("pending");
  });
  it("some answered, not complete → started", () => {
    expect(computeHouseholdStatus(["yes", "pending"], false)).toBe("started");
  });
  it("complete with no pending → completed", () => {
    expect(computeHouseholdStatus(["yes", "no"], true)).toBe("completed");
  });
  it("complete flag but still pending answers → started", () => {
    expect(computeHouseholdStatus(["yes", "pending"], true)).toBe("started");
  });
  it("empty responses → pending", () => {
    expect(computeHouseholdStatus([], false)).toBe("pending");
  });
});
