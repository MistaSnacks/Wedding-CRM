/**
 * What's new, written for the couple rather than for us.
 *
 * Newest first. `id` is what gets stored once someone has read it, so ids must
 * never be reused or reordered — adding a new entry at the top is the only
 * edit this list should normally get.
 *
 * Keep entries about what she can now *do*. Anything she cannot see or use
 * does not belong here.
 */
export type ChangelogEntry = {
  id: string;
  date: string;
  title: string;
  items: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-07-28-sync",
    date: "July 28",
    title: "Save-the-Date replies come to you",
    items: [
      "Everyone's addresses, emails and phone numbers from the Save-the-Date form are now on their guest entries — no more cross-referencing the spreadsheet.",
      "New replies are checked once a week. Anything we're certain about is filled in for you; anything we're not sure about waits in a short list on Imports & Exports for you to decide.",
      "Every suggestion tells you why it matched, and anything applied can be undone.",
    ],
  },
  {
    id: "2026-07-26-usability",
    date: "July 26",
    title: "Easier to use, and it works on your phone",
    items: [
      "The whole dashboard now works properly on a phone, so you can check things on the go.",
      "Search actually searches as you type — from the bar at the top of any page, or on the Guests page. Accents don't matter, so \"huyen\" finds \"Huyền\".",
      "Mailing addresses are visible and editable on each household, and we tell you where each one came from.",
      "Emails now show you exactly who will receive them and what they'll look like before anything sends — and you can send yourself a test first.",
    ],
  },
  {
    id: "2026-07-26-events",
    date: "July 26",
    title: "Events are yours to manage",
    items: [
      "Add, edit and reorder events like the rehearsal dinner yourself.",
      "Choose whether an event is for everyone or just the people you pick, and tick exactly who's invited.",
      "Exports are grouped by what you need them for, with one button for Excel or CSV.",
    ],
  },
  {
    id: "2026-07-25-import",
    date: "July 25",
    title: "Your guest list is in",
    items: [
      "All 164 households from the master spreadsheet are loaded, grouped the way the invitations will actually be addressed.",
      "You can fix problem rows right on the screen instead of re-uploading a corrected file.",
      "Nothing is ever saved until you say so — you always see what we found first.",
    ],
  },
];

export const LATEST_CHANGELOG_ID = CHANGELOG[0]?.id ?? "";

/** Entries this person hasn't read yet. Never seen anything → show them all. */
export function unseenEntries(lastSeenId: string | null | undefined): ChangelogEntry[] {
  if (!lastSeenId) return CHANGELOG;
  const index = CHANGELOG.findIndex((e) => e.id === lastSeenId);
  // An unrecognised id (an entry we removed, or a much older install) is safest
  // treated as "up to date" rather than replaying the whole history at her.
  if (index === -1) return [];
  return CHANGELOG.slice(0, index);
}
