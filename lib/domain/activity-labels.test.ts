import { expect, test } from "vitest";
import { activityLabel, actorLabel } from "./activity-labels";

test("a listed action reads as a sentence", () => {
  expect(activityLabel("sheet.matched")).toBe("Matched to a save-the-date sign-up");
});

test("an unlisted action still reads as words, never a machine name", () => {
  expect(activityLabel("budget.item_updated")).toBe("Budget item updated");
});

test("the actor is named in plain words or left out", () => {
  expect(actorLabel("admin")).toBe("by your team");
  expect(actorLabel("robot")).toBe("");
  expect(actorLabel(null)).toBe("");
});
