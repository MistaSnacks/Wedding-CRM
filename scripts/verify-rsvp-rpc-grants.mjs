// Usage: node scripts/verify-rsvp-rpc-grants.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY in .env.local
//
// Verifies migration 0005_revoke_submit_rsvp_grants.sql took effect in both
// directions:
//   1. anon (the key shipped to every browser) must be blocked from calling
//      submit_rsvp at all — expect Postgres error 42501 (permission denied
//      for function), not a function-level error.
//   2. service_role (the only real caller, via lib/data/scope.ts) must still
//      be able to execute the function — proven with a deliberately
//      non-existent household id, so nothing is mutated.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const anonDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const adminDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const NONEXISTENT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000";

// 1. anon must be blocked outright.
const { error: anonErr } = await anonDb.rpc("submit_rsvp", {
  p_household_id: NONEXISTENT_HOUSEHOLD_ID,
  p_payload: {},
});
if (!anonErr) {
  console.log("anon: NO ERROR — FAIL (submit_rsvp executed with the anon key)");
  process.exitCode = 1;
} else if (anonErr.code === "42501") {
  console.log(`anon: PASS — permission denied for function (${anonErr.code} ${anonErr.message})`);
} else {
  console.log(`anon: FAIL — expected 42501, got ${anonErr.code} ${anonErr.message}`);
  process.exitCode = 1;
}

// 2. service_role must still be able to execute (grant preserved). Using a
// non-existent household id so the function raises before touching any row —
// this probe mutates nothing.
const { error: adminErr } = await adminDb.rpc("submit_rsvp", {
  p_household_id: NONEXISTENT_HOUSEHOLD_ID,
  p_payload: {},
});
if (!adminErr) {
  console.log("service_role: NO ERROR — FAIL (expected 'household not found')");
  process.exitCode = 1;
} else if (adminErr.code === "P0001" && /household not found/i.test(adminErr.message)) {
  console.log(`service_role: PASS — function executed, lookup failed as expected (${adminErr.code} ${adminErr.message})`);
} else {
  console.log(`service_role: FAIL — expected P0001 'household not found', got ${adminErr.code} ${adminErr.message}`);
  process.exitCode = 1;
}
