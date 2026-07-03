import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get("NEXT_LOCALE")?.value;
  const locale = cookieLocale === "es" || cookieLocale === "vi" ? cookieLocale : "en";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
