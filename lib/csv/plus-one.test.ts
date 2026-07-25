import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";
import { isTruthy } from "./normalize";
import { validateSubmission, openPlusOneSlots } from "@/lib/domain/invitation-rules";
import type { ImportHouseholdInput } from "@/lib/data/imports";

const PLUS_ONE_CSV = `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann & Guest,Ann,One,Primary
Group A,Ann & Guest,Guest,Person,Plus One
`;

function importOne(csv: string): ImportHouseholdInput {
  const { headers, rows } = parseCsv(csv);
  const v = validateCsv(rows, { ...detectMapping(headers), isPlusOne: "Category" });
  expect(v.ok).toBe(true);
  return v.households[0];
}

/** Rebuilds what the RSVP flow would read back out of the database. */
function asRsvpState(h: ImportHouseholdInput) {
  return {
    rules: { maxPartySize: h.maxPartySize, plusOneSlots: h.plusOneSlots },
    known: h.guests.map((g, i) => ({ id: `g${i}`, origin: g.origin ?? ("named" as const) })),
  };
}

describe("isTruthy", () => {
  it("accepts common affirmative spellings", () => {
    for (const v of ["yes", "Y", "true", "1", "x", "Plus One", "plus-one", "+1"]) {
      expect(isTruthy(v)).toBe(true);
    }
  });

  it("rejects blanks and negatives", () => {
    for (const v of ["", "  ", "no", "false", "0", "Primary"]) {
      expect(isTruthy(v)).toBe(false);
    }
  });
});

describe("plus-one origin", () => {
  it("marks a named plus-one row and records its slot as already occupied", () => {
    const h = importOne(PLUS_ONE_CSV);
    expect(h.guests).toHaveLength(2);
    expect(h.guests.find((g) => g.firstName === "Ann")!.origin).toBe("named");
    expect(h.guests.find((g) => g.firstName === "Guest")!.origin).toBe("plus_one");
    // Was 0. A named plus-one occupies a slot; it does not mean no slot exists.
    // The RSVP engine reads plus_one_slots as the grant and existing
    // origin='plus_one' guests as consumers, so slots=0 with one such guest
    // means every submission from this household trips `existing > slots` and
    // the household can never RSVP at all — see the regression test below.
    expect(h.plusOneSlots).toBe(1);
    // Unchanged: the plus-one already has a row, so counting them again in the
    // party-size cap would let the household bring one more person than the
    // envelope allows.
    expect(h.maxPartySize).toBe(2);
  });

  it("lets a household with a named plus-one actually submit an RSVP", () => {
    const { rules, known } = asRsvpState(importOne(PLUS_ONE_CSV));

    // A plain "we're both coming" — no new plus-one requested.
    const submitted = known.map((k) => ({ guestId: k.id }));
    expect(validateSubmission(rules, known, submitted)).toEqual({ ok: true });

    // Declining is a submission too, and must not be blocked either.
    expect(validateSubmission(rules, known, [{ guestId: known[0].id }])).toEqual({ ok: true });

    // The slot is spoken for, so the UI must still offer no extra seat.
    expect(openPlusOneSlots(rules, known)).toBe(0);

    // And a second plus-one is still refused.
    expect(
      validateSubmission(rules, known, [
        ...submitted,
        { newPlusOne: { firstName: "Extra", lastName: "Person" } },
      ]),
    ).toEqual({ ok: false, code: "no_plus_one_slot" });
  });

  it("leaves origin undefined when no plus-one column is mapped", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name\nAnn,One\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].guests[0].origin).toBeUndefined();
  });
});
