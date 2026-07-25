// Usage: node scripts/verify-import-rpc.mjs
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const WEDDING = "11111111-1111-1111-1111-111111111111";

const count = async () =>
  (await db.from("households").select("id", { count: "exact", head: true }).eq("wedding_id", WEDDING)).count;

const before = await count();

const { data: run } = await db
  .from("imports")
  .insert({ wedding_id: WEDDING, filename: "rpc-verify.csv", status: "validated" })
  .select("id")
  .single();

// Rollback check: second household has a null display_name, violating NOT NULL.
const bad = [
  { displayName: "RPC Verify Good", maxPartySize: 1, plusOneSlots: 0, tags: [], guests: [{ firstName: "A", lastName: "B" }], inviteCode: "VRFY-0001", accessToken: "verify-token-0001" },
  { displayName: null, maxPartySize: 1, plusOneSlots: 0, tags: [], guests: [], inviteCode: "VRFY-0002", accessToken: "verify-token-0002" },
];
const { error: badErr } = await db.rpc("import_households", {
  p_wedding_id: WEDDING, p_run_id: run.id, p_households: bad,
});
const afterBad = await count();
console.log(badErr ? "rollback: errored as expected" : "rollback: NO ERROR — FAIL");
if (!badErr) process.exitCode = 1;
console.log(afterBad === before ? "rollback: no rows written — PASS" : `rollback: leaked ${afterBad - before} rows — FAIL`);
if (afterBad !== before) process.exitCode = 1;

// Success check.
const good = [
  { displayName: "RPC Verify Household", maxPartySize: 2, plusOneSlots: 1, tags: ["verify"], guests: [{ firstName: "Ver", lastName: "Ify" }], inviteCode: "VRFY-0003", accessToken: "verify-token-0003" },
];
const { data: ok, error: okErr } = await db.rpc("import_households", {
  p_wedding_id: WEDDING, p_run_id: run.id, p_households: good,
});
console.log(okErr ? `commit: FAILED ${okErr.message}` : `commit: PASS ${JSON.stringify(ok)}`);
if (okErr) process.exitCode = 1;

// Clean up.
await db.from("households").delete().eq("wedding_id", WEDDING).like("display_name", "RPC Verify%");
await db.from("imports").delete().eq("id", run.id);
console.log("cleaned up");
