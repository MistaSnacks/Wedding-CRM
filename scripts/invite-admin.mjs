#!/usr/bin/env node
// Invite someone to the admin dashboard.
//
// 1. Sends a Supabase auth invite email (free built-in send, custom template
//    in supabase/templates/invite.html — includes the guest-site test codes).
// 2. Grants dashboard access by inserting their wedding_members row.
//
// Pass --link to also print a direct sign-in URL (valid ~1 hour) you can
// text/email yourself in case Supabase's built-in delivery is slow or the
// project is restricted to team-member addresses.
//
// Usage:  node scripts/invite-admin.mjs juliet@example.com [--role editor] [--link]
import { readFileSync } from "node:fs";

const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {
  console.error("Could not read .env.local next to the project root.");
  process.exit(1);
}

const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const WEDDING_ID = "11111111-1111-1111-1111-111111111111";
const PROD_URL = "https://guest-crm-camrens-projects-24b42280.vercel.app";

const args = process.argv.slice(2);
const email = args.find((a) => a.includes("@"));
const role = args.includes("--role") ? args[args.indexOf("--role") + 1] : "editor";
const wantLink = args.includes("--link");

if (!email) {
  console.error("Usage: node scripts/invite-admin.mjs <email> [--role owner|editor|viewer] [--link]");
  process.exit(1);
}
if (!supaUrl || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

// 1. Invite (creates the auth user + sends the templated email).
//    If they already have an account, fall back to a plain magic link.
let userId = null;
let inviteRes = await fetch(`${supaUrl}/auth/v1/invite`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ email }),
});
let invite = await inviteRes.json().catch(() => ({}));

if (inviteRes.ok) {
  userId = invite.id;
  console.log(`✓ Invite email sent to ${email} (user ${userId})`);
} else if (/already/i.test(invite.msg ?? invite.message ?? invite.error_description ?? "")) {
  const users = await (
    await fetch(`${supaUrl}/auth/v1/admin/users?per_page=200`, { headers: H })
  ).json();
  const existing = (users.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) {
    console.error("User reported as existing but not found:", invite);
    process.exit(1);
  }
  userId = existing.id;
  console.log(`• ${email} already has an account (${userId}) — skipping invite email.`);
  console.log("  They can sign in any time at /admin/login (magic link).");
} else {
  console.error("Invite failed:", inviteRes.status, invite);
  process.exit(1);
}

// 2. Grant dashboard access (idempotent).
const memberRes = await fetch(
  `${supaUrl}/rest/v1/wedding_members?on_conflict=wedding_id,user_id`,
  {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ wedding_id: WEDDING_ID, user_id: userId, role }),
  },
);
if (!memberRes.ok) {
  console.error("Membership insert failed:", memberRes.status, await memberRes.text());
  process.exit(1);
}
console.log(`✓ Dashboard access granted (role: ${role})`);

// 3. Optional direct sign-in link (fallback if email delivery fails).
if (wantLink) {
  const linkRes = await fetch(`${supaUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const link = await linkRes.json().catch(() => ({}));
  if (link.hashed_token) {
    console.log("\nDirect sign-in link (expires in ~1 hour — send it to them yourself):");
    console.log(`${PROD_URL}/admin/auth/callback?token_hash=${link.hashed_token}&type=magiclink`);
  } else {
    console.error("Could not generate link:", link);
  }
}

console.log(`\nGuest side:  ${PROD_URL}/rsvp`);
console.log("Test codes:  TEST-AAA1 (couple)  TEST-AAA2 (plus-one)  TEST-AAA3 (family of four)");
