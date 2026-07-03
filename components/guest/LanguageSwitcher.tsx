"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

const LOCALES = ["en", "es", "vi"] as const;

export function LanguageSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(locale: string) {
    document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border border-[#d8d4c2] p-1 transition-opacity ${pending ? "opacity-60" : ""}`}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => setLocale(locale)}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold tracking-wider uppercase transition-colors duration-200 ${
            current === locale
              ? "bg-olive-deep text-cream"
              : "text-[#75796a] hover:text-rose"
          }`}
        >
          {locale}
        </button>
      ))}
    </div>
  );
}
