/**
 * Matching Save-the-Date form responses against the imported guest list.
 *
 * Pure by design so the hard cases are unit tests rather than a database and a
 * network. The scoring below was validated against all 72 real responses.
 *
 * The governing rule: **only identity auto-applies.** An exact normalized email
 * match is identity. A name match — at any score, including 1.0 — is a
 * similarity, and similarity goes to a human. Surnames change on marriage in
 * ways no algorithm recovers (`Amadeo Guiao`→`Amadeo Cruz`,
 * `Christine Dinh`→`Christine Le` are both real), so a matcher confident enough
 * to auto-apply a name is a matcher that will eventually write a stranger's
 * address onto a household.
 */

export type MatchSubmission = {
  first: string;
  last: string;
  email: string;
  notes?: string;
};

export type MatchCandidateInput = {
  guestId: string;
  firstName: string;
  lastName: string;
  householdId: string;
  householdName: string;
  householdEmail: string | null;
};

export type ScoredCandidate = {
  guestId: string;
  guestName: string;
  householdId: string;
  householdName: string;
  given: number;
  surname: number;
  score: number;
  reasons: string[];
};

export type Classification =
  | { bucket: "auto_email"; householdId: string; reason: string }
  | { bucket: "review"; candidates: ScoredCandidate[]; multiPerson: boolean }
  | { bucket: "no_match" };

/** Below this a candidate is noise, not a suggestion. */
const CANDIDATE_FLOOR = 0.62;
/** A runner-up this close means the top score is not trustworthy on its own. */
const AMBIGUITY_GAP = 0.08;
const MAX_CANDIDATES = 3;

export function normalizeName(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizeEmail = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

const tokens = (s: string): string[] => normalizeName(s).split(" ").filter(Boolean);

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array(a.length).fill(false);
  const bMatched = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = bMatched[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

/**
 * Surnames use token containment rather than whole-string similarity, because
 * the common real-world change is an *added* name, not a corrupted one: `Aw`
 * against `Aw-Irwin`, `Garza` against `Garza-Cohoon`.
 */
function surnameScore(subLast: string, guestLast: string): { score: number; exactToken: string | null } {
  const a = tokens(subLast);
  const b = tokens(guestLast);
  if (!a.length || !b.length) return { score: 0, exactToken: null };
  let best = 0;
  let exactToken: string | null = null;
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb) {
        if (best < 1) exactToken = ta;
        best = 1;
      } else {
        best = Math.max(best, jaroWinkler(ta, tb));
      }
    }
  }
  return { score: best, exactToken };
}

function givenScore(subFirst: string, guestFirst: string): number {
  const a = tokens(subFirst);
  const b = tokens(guestFirst);
  if (!a.length || !b.length) return 0;
  let best = 0;
  for (const ta of a) for (const tb of b) best = Math.max(best, jaroWinkler(ta, tb));
  return best;
}

/** `Julie & Joseph`, `Chelsea / Max` — one row, two people. Never split automatically. */
export function isMultiPerson(s: MatchSubmission): boolean {
  return /[&/]|\band\b/i.test(`${s.first} ${s.last}`);
}

export function scoreCandidates(
  submission: MatchSubmission,
  pool: MatchCandidateInput[],
): ScoredCandidate[] {
  const scored = pool
    .map((c) => {
      const given = givenScore(submission.first, c.firstName);
      const { score: surname, exactToken } = surnameScore(submission.last, c.lastName);
      const reasons: string[] = [];

      if (given === 1) reasons.push(`given name ${submission.first} matches ${c.firstName}`);
      else if (given >= 0.85) reasons.push(`given name ${submission.first} is close to ${c.firstName}`);

      if (surname === 1 && exactToken && normalizeName(submission.last) !== normalizeName(c.lastName)) {
        reasons.push(`surname ${exactToken} is contained in ${c.lastName}`);
      } else if (surname === 1) {
        reasons.push(`surname ${c.lastName} matches`);
      } else if (surname >= 0.8) {
        reasons.push(`surname ${submission.last} is close to ${c.lastName}`);
      }

      return {
        guestId: c.guestId,
        guestName: `${c.firstName} ${c.lastName}`,
        householdId: c.householdId,
        householdName: c.householdName,
        given,
        surname,
        score: 0.5 * given + 0.5 * surname,
        reasons,
      };
    })
    // A candidate we cannot explain is not a candidate. Short names collide by
    // chance often enough to clear the floor on raw score alone, and offering
    // an unexplained suggestion next to a one-click "this is them" button is
    // how a stranger's address ends up on somebody's household.
    .filter((c) => c.score >= CANDIDATE_FLOOR && c.reasons.length > 0)
    .sort((a, b) => b.score - a.score);

  // Ambiguity is a property of the *set*, so it is annotated after sorting:
  // a close runner-up in a different household matters more than the raw score.
  const runnerUp = scored.find((c) => c.householdId !== scored[0]?.householdId);
  if (scored[0] && runnerUp && scored[0].score - runnerUp.score < AMBIGUITY_GAP) {
    scored[0].reasons.push(`another household (${runnerUp.householdName}) scores nearly as high`);
  }

  return scored.slice(0, MAX_CANDIDATES);
}

export function classify(
  submission: MatchSubmission,
  candidates: ScoredCandidate[],
  pool: MatchCandidateInput[],
): Classification {
  const email = normalizeEmail(submission.email);
  if (email) {
    const identity = pool.find((c) => normalizeEmail(c.householdEmail) === email);
    if (identity) {
      return {
        bucket: "auto_email",
        householdId: identity.householdId,
        reason: `${email} already belongs to ${identity.householdName}`,
      };
    }
  }
  if (!candidates.length) return { bucket: "no_match" };
  return { bucket: "review", candidates, multiPerson: isMultiPerson(submission) };
}
