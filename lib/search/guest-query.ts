/**
 * The one search behavior used everywhere in the admin: header search and the
 * guest list both filter with this, so "Huyen" finds Huyền in either place.
 */
export type SearchableHousehold = {
  display_name: string;
  email: string | null;
  phone: string | null;
  guests: Array<{ first_name: string; last_name: string }>;
};

export function normalizeQuery(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const digits = (s: string): string => s.replace(/\D/g, "");

export function matchesGuestQuery(query: string, h: SearchableHousehold): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;

  const haystacks = [
    normalizeQuery(h.display_name),
    ...h.guests.map((g) => normalizeQuery(`${g.first_name} ${g.last_name}`)),
    h.email ? normalizeQuery(h.email) : "",
    h.phone ? digits(h.phone) : "",
  ];

  // Every token must land somewhere; a token that is all digits also gets to
  // try the digits-only phone haystack.
  return q.split(" ").every((token) => {
    const tokenDigits = digits(token);
    return haystacks.some(
      (hay) =>
        hay.includes(token) ||
        (tokenDigits.length >= 3 && hay && !hay.includes(" ") && /^\d+$/.test(hay) && hay.includes(tokenDigits)),
    );
  });
}
