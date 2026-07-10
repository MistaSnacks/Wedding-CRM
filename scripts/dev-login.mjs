#!/usr/bin/env node
// Dev-only admin login.
//
// Mints a one-time magic-link token with the service-role key and prints a
// direct callback URL. Bypasses email delivery AND Supabase's redirect
// allow-list, so it works on whatever local port NEXT_PUBLIC_APP_URL points at
// (defaults to http://localhost:3006).
//
// Usage:  node scripts/dev-login.mjs [email]
//   or:   npm run dev:login -- you@example.com
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
const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3006";
const email = process.argv[2] || "camren@gettailor.ai";

if (!supaUrl || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const res = await fetch(`${supaUrl}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("generate_link failed:", res.status, JSON.stringify(data));
  process.exit(1);
}

const tokenHash = data.hashed_token ?? data.properties?.hashed_token;
if (!tokenHash) {
  console.error("No hashed_token in response:", JSON.stringify(data));
  process.exit(1);
}

const url = `${appUrl}/admin/auth/callback?token_hash=${tokenHash}&type=magiclink`;
console.log(`\n  Admin dev login for ${email} (one-time, ~1h):\n\n  ${url}\n`);
