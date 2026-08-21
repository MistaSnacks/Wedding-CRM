/**
 * Guest entry matcher — "type your name, open your RSVP".
 *
 * Juliet's wedding uses a single shared link (the paper invite's QR just opens
 * the site), so guests identify themselves by typing a household member's name
 * or the household email, and on a match we open the RSVP directly — no invite
 * code, no emailed link. The multi-tenant product keeps the emailed-link mode
 * as a per-wedding option (docs/superpowers/specs/2026-07-23-multi-tenant-
 * guest-entry-design.md); this matcher is its "shared link" delivery mode.
 *
 * Pure functions; no I/O. The caller enforces rate limiting, and the UI always
 * shows a confirm card before entering — never a silent match.
 */

export type EntryHousehold = {
  id: string;
  display_name: string;
  email: string | null;
  guests: { first_name: string; last_name: string }[];
};

/** What the search reveals to an unauthenticated visitor: enough to pick your
 * own household, nothing more (no email, no token, no last names). */
export type EntryMatch = { id: string; displayName: string; members: string[] };

export type EntrySearchResult =
  | { status: "too_short" }
  | { status: "none" }
  | { status: "matches"; matches: EntryMatch[] };

export const MAX_ENTRY_MATCHES = 3;

/** Accent-insensitive fold so "Jose Garcia" finds "José García" and
 * "Nguyen" finds "Nguyễn". NFD strips combining marks; Vietnamese đ/Đ does
 * not decompose, so it is folded explicitly. */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function scoreHousehold(q: string, qTokens: string[], h: EntryHousehold): number {
  let best = 0;
  for (const g of h.guests) {
    const full = foldName(`${g.first_name} ${g.last_name}`);
    if (!full) continue;
    if (full === q) {
      best = Math.max(best, 4);
      continue;
    }
    if (full.startsWith(q) || q.startsWith(full)) {
      best = Math.max(best, 3);
      continue;
    }
    // Order/middle-name tolerant: "Nguyen Linh" or "Sarah Anne Smith" still
    // finds the guest when one side's tokens are a subset of the other's.
    const gTokens = full.split(" ");
    if (qTokens.every((t) => gTokens.includes(t)) || gTokens.every((t) => qTokens.includes(t))) {
      best = Math.max(best, 3);
      continue;
    }
    if (full.includes(q)) best = Math.max(best, 2);
  }
  const dn = foldName(h.display_name);
  if (dn === q) best = Math.max(best, 4);
  else if (dn.includes(q)) best = Math.max(best, 1);
  return best;
}

function toMatch(h: EntryHousehold): EntryMatch {
  return { id: h.id, displayName: h.display_name, members: h.guests.map((g) => g.first_name) };
}

export function matchHouseholds(query: string, all: EntryHousehold[]): EntrySearchResult {
  const raw = query.trim();

  // An email identifies the household exactly (case-insensitive equality).
  if (raw.includes("@")) {
    const q = raw.toLowerCase();
    const hits = all.filter((h) => (h.email ?? "").trim().toLowerCase() === q);
    return hits.length
      ? { status: "matches", matches: hits.slice(0, MAX_ENTRY_MATCHES).map(toMatch) }
      : { status: "none" };
  }

  // Names need first + last: single tokens ("Maria") would match half the
  // guest list and turn the confirm step into a directory browse.
  const q = foldName(raw);
  const qTokens = q.split(" ").filter(Boolean);
  if (q.length < 4 || qTokens.length < 2) return { status: "too_short" };

  const scored = all
    .map((h) => ({ h, score: scoreHousehold(q, qTokens, h) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.h.display_name.localeCompare(b.h.display_name));

  if (scored.length === 0) return { status: "none" };
  return { status: "matches", matches: scored.slice(0, MAX_ENTRY_MATCHES).map((x) => toMatch(x.h)) };
}
