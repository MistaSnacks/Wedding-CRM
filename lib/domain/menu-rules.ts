/*
 * Rules for the menu the couple edits.
 *
 * A guest who says yes to an event must pick a dish when that event has any.
 * The database counts hidden dishes as "has dishes", so hiding the last dish a
 * group of guests can pick leaves them unable to finish their reply.
 */

export type MenuDish = { id: string; event_id: string | null; is_kids_meal: boolean; is_active: boolean };

const AGE_GROUPS = ["adult", "child"] as const;

/** The dishes a guest of this age can pick at this event, hidden ones included. */
function offeredTo(dishes: MenuDish[], eventId: string, age: (typeof AGE_GROUPS)[number]) {
  return dishes.filter((d) => (!d.event_id || d.event_id === eventId) && (age !== "adult" || !d.is_kids_meal));
}

/** True when hiding `dishId` leaves some guests with dishes on record but none to pick. */
export function hidingLeavesNoChoice(dishes: MenuDish[], eventIds: string[], dishId: string): boolean {
  return eventIds.some((eventId) =>
    AGE_GROUPS.some((age) => {
      const shown = offeredTo(dishes, eventId, age).filter((d) => d.is_active);
      return shown.length === 1 && shown[0].id === dishId;
    }),
  );
}
