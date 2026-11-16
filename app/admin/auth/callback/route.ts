import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (code) {
    // PKCE flow: the emailed link redirects here with ?code=
    const supabase = await serverClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error)
      return NextResponse.redirect(
        `${env().NEXT_PUBLIC_APP_URL}/admin/login?error=expired_link`,
      );
  } else if (tokenHash && type) {
    // token_hash flow: works for admin-generated links (no email needed,
    // no PKCE verifier) — the standard Supabase SSR verify pattern.
    const supabase = await serverClient();
    if (!["invite", "magiclink", "email"].includes(type))
      return NextResponse.redirect(
        `${env().NEXT_PUBLIC_APP_URL}/admin/login?error=expired_link`,
      );
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error)
      return NextResponse.redirect(
        `${env().NEXT_PUBLIC_APP_URL}/admin/login?error=expired_link`,
      );
  } else
    return NextResponse.redirect(
      `${env().NEXT_PUBLIC_APP_URL}/admin/login?error=expired_link`,
    );
  return NextResponse.redirect(`${env().NEXT_PUBLIC_APP_URL}/admin`);
}
