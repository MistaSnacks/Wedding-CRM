/*
 * The activity log stores machine names ("household.updated", "sheet.matched").
 * A wedding party reads the same events as sentences. One table serves the
 * Overview feed and the household page, so the two never word an event
 * differently.
 */

const LABELS: Record<string, string> = {
  "household.created": "Added to the guest list",
  "household.updated": "Details updated",
  "household.removed": "Removed from the guest list",
  "household.archived": "Removed from the guest list",
  "household.restored": "Put back on the guest list",
  "guest.added": "Guest added",
  "guest.updated": "Guest details updated",
  "guest.removed": "Guest removed",
  "rsvp.started": "Started their reply",
  "rsvp.saved": "Reply updated",
  "rsvp.completed": "Finished their reply",
  "rsvp.declined": "Said they cannot come",
  "plus_one.added": "Added a plus-one",
  "sheet.auto": "Save-the-date sign-up added",
  "sheet.auto_applied": "Save-the-date sign-up added",
  "sheet.match": "Matched to a save-the-date sign-up",
  "sheet.matched": "Matched to a save-the-date sign-up",
  "event.invites_changed": "Event invitations changed",
  "import.completed": "Guest list import finished",
  "table.assigned": "Seated at a table",
  "email.sent": "Email sent",
  "seating.published": "Seating shown to guests",
  "seating.unpublished": "Seating hidden from guests",
};

const ACTORS: Record<string, string> = {
  guest: "by the guest",
  admin: "by your team",
  system: "automatically",
};

/** "household.updated" → "Details updated". An unlisted action reads as plain words. */
export function activityLabel(action: string): string {
  const listed = LABELS[action];
  if (listed) return listed;
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "admin" → "by your team". An unlisted actor is left out. */
export function actorLabel(actorType: string | null | undefined): string {
  return (actorType && ACTORS[actorType]) || "";
}
