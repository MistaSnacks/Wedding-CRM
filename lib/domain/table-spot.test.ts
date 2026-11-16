import { expect, test } from "vitest";
import { freeTableSpot } from "./table-spot";

test("the first table goes to the first cell", () => {
  expect(freeTableSpot([])).toEqual({ posX: 32, posY: 32 });
});

test("a new table never lands on an existing one", () => {
  const taken = [
    { pos_x: 32, pos_y: 32 },
    { pos_x: 192, pos_y: 32 },
  ];
  expect(freeTableSpot(taken)).toEqual({ posX: 352, posY: 32 });
});

test("a table dragged slightly off the grid still blocks its cell", () => {
  expect(freeTableSpot([{ pos_x: 40, pos_y: 20 }])).toEqual({ posX: 192, posY: 32 });
});
