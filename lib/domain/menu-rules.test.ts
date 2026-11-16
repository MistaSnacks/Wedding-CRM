import { expect, test } from "vitest";
import { hidingLeavesNoChoice, type MenuDish } from "./menu-rules";

const dish = (id: string, over: Partial<MenuDish> = {}): MenuDish => ({
  id,
  event_id: null,
  is_kids_meal: false,
  is_active: true,
  ...over,
});

test("hiding one of several dishes is fine", () => {
  expect(hidingLeavesNoChoice([dish("beef"), dish("chicken")], ["reception"], "beef")).toBe(false);
});

test("hiding the last dish adults can pick is refused", () => {
  const dishes = [dish("beef"), dish("fish", { is_active: false }), dish("nuggets", { is_kids_meal: true })];
  expect(hidingLeavesNoChoice(dishes, ["reception"], "beef")).toBe(true);
});

test("a dish for another event does not count as a choice", () => {
  const dishes = [dish("beef", { event_id: "reception" }), dish("tacos", { event_id: "welcome" })];
  expect(hidingLeavesNoChoice(dishes, ["reception", "welcome"], "tacos")).toBe(true);
});

test("hiding the only kids dish is fine when children can pick an adult dish", () => {
  const dishes = [dish("beef"), dish("nuggets", { is_kids_meal: true })];
  expect(hidingLeavesNoChoice(dishes, ["reception"], "nuggets")).toBe(false);
});
