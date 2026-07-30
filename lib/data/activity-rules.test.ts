import { describe, it, expect } from "vitest";
import { isGuestFeedAction, selectGuestFeed } from "./activity-rules";

describe("isGuestFeedAction", () => {
  it("admits the actions the Overview feed knows how to badge", () => {
    for (const action of [
      "rsvp.completed",
      "rsvp.started",
      "rsvp.declined",
      "plus_one.added",
      "import.completed",
      "table.assigned",
    ]) {
      expect(isGuestFeedAction(action)).toBe(true);
    }
  });

  it("admits the rest of the guest domain", () => {
    expect(isGuestFeedAction("household.removed")).toBe(true);
    expect(isGuestFeedAction("household.created")).toBe(true);
    expect(isGuestFeedAction("guest.updated")).toBe(true);
    expect(isGuestFeedAction("seat.unassigned")).toBe(true);
  });

  // The regression this module exists for. The filter used to be "everything
  // except changelog.seen", so the budget module's first write put rows reading
  // "budget item_updated" into a panel headed "Recent RSVPs", with an em dash
  // where the household name goes.
  it("keeps money out of the guest feed", () => {
    for (const action of [
      "budget.seeded",
      "budget.item_updated",
      "budget.max_spend_set",
      "payment.created",
      "payment.updated",
      "payment.marked_paid",
      "payment.removed",
      "vendor.booked",
      "vendor.status_changed",
    ]) {
      expect(isGuestFeedAction(action)).toBe(false);
    }
  });

  it("excludes anything it has not been told about, rather than admitting it", () => {
    expect(isGuestFeedAction("changelog.seen")).toBe(false);
    expect(isGuestFeedAction("something.nobody.has.written.yet")).toBe(false);
    expect(isGuestFeedAction("")).toBe(false);
  });

  it("matches on the domain prefix, not a bare substring", () => {
    // "…rsvp." appearing later in the string is a different domain.
    expect(isGuestFeedAction("budget.rsvp.reconciled")).toBe(false);
  });
});

describe("selectGuestFeed", () => {
  const rows = [
    { id: "1", action: "payment.marked_paid" },
    { id: "2", action: "budget.item_updated" },
    { id: "3", action: "rsvp.completed" },
    { id: "4", action: "budget.seeded" },
    { id: "5", action: "rsvp.declined" },
    { id: "6", action: "household.removed" },
  ];

  it("drops non-guest rows and preserves the order it was given", () => {
    expect(selectGuestFeed(rows, 10).map((r) => r.id)).toEqual(["3", "5", "6"]);
  });

  it("caps at the limit after filtering, not before", () => {
    // Filtering before capping is the bug: a page of budget edits would
    // otherwise fill the limit and leave the replies invisible.
    expect(selectGuestFeed(rows, 2).map((r) => r.id)).toEqual(["3", "5"]);
  });

  it("returns nothing when a busy week of budget edits is all there is", () => {
    const moneyOnly = rows.filter((r) => !r.action.startsWith("rsvp.") && !r.action.startsWith("household."));
    expect(selectGuestFeed(moneyOnly, 8)).toEqual([]);
  });
});
