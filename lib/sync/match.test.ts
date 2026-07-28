import { describe, expect, it } from "vitest";
import { classify, normalizeName, scoreCandidates, type MatchCandidateInput, type MatchSubmission } from "./match";

const sub = (first: string, last: string, over: Partial<MatchSubmission> = {}): MatchSubmission => ({
  first,
  last,
  email: "",
  notes: "",
  ...over,
});

const guest = (
  firstName: string,
  lastName: string,
  householdName: string,
  over: Partial<MatchCandidateInput> = {},
): MatchCandidateInput => ({
  guestId: `g:${firstName} ${lastName}`,
  firstName,
  lastName,
  householdId: `h:${householdName}`,
  householdName,
  householdEmail: null,
  ...over,
});

// The real master list, trimmed to the households that make each case hard.
const MASTER: MatchCandidateInput[] = [
  guest("Alison", "Aw-Irwin", "Alison Aw-Irwin & Bryan Irwin"),
  guest("Bryan", "Irwin", "Alison Aw-Irwin & Bryan Irwin"),
  guest("Cecila", "Garza Cohoon", "Cecila Garza Cohoon & Jason Cohoon"),
  guest("Amadeo", "Cruz", "Amadeo Cruz & Rose"),
  guest("Armando", "Cruz-Rincon", "Cruz-Rincon Family"),
  guest("Christine", "Le", "Christine Dinh & John Le"),
  guest("Viridiana", "Del Muro", "Viridiana Del Muro and David"),
  guest("Miriam", "Jauregui", "Jauregui Household 3"),
  guest("Cau Tuan", "Huyền", "Cau Tuan Huyen"),
  guest("Ana", "Muñoz", "Ana Muñoz"),
  guest("Julie", "Nguyen", "Julie Nguyen Tinsley & Joseph Tinsley"),
  guest("Joseph", "Tinsley", "Julie Nguyen Tinsley & Joseph Tinsley"),
];

const top = (s: MatchSubmission) => scoreCandidates(s, MASTER)[0];

describe("normalizeName", () => {
  it("strips diacritics, case and punctuation", () => {
    expect(normalizeName("Huyền")).toBe("huyen");
    expect(normalizeName("Muñoz")).toBe("munoz");
    expect(normalizeName("Aw-Irwin")).toBe("aw irwin");
    expect(normalizeName("  O'Brien  ")).toBe("o brien");
  });
});

describe("scoreCandidates", () => {
  it("scores a maiden name highly via surname containment", () => {
    const t = top(sub("Alison", "Aw"));
    expect(t.householdName).toBe("Alison Aw-Irwin & Bryan Irwin");
    expect(t.surname).toBe(1);
    expect(t.reasons.join(" ")).toContain("Aw");
  });

  it("handles an all-caps hyphenated surname", () => {
    expect(top(sub("CECILIA", "GARZA")).householdName).toBe("Cecila Garza Cohoon & Jason Cohoon");
  });

  it("finds a person inside a long formal name", () => {
    expect(top(sub("Blanca Viridiana", "Jauregui del Muro")).householdName).toBe(
      "Viridiana Del Muro and David",
    );
  });

  it("explains why it scored, in words a person can check", () => {
    const t = top(sub("Alison", "Aw"));
    expect(t.reasons.some((r) => /contained in/i.test(r))).toBe(true);
  });

  it("does not crash on an empty master list", () => {
    expect(scoreCandidates(sub("Anyone", "Atall"), [])).toEqual([]);
  });
});

describe("classify", () => {
  it("auto-applies only on an exact email match", () => {
    const withEmail = MASTER.map((g) =>
      g.householdName === "Amadeo Cruz & Rose" ? { ...g, householdEmail: "Amadeo@Example.com " } : g,
    );
    const s = sub("Amadeo", "Guiao", { email: "amadeo@example.com" });
    const c = classify(s, scoreCandidates(s, withEmail), withEmail);
    expect(c.bucket).toBe("auto_email");
  });

  // The unrecoverable cases: different surname entirely, no shared token.
  // A matcher that "solves" these is overfitted and would write a stranger's
  // address onto a household.
  it("must NOT auto-match Amadeo Guiao to Amadeo Cruz", () => {
    const s = sub("Amadeo", "Guiao", { email: "amadeoguiao@gmail.com" });
    expect(classify(s, scoreCandidates(s, MASTER), MASTER).bucket).not.toBe("auto_email");
  });

  it("must NOT auto-match Christine Dinh to Christine Le", () => {
    const s = sub("Christine", "Dinh", { email: "christine.p.dinh@gmail.com" });
    expect(classify(s, scoreCandidates(s, MASTER), MASTER).bucket).not.toBe("auto_email");
  });

  it("sends a perfect name match to review anyway", () => {
    const s = sub("Alison", "Aw");
    const c = classify(s, scoreCandidates(s, MASTER), MASTER);
    expect(c.bucket).toBe("review");
    if (c.bucket === "review") expect(c.candidates[0].householdName).toContain("Aw-Irwin");
  });

  it("flags a multi-person row instead of splitting it", () => {
    const s = sub("Julie & Joseph", "Nguyen-Tinsley");
    const c = classify(s, scoreCandidates(s, MASTER), MASTER);
    expect(c.bucket).toBe("review");
    if (c.bucket === "review") expect(c.multiPerson).toBe(true);
  });

  it("treats a slash-separated row as multi-person too", () => {
    const s = sub("Chelsea / Max", "Djenohan");
    const c = classify(s, scoreCandidates(s, MASTER), MASTER);
    if (c.bucket === "review") expect(c.multiPerson).toBe(true);
  });

  it("notes ambiguity when a second household scores close behind", () => {
    const pair: MatchCandidateInput[] = [
      guest("Linh", "Pham", "Linh Pham & Alex Sanchez"),
      guest("Linh", "Phan", "Linh Phan & Duc Phan"),
    ];
    const s = sub("Linh", "Pham");
    const c = classify(s, scoreCandidates(s, pair), pair);
    expect(c.bucket).toBe("review");
    if (c.bucket === "review") {
      expect(c.candidates[0].reasons.some((r) => /another household/i.test(r))).toBe(true);
    }
  });

  it("reports no match when nobody is close", () => {
    const s = sub("Brigitte", "Fabre");
    expect(classify(s, scoreCandidates(s, MASTER), MASTER).bucket).toBe("no_match");
  });

  it("normalizes Vietnamese and Spanish names without mangling them", () => {
    expect(top(sub("Cau Tuan", "Huyen")).householdName).toBe("Cau Tuan Huyen");
    expect(top(sub("Ana", "Munoz")).householdName).toBe("Ana Muñoz");
  });
});
