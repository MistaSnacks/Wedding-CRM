// One-off Save-the-Date check: match sheet responses against imported guests.
// Dry run — prints a report, writes nothing. Apply happens in a separate script.
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { readFileSync } from "node:fs";

const CSV = process.argv[2] ?? new URL("./std.csv", import.meta.url).pathname;
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ---------- normalization ----------
const norm = (s) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s) => norm(s).split(" ").filter(Boolean);

// ---------- Jaro-Winkler ----------
function jaro(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array(a.length).fill(false);
  const bM = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bM[j] && a[i] === b[j]) {
        aM[i] = bM[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}
function jaroWinkler(a, b) {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

// Surname token containment: "aw" vs "aw irwin" scores 1.0
function surnameScore(subLast, guestLast) {
  const a = tokens(subLast), b = tokens(guestLast);
  if (!a.length || !b.length) return 0;
  let best = 0;
  for (const ta of a)
    for (const tb of b)
      best = Math.max(best, ta === tb ? 1 : jaroWinkler(ta, tb));
  return best;
}

function givenScore(subFirst, guestFirst) {
  const a = tokens(subFirst), b = tokens(guestFirst);
  if (!a.length || !b.length) return 0;
  let best = 0;
  for (const ta of a)
    for (const tb of b) best = Math.max(best, jaroWinkler(ta, tb));
  return best;
}

// ---------- load ----------
const raw = readFileSync(CSV, "utf8");
const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
if (parsed.errors.length)
  console.error("CSV parse warnings:", JSON.stringify(parsed.errors.slice(0, 5)));

const { data: guests, error: gErr } = await supabase
  .from("guests")
  .select("id,first_name,last_name,origin,household_id,households(id,display_name,email,phone,mailing_address,preferred_locale,rsvp_status,internal_notes)");
if (gErr) throw new Error(gErr.message);

// ---------- match ----------
const submissions = parsed.data
  .map((r, i) => ({
    row: i + 2,
    receivedAt: r["Received At"]?.trim(),
    first: r["First Name"]?.trim() ?? "",
    last: r["Last Name"]?.trim() ?? "",
    address: r["Mailing Address"]?.trim() ?? "",
    email: r["Email"]?.trim() ?? "",
    phone: r["Phone"]?.trim() ?? "",
    notes: r["Notes"]?.trim() ?? "",
    noAddress: r["No Mailing Address"]?.trim() ?? "",
    language: r["Language"]?.trim() ?? "",
  }))
  .filter((s) => s.first || s.last || s.email);

const report = [];
for (const s of submissions) {
  const multiPerson = /[&\/]| and /i.test(s.first + " " + s.last);
  const optOut = /opt.?out/i.test(s.notes);
  const subFull = norm(`${s.first} ${s.last}`);

  const scored = guests
    .map((g) => {
      const gs = givenScore(s.first, g.first_name);
      const ss = surnameScore(s.last, g.last_name);
      return {
        guest: g,
        given: gs,
        surname: ss,
        score: 0.5 * gs + 0.5 * ss,
        exact: subFull === norm(`${g.first_name} ${g.last_name}`) && subFull.length > 0,
      };
    })
    .sort((x, y) => y.score - x.score);

  const top = scored[0];
  const second = scored.find(
    (c) => c.guest.household_id !== top?.guest.household_id,
  );
  // ambiguity penalty: a close second household undermines confidence
  const ambiguous = top && second && top.score - second.score < 0.08;

  let bucket;
  if (!top || top.score < 0.62) bucket = "no-match";
  else if (multiPerson) bucket = "review";
  else if (top.exact && !ambiguous) bucket = "exact";
  else if (top.score >= 0.85 && !ambiguous) bucket = "strong";
  else bucket = "review";

  report.push({
    row: s.row,
    submission: s,
    optOut,
    multiPerson,
    bucket,
    candidates: scored.slice(0, 3).map((c) => ({
      name: `${c.guest.first_name} ${c.guest.last_name}`,
      household: c.guest.households?.display_name,
      householdId: c.guest.household_id,
      score: +c.score.toFixed(3),
      given: +c.given.toFixed(3),
      surname: +c.surname.toFixed(3),
      exact: c.exact,
    })),
  });
}

// ---------- output ----------
const buckets = { exact: [], strong: [], review: [], "no-match": [] };
for (const r of report) buckets[r.bucket].push(r);

const langs = {};
for (const s of submissions) langs[s.language || "(blank)"] = (langs[s.language || "(blank)"] ?? 0) + 1;

console.log(JSON.stringify({
  totals: {
    submissions: submissions.length,
    exact: buckets.exact.length,
    strong: buckets.strong.length,
    review: buckets.review.length,
    noMatch: buckets["no-match"].length,
    optOuts: report.filter((r) => r.optOut).length,
    languages: langs,
  },
  report,
}, null, 1));
