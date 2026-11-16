/*
 * Where a new table lands on the seating canvas when nobody chose a spot.
 *
 * Every new table used to land at the top-left corner, on top of the last one
 * and, in the 3D venue, on a roof post. The canvas lays tables out on a
 * 160-pixel grid, so the first free cell of that grid is the natural place.
 */

export type Spot = { posX: number; posY: number };

const FIRST = 32;
const STEP = 160;
const COLUMNS = 5;
const ROWS = 12;
/** Two tables closer than this overlap on the canvas. */
const CLEARANCE = 120;

export function freeTableSpot(taken: ReadonlyArray<{ pos_x: number; pos_y: number }>): Spot {
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const posX = FIRST + column * STEP;
      const posY = FIRST + row * STEP;
      const clear = taken.every((t) => Math.hypot(t.pos_x - posX, t.pos_y - posY) >= CLEARANCE);
      if (clear) return { posX, posY };
    }
  }
  // A full grid: stack below it. She can drag the table from there.
  return { posX: FIRST, posY: FIRST + ROWS * STEP };
}
