import { describe, it, expect } from "vitest";
import { deletionImpact, inviteDiff, validateEvent } from "./event-rules";
import type { EventInviteFact, EventResponseFact } from "./event-rules";

const EVENT = "ev-target";
const OTHER = "ev-other";

function invite(event_id: string, household_id: string): EventInviteFact {
  return { event_id, household_id };
}

function response(
  event_id: string,
  household_id: string,
  guest_id: string,
  attending: EventResponseFact["attending"],
  meal_option_id: string | null = null,
): EventResponseFact {
  return { event_id, household_id, guest_id, attending, meal_option_id };
}

describe("deletionImpact", () => {
  it("counts only the target event's invites and responses", () => {
    const invites = [
      invite(EVENT, "hh-1"),
      invite(EVENT, "hh-2"),
      invite(OTHER, "hh-3"),
      invite(OTHER, "hh-4"),
    ];
    const responses = [
      response(EVENT, "hh-1", "g-1", "yes", "meal-a"),
      response(OTHER, "hh-3", "g-5", "yes", "meal-a"),
      response(OTHER, "hh-4", "g-6", "no"),
    ];

    expect(deletionImpact(EVENT, invites, responses)).toEqual({
      households: 2,
      replied: 1,
      mealsChosen: 1,
      responseRows: 1,
    });
  });

  it("reports zeros for an event with no invites and no responses", () => {
    const impact = deletionImpact(EVENT, [invite(OTHER, "hh-1")], [
      response(OTHER, "hh-1", "g-1", "yes", "meal-a"),
    ]);
    expect(impact).toEqual({ households: 0, replied: 0, mealsChosen: 0, responseRows: 0 });
  });

  it("reports zero replies for an invited event nobody has answered yet", () => {
    // An event can be fully invited and still be safe to delete: no replies,
    // no meals. This is the branch that skips typed confirmation.
    const impact = deletionImpact(EVENT, [invite(EVENT, "hh-1"), invite(EVENT, "hh-2")], []);
    expect(impact).toEqual({ households: 2, replied: 0, mealsChosen: 0, responseRows: 0 });
  });

  it("does not count 'pending' rows as replies", () => {
    // guests.add() eagerly inserts a response row per invited event with the
    // default attending='pending'. Those rows are placeholders, not replies —
    // counting them would tell the user 8 households replied when none did.
    const responses = [
      response(EVENT, "hh-1", "g-1", "pending"),
      response(EVENT, "hh-2", "g-2", "pending"),
    ];
    const impact = deletionImpact(EVENT, [invite(EVENT, "hh-1"), invite(EVENT, "hh-2")], responses);
    expect(impact.replied).toBe(0);
    // ...but the placeholder rows are still deleted, so responseRows sees them.
    expect(impact.responseRows).toBe(2);
  });

  it("counts a 'no' reply as a reply", () => {
    const impact = deletionImpact(EVENT, [invite(EVENT, "hh-1")], [
      response(EVENT, "hh-1", "g-1", "no"),
    ]);
    expect(impact.replied).toBe(1);
  });

  it("counts a household once when several of its guests replied", () => {
    const responses = [
      response(EVENT, "hh-1", "g-1", "yes"),
      response(EVENT, "hh-1", "g-2", "yes"),
      response(EVENT, "hh-1", "g-3", "no"),
    ];
    const impact = deletionImpact(EVENT, [invite(EVENT, "hh-1")], responses);
    expect(impact.replied).toBe(1);
    expect(impact.responseRows).toBe(3);
  });

  it("counts a household as replied when only one of its guests replied", () => {
    const responses = [
      response(EVENT, "hh-1", "g-1", "pending"),
      response(EVENT, "hh-1", "g-2", "yes"),
    ];
    expect(deletionImpact(EVENT, [invite(EVENT, "hh-1")], responses).replied).toBe(1);
  });

  it("counts meals per guest, not per household", () => {
    const responses = [
      response(EVENT, "hh-1", "g-1", "yes", "meal-a"),
      response(EVENT, "hh-1", "g-2", "yes", "meal-b"),
    ];
    expect(deletionImpact(EVENT, [invite(EVENT, "hh-1")], responses).mealsChosen).toBe(2);
  });

  it("counts a meal chosen alongside a declined reply — the row is still destroyed", () => {
    // Deliberately divergent from metrics.mealCounts, which filters to
    // attending='yes' because it answers "how many entrees to order".
    // This function answers "how much data am I about to destroy", so any
    // stored meal_option_id counts.
    const responses = [response(EVENT, "hh-1", "g-1", "no", "meal-a")];
    expect(deletionImpact(EVENT, [invite(EVENT, "hh-1")], responses).mealsChosen).toBe(1);
  });

  it("does not count a reply with no meal chosen", () => {
    const responses = [response(EVENT, "hh-1", "g-1", "yes", null)];
    expect(deletionImpact(EVENT, [invite(EVENT, "hh-1")], responses).mealsChosen).toBe(0);
  });

  it("counts a reply from a household with no invite row for the event", () => {
    // A response can outlive its invite (invite removed, response not).
    // Deletion removes the response regardless, so it must be reported.
    const impact = deletionImpact(EVENT, [], [response(EVENT, "hh-9", "g-9", "yes", "meal-a")]);
    expect(impact).toEqual({ households: 0, replied: 1, mealsChosen: 1, responseRows: 1 });
  });

  it("counts an invited household with no guests at all", () => {
    const impact = deletionImpact(EVENT, [invite(EVENT, "hh-empty")], []);
    expect(impact.households).toBe(1);
    expect(impact.replied).toBe(0);
  });

  it("does not let another event's replies from the same household leak in", () => {
    // The asymmetric case: hh-1 is invited to both, but has only replied to
    // OTHER. Deleting EVENT destroys nothing of theirs.
    const invites = [invite(EVENT, "hh-1"), invite(OTHER, "hh-1")];
    const responses = [
      response(OTHER, "hh-1", "g-1", "yes", "meal-a"),
      response(OTHER, "hh-1", "g-2", "yes", "meal-b"),
    ];
    expect(deletionImpact(EVENT, invites, responses)).toEqual({
      households: 1,
      replied: 0,
      mealsChosen: 0,
      responseRows: 0,
    });
  });

  it("counts the same guest's meal for the target event only, once", () => {
    // One guest, one meal choice, copied onto every event response row.
    // Counting rows across events would report 3 meals for a 1-meal guest.
    const responses = [
      response(EVENT, "hh-1", "g-1", "yes", "meal-a"),
      response(OTHER, "hh-1", "g-1", "yes", "meal-a"),
      response("ev-third", "hh-1", "g-1", "yes", "meal-a"),
    ];
    expect(deletionImpact(EVENT, [invite(EVENT, "hh-1")], responses).mealsChosen).toBe(1);
  });

  it("returns zeros for empty inputs", () => {
    expect(deletionImpact(EVENT, [], [])).toEqual({
      households: 0,
      replied: 0,
      mealsChosen: 0,
      responseRows: 0,
    });
  });

  it("counts each invited household once even if the invite list repeats it", () => {
    const invites = [invite(EVENT, "hh-1"), invite(EVENT, "hh-1"), invite(EVENT, "hh-2")];
    expect(deletionImpact(EVENT, invites, []).households).toBe(2);
  });

  it("reports counts matching a mixed realistic set exactly", () => {
    // 4 invited; hh-1 (2 guests, both replied, 1 meal), hh-2 (1 reply, no meal),
    // hh-3 (placeholder only), hh-4 (nothing). Plus noise on another event.
    const invites = [
      invite(EVENT, "hh-1"),
      invite(EVENT, "hh-2"),
      invite(EVENT, "hh-3"),
      invite(EVENT, "hh-4"),
      invite(OTHER, "hh-1"),
    ];
    const responses = [
      response(EVENT, "hh-1", "g-1", "yes", "meal-a"),
      response(EVENT, "hh-1", "g-2", "yes", null),
      response(EVENT, "hh-2", "g-3", "no", null),
      response(EVENT, "hh-3", "g-4", "pending", null),
      response(OTHER, "hh-1", "g-1", "yes", "meal-a"),
      response(OTHER, "hh-2", "g-3", "yes", "meal-b"),
    ];
    expect(deletionImpact(EVENT, invites, responses)).toEqual({
      households: 4,
      replied: 2,
      mealsChosen: 1,
      responseRows: 4,
    });
  });
});

describe("inviteDiff", () => {
  it("writes nothing when the selection is unchanged", () => {
    expect(inviteDiff(["hh-1", "hh-2"], ["hh-1", "hh-2"])).toEqual({ toAdd: [], toRemove: [] });
  });

  it("writes nothing when the selection is the same set in a different order", () => {
    expect(inviteDiff(["hh-1", "hh-2", "hh-3"], ["hh-3", "hh-1", "hh-2"])).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });

  it("adds only the newly selected households", () => {
    expect(inviteDiff(["hh-1"], ["hh-1", "hh-2"])).toEqual({ toAdd: ["hh-2"], toRemove: [] });
  });

  it("removes only the deselected households", () => {
    expect(inviteDiff(["hh-1", "hh-2"], ["hh-1"])).toEqual({ toAdd: [], toRemove: ["hh-2"] });
  });

  it("handles a simultaneous add and remove", () => {
    expect(inviteDiff(["hh-1", "hh-2"], ["hh-2", "hh-3"])).toEqual({
      toAdd: ["hh-3"],
      toRemove: ["hh-1"],
    });
  });

  it("removes everything when the selection is cleared", () => {
    expect(inviteDiff(["hh-1", "hh-2"], [])).toEqual({ toAdd: [], toRemove: ["hh-1", "hh-2"] });
  });

  it("adds everything when nothing was invited before", () => {
    expect(inviteDiff([], ["hh-1", "hh-2"])).toEqual({ toAdd: ["hh-1", "hh-2"], toRemove: [] });
  });

  it("is a no-op for two empty lists", () => {
    expect(inviteDiff([], [])).toEqual({ toAdd: [], toRemove: [] });
  });

  it("deduplicates repeated ids in the selection", () => {
    expect(inviteDiff([], ["hh-1", "hh-1", "hh-2"])).toEqual({
      toAdd: ["hh-1", "hh-2"],
      toRemove: [],
    });
  });

  it("deduplicates repeated ids in the current list", () => {
    expect(inviteDiff(["hh-1", "hh-1"], [])).toEqual({ toAdd: [], toRemove: ["hh-1"] });
  });

  it("does not mutate its inputs", () => {
    const current = ["hh-1", "hh-2"];
    const selected = ["hh-2", "hh-3"];
    inviteDiff(current, selected);
    expect(current).toEqual(["hh-1", "hh-2"]);
    expect(selected).toEqual(["hh-2", "hh-3"]);
  });
});

describe("validateEvent", () => {
  it("accepts a name alone and trims it", () => {
    const result = validateEvent({ name: "  Evening Reception  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "Evening Reception", startsAt: null, endsAt: null });
    }
  });

  it("rejects an empty name", () => {
    const result = validateEvent({ name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "name")).toBe(true);
    }
  });

  it("rejects a name of only whitespace", () => {
    const result = validateEvent({ name: "   \t \n " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field)).toEqual(["name"]);
    }
  });

  it("treats undefined, null and empty-string dates alike as absent", () => {
    for (const blank of [undefined, null, "", "   "]) {
      const result = validateEvent({ name: "Morning Brunch", startsAt: blank, endsAt: blank });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ name: "Morning Brunch", startsAt: null, endsAt: null });
    }
  });

  it("accepts a start with no end", () => {
    const result = validateEvent({ name: "Morning Brunch", startsAt: "2027-06-12T16:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsAt).toBe("2027-06-12T16:00:00Z");
      expect(result.value.endsAt).toBe(null);
    }
  });

  it("accepts an end with no start", () => {
    const result = validateEvent({ name: "Morning Brunch", endsAt: "2027-06-12T18:00:00Z" });
    expect(result.ok).toBe(true);
  });

  it("accepts an end after its start", () => {
    const result = validateEvent({
      name: "Morning Brunch",
      startsAt: "2027-06-12T16:00:00Z",
      endsAt: "2027-06-12T18:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an end before its start", () => {
    const result = validateEvent({
      name: "Morning Brunch",
      startsAt: "2027-06-12T18:00:00Z",
      endsAt: "2027-06-12T16:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field)).toEqual(["endsAt"]);
    }
  });

  it("accepts an end equal to its start", () => {
    const result = validateEvent({
      name: "Morning Brunch",
      startsAt: "2027-06-12T16:00:00Z",
      endsAt: "2027-06-12T16:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  it("compares instants, not strings, across timezone offsets", () => {
    // 17:00-07:00 is 00:00Z the next day — later than 20:00Z, despite sorting
    // earlier as text. A string comparison would wrongly reject this.
    const result = validateEvent({
      name: "Morning Brunch",
      startsAt: "2027-06-12T20:00:00Z",
      endsAt: "2027-06-12T17:00:00-07:00",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unparseable date rather than silently accepting it", () => {
    const result = validateEvent({ name: "Morning Brunch", startsAt: "not-a-date" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field)).toEqual(["startsAt"]);
    }
  });

  it("reports both a missing name and a bad date range together", () => {
    const result = validateEvent({
      name: "  ",
      startsAt: "2027-06-12T18:00:00Z",
      endsAt: "2027-06-12T16:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field).sort()).toEqual(["endsAt", "name"]);
    }
  });

  it("gives every error a non-empty message", () => {
    const result = validateEvent({ name: "", startsAt: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every((e) => e.message.trim().length > 0)).toBe(true);
    }
  });
});
