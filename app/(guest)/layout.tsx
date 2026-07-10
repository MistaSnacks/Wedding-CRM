import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { LanguageSwitcher } from "@/components/guest/LanguageSwitcher";
import { FilmBackdrop } from "@/components/FilmBackdrop";

export default async function GuestLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="relative min-h-dvh watercolor-bg overflow-hidden">
        <FilmBackdrop />
        <div className="relative z-10 flex min-h-dvh flex-col">
          <main className="flex-1">{children}</main>
          <footer className="flex justify-center pb-8">
            <LanguageSwitcher current={locale} />
          </footer>
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
