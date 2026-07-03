"use client";

import { useActionState, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { enterWithCode, findInvitation, type EntryResult } from "@/app/(guest)/rsvp/actions";

export function EntryCard() {
  const t = useTranslations("entry");
  const [mode, setMode] = useState<"code" | "search">("code");
  const [codeState, codeAction, codePending] = useActionState<EntryResult | null, FormData>(enterWithCode, null);
  const [findState, findAction, findPending] = useActionState<{ done: boolean; rateLimited?: boolean } | null, FormData>(
    findInvitation,
    null,
  );

  return (
    <div className="mt-12 w-full max-w-[360px]">
      <AnimatePresence mode="wait" initial={false}>
        {mode === "code" ? (
          <motion.div
            key="code"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="rounded-2xl border border-[#e7e3d2] bg-white p-7 shadow-[0_18px_40px_rgba(59,72,35,0.14)]"
          >
            <h2 className="font-display text-2xl font-semibold text-olive-deep">{t("rsvp")}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#5c6151]">{t("codePrompt")}</p>
            <form action={codeAction} className="mt-4 flex flex-col gap-3">
              <input
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={t("codePlaceholder")}
                className="w-full rounded-xl border-[1.5px] border-[#c8cbb0] bg-cream px-4 py-4 text-center text-xl font-semibold tracking-[0.3em] text-olive-deep uppercase outline-none focus:border-olive"
              />
              {codeState && !codeState.ok && (
                <p className="text-sm text-rose">{t(`errors.${codeState.error}`)}</p>
              )}
              <button
                type="submit"
                disabled={codePending}
                className="btn-primary w-full rounded-xl bg-olive-deep py-4 text-[15px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                {codePending ? "…" : t("find")}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setMode("search")}
              className="mt-4 w-full text-center text-[13.5px] font-medium text-rose underline underline-offset-4 hover:text-rose-deep"
            >
              {t("noCode")}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="search"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="rounded-2xl border border-[#e7e3d2] bg-white p-7 shadow-[0_18px_40px_rgba(59,72,35,0.14)]"
          >
            <h2 className="font-display text-2xl font-semibold text-olive-deep">{t("searchTitle")}</h2>
            {findState?.done ? (
              <p className="mt-3 text-sm leading-relaxed text-olive">{t("linkSent")}</p>
            ) : (
              <>
                <p className="mt-1.5 text-sm leading-relaxed text-[#5c6151]">{t("searchPrompt")}</p>
                <form action={findAction} className="mt-4 flex flex-col gap-3">
                  <input
                    name="name"
                    placeholder={t("namePlaceholder")}
                    className="w-full rounded-xl border border-[#ddd9c4] bg-cream px-4 py-3.5 text-sm outline-none focus:border-olive"
                  />
                  <input
                    name="email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    className="w-full rounded-xl border border-[#ddd9c4] bg-cream px-4 py-3.5 text-sm outline-none focus:border-olive"
                  />
                  {findState?.rateLimited && <p className="text-sm text-rose">{t("errors.rate_limited")}</p>}
                  <button
                    type="submit"
                    disabled={findPending}
                    className="w-full rounded-xl bg-olive-deep py-4 text-[15px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    {findPending ? "…" : t("sendLink")}
                  </button>
                </form>
              </>
            )}
            <button
              type="button"
              onClick={() => setMode("code")}
              className="mt-4 w-full text-center text-[13.5px] font-medium text-rose underline underline-offset-4 hover:text-rose-deep"
            >
              {t("backToCode")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
