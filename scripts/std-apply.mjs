// One-off Save-the-Date apply: writes the reviewed matches to the DB.
// Fill-blanks-only; every change logged with prior values for undo.
import { createClient } from "@supabase/supabase-js";
import { customAlphabet } from "nanoid";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync } from "node:fs";

const REPORT = process.argv[2];
const LOG = process.argv[3] ?? REPORT.replace(/report\.json$/, "applied-log.json");
const WEDDING_ID = "11111111-1111-1111-1111-111111111111";

const codeAlphabet = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 8);
const newInviteCode = () => { const r = codeAlphabet(); return `${r.slice(0, 4)}-${r.slice(4)}`; };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { report } = JSON.parse(readFileSync(REPORT, "utf8"));

// Reviewed decisions, keyed by CSV row. cand = index into candidates.
const OVERRIDES = {
  6: { cand: 0 },   // Julie & Joseph -> their household
  16: { cand: 1 },  // Michael and Monica Joplin -> Monica Turner-Joplin & Mike Joplin
  23: { cand: 0 },  // Vivian -> Vivan (typo in master)
  27: { cand: 0 },  // Nikki Johnson -> Nikki Plantilla & Troy
  36: { cand: 1 },  // Linh Karimian -> Linh Nguyen & Shahin Karimian
  60: { cand: 0 },  // Amadeo Guiao -> Amadeo Cruz & Rose (human-confirmed)
  61: { new: true },   // Christine Dinh
  63: { new: true },   // Ty Huynh (opt-out -> declined)
  69: { new: true },   // Brigitte Fabre
  71: { cand: 0 },  // Djenohan
  72: { cand: 0 },  // Djenohan duplicate
};

const log = [];
const state = new Map(); // householdId -> current row, tracked across updates

async function household(id) {
  if (state.has(id)) return state.get(id);
  const { data, error } = await supabase
    .from("households")
    .select("id,display_name,email,phone,mailing_address,preferred_locale,rsvp_status,internal_notes")
    .eq("id", id)
    .single();
  if (error) throw new Error(`fetch ${id}: ${error.message}`);
  state.set(id, data);
  return data;
}

for (const item of report.sort((a, b) => a.row - b.row)) {
  const s = item.submission;
  const o = OVERRIDES[item.row];
  const decision = o ?? (item.bucket === "exact" || item.bucket === "strong" ? { cand: 0 } : null);
  if (!decision) throw new Error(`row ${item.row} (${s.first} ${s.last}) has no decision`);

  if (decision.new) {
    const invite_code = newInviteCode();
    const access_token = randomBytes(16).toString("hex");
    const hh = {
      wedding_id: WEDDING_ID,
      display_name: `${s.first} ${s.last}`.trim(),
      primary_contact_name: `${s.first} ${s.last}`.trim(),
      email: s.email || null,
      phone: s.phone || null,
      mailing_address: s.address ? { raw: s.address, source: "save_the_date" } : null,
      preferred_locale: s.language || "en",
      invite_code,
      access_token,
      max_party_size: 1,
      plus_one_slots: 0,
      rsvp_status: item.optOut ? "declined" : "pending",
      internal_notes: s.notes ? `[Save the Date ${s.receivedAt}] ${s.notes}` : null,
    };
    const { data: created, error } = await supabase.from("households").insert(hh).select("id").single();
    if (error) throw new Error(`insert household row ${item.row}: ${error.message}`);
    const { error: gErr } = await supabase.from("guests").insert({
      wedding_id: WEDDING_ID,
      household_id: created.id,
      first_name: s.first.trim(),
      last_name: s.last.trim(),
      origin: "named",
    });
    if (gErr) throw new Error(`insert guest row ${item.row}: ${gErr.message}`);
    log.push({ row: item.row, action: "created", householdId: created.id, name: hh.display_name, declined: item.optOut });
    continue;
  }

  const cand = item.candidates[decision.cand];
  const before = await household(cand.householdId);
  const update = {};
  const changes = {};

  const fill = (field, value) => {
    if (value && !before[field]) { update[field] = value; changes[field] = { from: before[field], to: value }; }
  };
  fill("email", s.email || null);
  fill("phone", s.phone || null);
  fill("mailing_address", s.address ? { raw: s.address, source: "save_the_date" } : null);
  if (s.language && s.language !== "en" && before.preferred_locale === "en") {
    update.preferred_locale = s.language;
    changes.preferred_locale = { from: "en", to: s.language };
  }
  if (s.notes) {
    const line = `[Save the Date ${s.receivedAt}] ${s.notes}`;
    if (!(before.internal_notes ?? "").includes(line)) {
      update.internal_notes = before.internal_notes ? `${before.internal_notes}\n${line}` : line;
      changes.internal_notes = { appended: line };
    }
  }
  if (item.optOut && before.rsvp_status === "pending") {
    update.rsvp_status = "declined";
    changes.rsvp_status = { from: before.rsvp_status, to: "declined" };
  }

  if (Object.keys(update).length === 0) {
    log.push({ row: item.row, action: "no-op", householdId: cand.householdId, household: cand.household });
    continue;
  }
  const { error } = await supabase.from("households").update(update).eq("id", cand.householdId);
  if (error) throw new Error(`update row ${item.row}: ${error.message}`);
  state.set(cand.householdId, { ...before, ...update });
  log.push({ row: item.row, action: "updated", householdId: cand.householdId, household: cand.household, submitter: `${s.first} ${s.last}`, changes });
}

writeFileSync(LOG, JSON.stringify(log, null, 1));
const counts = log.reduce((a, l) => ((a[l.action] = (a[l.action] ?? 0) + 1), a), {});
console.log("done:", JSON.stringify(counts), "log:", LOG);
