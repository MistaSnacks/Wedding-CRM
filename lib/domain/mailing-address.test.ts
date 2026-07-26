import { describe, expect, it } from "vitest";
import type { MailingAddress } from "@/lib/csv/types";
import { formatMailingAddress, provenanceLabel, resolveAddressUpdate } from "./mailing-address";

describe("formatMailingAddress", () => {
  it("returns raw verbatim when present", () => {
    const a: MailingAddress = { raw: "3827A Interlake Ave N.\nSeattle, WA 98103", source: "save_the_date" };
    expect(formatMailingAddress(a)).toBe("3827A Interlake Ave N.\nSeattle, WA 98103");
  });

  it("joins structured pieces when there is no raw", () => {
    const a: MailingAddress = { street: "1 Main St", city: "Seattle", state: "WA", zip: "98103", country: "USA", source: "csv" };
    expect(formatMailingAddress(a)).toBe("1 Main St\nSeattle, WA 98103\nUSA");
  });

  it("handles partial structured addresses", () => {
    const a: MailingAddress = { zip: "90001", state: "CA", country: "USA", source: "csv" };
    expect(formatMailingAddress(a)).toBe("CA 90001\nUSA");
  });

  it("returns empty string for null", () => {
    expect(formatMailingAddress(null)).toBe("");
  });
});

describe("provenanceLabel", () => {
  it("labels each source in plain language", () => {
    expect(provenanceLabel({ raw: "x", source: "save_the_date" })).toBe("from the Save-the-Date form");
    expect(provenanceLabel({ raw: "x", source: "csv" })).toBe("from your spreadsheet import");
    expect(provenanceLabel({ raw: "x", source: "admin" })).toBe("edited by you");
    expect(provenanceLabel(null)).toBeNull();
  });
});

describe("resolveAddressUpdate", () => {
  const prev: MailingAddress = { raw: "old address", source: "save_the_date" };

  it("returns undefined when the text is unchanged", () => {
    expect(resolveAddressUpdate(prev, "old address")).toBeUndefined();
    expect(resolveAddressUpdate(prev, "  old address  ")).toBeUndefined();
  });

  it("returns undefined when a structured address round-trips unedited", () => {
    const structured: MailingAddress = { street: "1 Main St", city: "Seattle", state: "WA", zip: "98103", country: "USA", source: "csv" };
    expect(resolveAddressUpdate(structured, formatMailingAddress(structured))).toBeUndefined();
  });

  it("stores edits verbatim as an admin-sourced raw value", () => {
    expect(resolveAddressUpdate(prev, "New Street 5\nApt 2")).toEqual({
      raw: "New Street 5\nApt 2",
      source: "admin",
    });
  });

  it("returns null when the field is emptied", () => {
    expect(resolveAddressUpdate(prev, "   ")).toBeNull();
  });

  it("treats empty-to-empty as unchanged", () => {
    expect(resolveAddressUpdate(null, "")).toBeUndefined();
  });
});
