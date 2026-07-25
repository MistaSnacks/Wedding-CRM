import { describe, it, expect } from "vitest";
import { mealCounts } from "./metrics";

const MEALS = [
  { id: "meal-chicken", name: "Chicken", sort_order: 1 },
  { id: "meal-fish", name: "Fish", sort_order: 0 },
];

describe("mealCounts", () => {
  it("counts a guest once even when they have multiple attending responses for the same meal", () => {
    // Guest G1 has one meal choice, but attends 3 events -> 3 response rows,
    // all carrying the same meal_option_id. The bug counted rows, not guests.
    const responses = [
      { guest_id: "g1", attending: "yes", meal_option_id: "meal-chicken" },
      { guest_id: "g1", attending: "yes", meal_option_id: "meal-chicken" },
      { guest_id: "g1", attending: "yes", meal_option_id: "meal-chicken" },
    ];
    const result = mealCounts(responses, MEALS);
    expect(result.find((r) => r.name === "Chicken")?.count).toBe(1);
  });

  it("does not count a guest's declined ('no') responses", () => {
    const responses = [
      { guest_id: "g1", attending: "no", meal_option_id: "meal-chicken" },
      { guest_id: "g1", attending: "no", meal_option_id: "meal-chicken" },
    ];
    const result = mealCounts(responses, MEALS);
    expect(result.find((r) => r.name === "Chicken")?.count).toBe(0);
  });

  it("does not count a guest attending 'yes' with no meal_option_id set", () => {
    const responses = [
      { guest_id: "g1", attending: "yes", meal_option_id: null },
      { guest_id: "g1", attending: "yes", meal_option_id: null },
    ];
    const result = mealCounts(responses, MEALS);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  it("counts two different guests with the same meal as 2", () => {
    const responses = [
      { guest_id: "g1", attending: "yes", meal_option_id: "meal-chicken" },
      { guest_id: "g2", attending: "yes", meal_option_id: "meal-chicken" },
    ];
    const result = mealCounts(responses, MEALS);
    expect(result.find((r) => r.name === "Chicken")?.count).toBe(2);
  });

  it("reports 0 for meals with no takers rather than omitting them", () => {
    const responses = [{ guest_id: "g1", attending: "yes", meal_option_id: "meal-chicken" }];
    const result = mealCounts(responses, MEALS);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.name === "Fish")?.count).toBe(0);
  });

  it("preserves the order of the meals array as given (caller sorts by sort_order)", () => {
    const sorted = [...MEALS].sort((a, b) => a.sort_order - b.sort_order);
    const result = mealCounts([], sorted);
    expect(result.map((r) => r.name)).toEqual(["Fish", "Chicken"]);
  });
});
