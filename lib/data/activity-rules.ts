/**
 * Which activity belongs in the Overview's guest feed.
 *
 * This is an allowlist, and that is the whole point of it.
 *
 * It used to be a denylist — "everything except `changelog.seen`" — which meant
 * the panel headed "Recent RSVPs" silently adopted every new kind of activity
 * the app would ever log. The budget module was the first feature added after
 * that panel shipped, and it broke it immediately: nine `budget.*` and
 * `payment.*` rows pushed the actual replies off the list, each rendering an em
 * dash where a household name belongs and the raw string "budget item_updated"
 * underneath it. A denylist opts new features in by default and only fails once
 * a human notices; an allowlist makes whoever adds `vendor.booked` decide, in
 * the same commit, whether a bride wants to read about it next to her RSVPs.
 *
 * Prefixes rather than exact names, because the guest domain keeps growing new
 * verbs (`rsvp.completed`, `rsvp.started`, `rsvp.declined`) and every one of
 * them belongs here for the same reason.
 */
export const GUEST_FEED_PREFIXES = [
  "rsvp.",
  "plus_one.",
  "household.",
  "guest.",
  "import.",
  "table.",
  "seat.",
] as const;

/** True when this action is about a guest, and so belongs in the Overview feed. */
export function isGuestFeedAction(action: string): boolean {
  return GUEST_FEED_PREFIXES.some((prefix) => action.startsWith(prefix));
}

/**
 * Narrow a page of activity to the guest feed, newest first, capped at `limit`.
 *
 * Separated from the query so the filtering is testable: `lib/data/activity.ts`
 * does I/O, and vitest only sees `lib/**` — but a rule that decides what a user
 * reads on the front page should never live somewhere untested.
 */
export function selectGuestFeed<T extends { action: string }>(rows: T[], limit: number): T[] {
  return rows.filter((row) => isGuestFeedAction(row.action)).slice(0, limit);
}
