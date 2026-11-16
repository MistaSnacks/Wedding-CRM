import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

import { adminDb } from "@/lib/supabase/admin";
import { DEFAULT_WEDDING_ID } from "@/lib/data/scope";

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get("NEXT_LOCALE")?.value;
  const h = await headers();
  const path = h.get("x-app-path") ?? "";
  let preferred: string | undefined;
  if (!cookieLocale && path.startsWith("/rsvp/h/")) {
    const { data } = await adminDb()
      .from("households")
      .select("preferred_locale")
      .eq("wedding_id", DEFAULT_WEDDING_ID)
      .eq("access_token", path.split("/")[3])
      .maybeSingle();
    preferred = data?.preferred_locale;
  }
  const browser = (h.get("accept-language") ?? "").split(",")[0].split("-")[0];
  const choice = path.startsWith("/admin")
    ? "en"
    : (cookieLocale ?? preferred ?? browser);
  const locale = choice === "es" || choice === "vi" ? choice : "en";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
