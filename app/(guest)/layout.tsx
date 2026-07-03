import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { LanguageSwitcher } from "@/components/guest/LanguageSwitcher";

export default async function GuestLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="relative min-h-dvh watercolor-bg overflow-hidden">
        {/* Video backdrop, softly washed so content stays readable */}
        <video
          className="pointer-events-none fixed inset-0 h-full w-full object-cover opacity-25 motion-reduce:hidden"
          autoPlay
          muted
          loop
          playsInline
          poster="/video/hero-v5-poster.jpg"
        >
          <source src="/video/hero-v5.mp4" type="video/mp4" />
        </video>
        <div
          className="pointer-events-none fixed inset-0 hidden motion-reduce:block bg-cover bg-center opacity-25"
          style={{ backgroundImage: "url(/video/hero-v5-poster.jpg)" }}
        />
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
