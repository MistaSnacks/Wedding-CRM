import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "@/lib/testing/database";

const wedding = "11111111-1111-1111-1111-111111111111";
const household = "44444444-4444-4444-4444-444444444401";
const adult = "55555555-5555-5555-5555-555555555501";
const child = "55555555-5555-5555-5555-555555555502";
const ceremony = "22222222-2222-2222-2222-222222222201";
const reception = "22222222-2222-2222-2222-222222222202";

let db: PGlite;
const mealId = async (name: string) =>
  (await db.query<{ id: string }>("select id from meal_options where wedding_id=$1 and name=$2", [wedding, name])).rows[0].id;
const status = async () =>
  (await db.query<{ rsvp_status: string }>("select rsvp_status from households where id=$1", [household])).rows[0].rsvp_status;

beforeAll(async () => {
  db = await createTestDatabase();
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("Juliet & Juan guest menu", () => {
  it("offers guests Beef, Chicken, Vegan, Vegetarian in three languages and keeps hidden options' rows", async () => {
    const rows = (
      await db.query<{ name: string; is_active: boolean; name_i18n: Record<string, string> }>(
        "select name, is_active, name_i18n from meal_options where wedding_id=$1 order by sort_order",
        [wedding],
      )
    ).rows;
    const shown = rows.filter((m) => m.is_active);
    expect(shown.map((m) => m.name)).toEqual(["Beef", "Chicken", "Vegan", "Vegetarian"]);
    expect(shown.map((m) => m.name_i18n.es)).toEqual(["Res", "Pollo", "Vegano", "Vegetariano"]);
    expect(shown.map((m) => m.name_i18n.vi)).toEqual(["Thịt bò", "Thịt gà", "Thuần chay", "Chay (ăn chay có trứng sữa)"]);
    expect(rows.filter((m) => !m.is_active).map((m) => m.name)).toEqual(["Kids Meal", "Fish"]);
  });

  it("refuses to remove a hidden option even when no guest chose it", async () => {
    const kids = await mealId("Kids Meal");
    await expect(
      db.query("select manage_meal_option($1,$2,'Kids Meal',null,true,true)", [wedding, kids]),
    ).rejects.toThrow("hidden from guests");
    expect((await db.query("select 1 from meal_options where id=$1", [kids])).rows).toHaveLength(1);
  });

  it("lets a child finish the RSVP with no kids meal on offer", async () => {
    const [beef, chicken] = [await mealId("Beef"), await mealId("Chicken")];
    await db.query("select submit_rsvp($1,$2::jsonb)", [
      household,
      JSON.stringify({
        complete: true,
        responses: [
          { guest_id: adult, event_id: ceremony, attending: "yes", meal_option_id: beef },
          { guest_id: adult, event_id: reception, attending: "yes", meal_option_id: beef },
          { guest_id: child, event_id: ceremony, attending: "yes", meal_option_id: chicken },
          { guest_id: child, event_id: reception, attending: "yes", meal_option_id: chicken },
        ],
      }),
    ]);
    expect(await status()).toBe("completed");
  });

  it("keeps an RSVP complete when a guest's recorded meal is a hidden option", async () => {
    await db.query("update guest_event_responses set meal_option_id=$1 where guest_id=$2 and event_id=$3", [
      await mealId("Kids Meal"),
      child,
      ceremony,
    ]);
    expect(await status()).toBe("completed");
  });

  it("clears the translations when an admin renames an option, so guests never see the old dish", async () => {
    const vegan = await mealId("Vegan");
    await db.query("select manage_meal_option($1,$2,'Vegan',null,false,false)", [wedding, vegan]);
    expect((await db.query<{ name_i18n: object }>("select name_i18n from meal_options where id=$1", [vegan])).rows[0].name_i18n)
      .toEqual({ es: "Vegano", vi: "Thuần chay" });
    await db.query("select manage_meal_option($1,$2,'Vegan bowl',null,false,false)", [wedding, vegan]);
    expect((await db.query<{ name_i18n: object }>("select name_i18n from meal_options where id=$1", [vegan])).rows[0].name_i18n)
      .toEqual({});
  });

  it("lets a dish chosen only at the reception become reception-only", async () => {
    const chicken = await mealId("Chicken");
    await db.query("select manage_meal_option($1,$2,'Chicken',$3,false,false)", [wedding, chicken, reception]);
    expect((await db.query<{ event_id: string }>("select event_id from meal_options where id=$1", [chicken])).rows[0].event_id)
      .toBe(reception);
  });

  it("refuses to move a dish away from an event where a guest holds it", async () => {
    const beef = await mealId("Beef");
    await expect(
      db.query("select manage_meal_option($1,$2,'Beef',$3,false,false)", [wedding, beef, reception]),
    ).rejects.toThrow("for another event");
    expect((await db.query<{ event_id: string | null }>("select event_id from meal_options where id=$1", [beef])).rows[0].event_id)
      .toBeNull();
  });

  it("still refuses to remove a dish a guest chose", async () => {
    await expect(
      db.query("select manage_meal_option($1,$2,'Beef',null,false,true)", [wedding, await mealId("Beef")]),
    ).rejects.toThrow("already chose this dish");
  });
});
