import { describe, expect, it } from "vitest";
import type { ParsedSubmission } from "./sheet";
import { resolveHouseholdPatch, resolveUndo, type ApplyTarget } from "./apply";

const submission = (over: Partial<ParsedSubmission> = {}): ParsedSubmission => ({
  first: "Alison",
  last: "Aw",
  email: "yalisonaw@gmail.com",
  phone: "4258901026",
  address: "3827A Interlake Ave N. Seattle, WA 98103",
  notes: "",
  language: "en",
  receivedAt: "Sat, Jun 27, 2026 11:35 AM",
  optOut: false,
  ...over,
});

const household = (over: Partial<ApplyTarget> = {}): ApplyTarget => ({
  email: null,
  phone: null,
  mailing_address: null,
  preferred_locale: "en",
  internal_notes: null,
  rsvp_status: "pending",
  ...over,
});

describe("resolveHouseholdPatch — empty fields", () => {
  it("fills every blank contact field", () => {
    const { patch } = resolveHouseholdPatch(household(), submission());
    expect(patch.email).toBe("yalisonaw@gmail.com");
    expect(patch.phone).toBe("4258901026");
    expect(patch.mailing_address).toEqual({
      raw: "3827A Interlake Ave N. Seattle, WA 98103",
      source: "save_the_date",
    });
  });

  it("records prior values so undo can restore them", () => {
    const { applied } = resolveHouseholdPatch(household(), submission());
    expect(applied.email).toEqual({ from: null, to: "yalisonaw@gmail.com" });
  });

  it("stores the address verbatim — never parsed into pieces", () => {
    const messy = "Paseo de los cedros #2152.,\nCol. Mesa de los ocotes C.P. 45189";
    const { patch } = resolveHouseholdPatch(household(), submission({ address: messy }));
    expect((patch.mailing_address as { raw: string }).raw).toBe(messy);
  });
});

describe("resolveHouseholdPatch — address source precedence", () => {
  it("overwrites a spreadsheet-imported address, because the guest typed this one", () => {
    const target = household({ mailing_address: { zip: "90001", state: "CA", source: "csv" } });
    const { patch, applied } = resolveHouseholdPatch(target, submission());
    expect((patch.mailing_address as { source: string }).source).toBe("save_the_date");
    expect(applied.mailing_address.from).toEqual({ zip: "90001", state: "CA", source: "csv" });
  });

  it("never overwrites an address the admin edited by hand", () => {
    const target = household({ mailing_address: { raw: "hand corrected", source: "admin" } });
    const { patch, skipped } = resolveHouseholdPatch(target, submission());
    expect(patch.mailing_address).toBeUndefined();
    expect(skipped.join(" ")).toMatch(/edited by hand/i);
  });

  it("leaves a form-vs-form conflict for a human", () => {
    const target = household({ mailing_address: { raw: "a different address", source: "save_the_date" } });
    const { patch, skipped } = resolveHouseholdPatch(target, submission());
    expect(patch.mailing_address).toBeUndefined();
    expect(skipped.join(" ")).toMatch(/another response/i);
  });
});

describe("resolveHouseholdPatch — contact fields without provenance", () => {
  it("does not overwrite an existing email, since we cannot tell who set it", () => {
    const target = household({ email: "already@there.com" });
    const { patch } = resolveHouseholdPatch(target, submission());
    expect(patch.email).toBeUndefined();
  });

  it("does not overwrite an existing phone", () => {
    expect(resolveHouseholdPatch(household({ phone: "5550000" }), submission()).patch.phone).toBeUndefined();
  });
});

describe("resolveHouseholdPatch — locale, notes, opt-outs", () => {
  it("upgrades the default locale when the guest chose Spanish", () => {
    expect(resolveHouseholdPatch(household(), submission({ language: "es" })).patch.preferred_locale).toBe("es");
  });

  it("leaves a non-default locale alone", () => {
    const target = household({ preferred_locale: "vi" });
    expect(resolveHouseholdPatch(target, submission({ language: "es" })).patch.preferred_locale).toBeUndefined();
  });

  it("appends notes with their timestamp rather than merging", () => {
    const target = household({ internal_notes: "existing note" });
    const { patch } = resolveHouseholdPatch(target, submission({ notes: "May I add a plus 1?" }));
    expect(patch.internal_notes).toBe(
      "existing note\n[Save the Date Sat, Jun 27, 2026 11:35 AM] May I add a plus 1?",
    );
  });

  it("does not append the same note twice across re-runs", () => {
    const s = submission({ notes: "HOORAY!!" });
    const once = resolveHouseholdPatch(household(), s).patch.internal_notes as string;
    const twice = resolveHouseholdPatch(household({ internal_notes: once }), s).patch.internal_notes;
    expect(twice).toBeUndefined();
  });

  it("honours an opt-out immediately", () => {
    const { patch } = resolveHouseholdPatch(household(), submission({ notes: "Opt Out", optOut: true }));
    expect(patch.rsvp_status).toBe("declined");
  });

  it("never un-declines a household that already replied", () => {
    const target = household({ rsvp_status: "completed" });
    const { patch } = resolveHouseholdPatch(target, submission({ optOut: true }));
    expect(patch.rsvp_status).toBeUndefined();
  });

  it("never auto-grants a plus-one request — that is the couple's cost decision", () => {
    const { patch } = resolveHouseholdPatch(household(), submission({ notes: "I would like a plus 1 if possible" }));
    expect(patch).not.toHaveProperty("plus_one_slots");
    expect(patch).not.toHaveProperty("max_party_size");
  });
});

describe("resolveUndo", () => {
  const applied = { email: { from: null, to: "yalisonaw@gmail.com" } };

  it("restores the previous value exactly", () => {
    const result = resolveUndo(household({ email: "yalisonaw@gmail.com" }), applied);
    expect(result).toEqual({ patch: { email: null } });
  });

  it("declines rather than clobbering a value edited since", () => {
    const result = resolveUndo(household({ email: "someone@else.com" }), applied);
    expect(result).toHaveProperty("declined");
    if ("declined" in result) expect(result.declined).toMatch(/changed since/i);
  });

  it("restores a structured address by deep comparison", () => {
    const a = { mailing_address: { from: { zip: "90001", source: "csv" }, to: { raw: "new", source: "save_the_date" } } };
    const target = household({ mailing_address: { raw: "new", source: "save_the_date" } });
    expect(resolveUndo(target, a)).toEqual({ patch: { mailing_address: { zip: "90001", source: "csv" } } });
  });

  it("does nothing when there is nothing recorded", () => {
    expect(resolveUndo(household(), {})).toEqual({ patch: {} });
  });
});
