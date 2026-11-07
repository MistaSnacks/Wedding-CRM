import { describe, expect, it } from "vitest";
import { mealName } from "./meal-name";

const beef = { name: "Beef", name_i18n: { es: "Res", vi: "Thịt bò" } };

describe("mealName", () => {
  it("shows the guest's language when a translation exists", () => {
    expect(mealName(beef, "es")).toBe("Res");
    expect(mealName(beef, "vi")).toBe("Thịt bò");
  });
  it("shows the English name to English guests", () => {
    expect(mealName(beef, "en")).toBe("Beef");
  });
  it("falls back to the English name when a translation is missing or blank", () => {
    expect(mealName({ name: "Chicken", name_i18n: { es: "Pollo" } }, "vi")).toBe("Chicken");
    expect(mealName({ name: "Chicken", name_i18n: { es: "  " } }, "es")).toBe("Chicken");
    expect(mealName({ name: "Chicken", name_i18n: {} }, "es")).toBe("Chicken");
  });
  it("returns nothing for an unknown meal so the caller can say none was chosen", () => {
    expect(mealName(undefined, "es")).toBeUndefined();
  });
});
