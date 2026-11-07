import type { MealNameTranslations, MealOptionRow } from "@/lib/types";

/** The name a guest sees: their language when translated, otherwise the English `name`. */
export function mealName(
  meal: Pick<MealOptionRow, "name" | "name_i18n"> | undefined,
  locale: string,
): string | undefined {
  if (!meal) return undefined;
  return meal.name_i18n?.[locale as keyof MealNameTranslations]?.trim() || meal.name;
}
