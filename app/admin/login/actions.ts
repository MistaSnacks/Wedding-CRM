"use server";

import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/limiter";
import { headers } from "next/headers";

export async function sendMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) redirect("/admin/login?error=invalid");

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = await rateLimit(`admin-login:${ip}`, { limit: 5, windowSec: 300 });
  if (!limit.ok) redirect("/admin/login?error=rate_limited");

  const supabase = await serverClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/admin/auth/callback` },
  });
  if (error) redirect("/admin/login?error=send_failed");
  redirect("/admin/login?sent=1");
}

export async function signOut(): Promise<void> {
  const supabase = await serverClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
