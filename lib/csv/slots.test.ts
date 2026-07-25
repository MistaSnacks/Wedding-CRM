import { describe, it, expect } from "vitest";
import { parseCsv, detectMapping, validateCsv } from "./index";

describe("blank-name rows", () => {
  it("becomes a plus-one slot on its envelope's household", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group A,Ann One,Ann,One,Primary
Group A,Ann One,,,Companion
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.households[0].guests).toHaveLength(1);
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(2);
  });

  it("does not depend on any category value", () => {
    // The blank row's category matches the named row's — a slot is still created.
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group B,Ben Two &,Ben,Two,Relatives
Group B,Ben Two &,,,Relatives
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(2);
  });

  it("counts multiple blank rows as multiple slots", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name
Group C,Cara,Three
Group C,,
Group C,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(2);
    expect(v.households[0].maxPartySize).toBe(3);
  });

  it("donates a blank row with no envelope to its household's only envelope group", () => {
    // The plus-one row carries no envelope of its own, so it keys on the
    // household while the named row keys on the envelope. There is exactly one
    // envelope under that household, so the seat belongs to it.
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name,Category
Group F,Fay Six & Guest,Fay,Six,Primary
Group F,,,,Companion
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households).toHaveLength(1);
    expect(v.households[0].guests).toHaveLength(1);
    expect(v.households[0].plusOneSlots).toBe(1);
    expect(v.households[0].maxPartySize).toBe(2);
    expect(v.warnings).toEqual([]);
  });

  it("warns and names the household when a blank row could belong to either of two envelopes", () => {
    const { headers, rows } = parseCsv(
      `Household,Envelope Name,First Name,Last Name
Group G,Gil Seven,Gil,Seven
Group G,Hana Eight,Hana,Eight
Group G,,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(2);
    expect(v.households.every((h) => h.plusOneSlots === 0)).toBe(true);
    const warning = v.warnings.find((w) => w.message.includes("Group G"));
    expect(warning).toBeDefined();
    expect(warning!.line).toBe(4); // the blank row itself, not the header
    expect(warning!.message).not.toMatch(/hh:|env:|auto:/);
  });

  it("still warns and skips a row with no name and no grouping value", () => {
    const { headers, rows } = parseCsv(`First Name,Last Name,Email\n,,\n`);
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households).toHaveLength(0);
    expect(v.warnings.some((w) => w.message.includes("Empty name"))).toBe(true);
  });

  it("clamps a negative plus-one-slots cell and warns instead of aborting", () => {
    // parseInt("-1", 10) || 0 is -1, which passes validation and then dies at
    // commit on `check (plus_one_slots >= 0)` — taking the whole transaction
    // with it. Max Party Size is mapped and large enough here so nothing else
    // catches the row first.
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Plus Ones,Max Party Size
Group E,Eve,Five,-1,4
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.ok).toBe(true);
    expect(v.households[0].plusOneSlots).toBe(0);
    expect(v.households[0].maxPartySize).toBe(4);
    expect(v.warnings.some((w) => w.message.includes("negative"))).toBe(true);
  });

  it("adds slots on top of an explicit plus-one-slots column", () => {
    const { headers, rows } = parseCsv(
      `Household,First Name,Last Name,Plus Ones
Group D,Dana,Four,1
Group D,,,
`,
    );
    const v = validateCsv(rows, detectMapping(headers));
    expect(v.households[0].plusOneSlots).toBe(2);
  });
});
