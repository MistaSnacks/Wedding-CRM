import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await serverClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${env().NEXT_PUBLIC_APP_URL}/admin`);
}
