/**
 * Review-before-send: the composer must show who a campaign reaches before
 * anything goes out. The token pins what was reviewed; send refuses when the
 * audience shifted underneath it.
 */
export function splitRecipients<T extends { email: string | null }>(
  households: T[],
): { emailable: T[]; skipped: T[] } {
  const emailable: T[] = [];
  const skipped: T[] = [];
  for (const h of households) (h.email ? emailable : skipped).push(h);
  return { emailable, skipped };
}

export function reviewToken(count: number, audience: string, type: string): string {
  return Buffer.from(JSON.stringify({ count, audience, type })).toString("base64url");
}

export function tokenMatches(token: string, count: number, audience: string, type: string): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    return parsed.count === count && parsed.audience === audience && parsed.type === type;
  } catch {
    return false;
  }
}
