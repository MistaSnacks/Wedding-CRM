"use client";

import { useActionState, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { findParty, enterParty, type FindPartyResult, type EnterPartyResult } from "@/app/(guest)/rsvp/actions";

/**
 * Name-first entry: type your name (or email) → confirm your party on a card
 * → straight into the RSVP. No invite code, no emailed link — see the note in
 * app/(guest)/rsvp/actions.ts.
 */
export function EntryCard() {
  const t = useTranslations("entry");
  const [findState, findAction, findPending] = useActionState<FindPartyResult | null, FormData>(findParty, null);
  const [enterState, enterAction, enterPending] = useActionState<EnterPartyResult | null, FormData>(enterParty, null);
  // Bumped by "search again" so the confirm view yields back to the form even
  // though the last action result still says "matches".
  const [dismissedAt, setDismissedAt] = useState<FindPartyResult | null>(null);

  const confirming = findState?.status === "matches" && findState !== dismissedAt;
  const searchError =
    findState && findState.status !== "matches" && findState !== dismissedAt ? findState.status : null;

  return (
    <div className="mt-12 w-full max-w-[360px]">
      <AnimatePresence mode="wait" initial={false}>
        {!confirming ? (
          <motion.div
            key="search"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="rounded-2xl border border-[#e7e3d2] bg-white p-7 shadow-[0_18px_40px_rgba(59,72,35,0.14)]"
          >
            <h2 className="font-display text-2xl font-semibold text-olive-deep">{t("rsvp")}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#5c6151]">{t("searchPrompt")}</p>
            <form action={findAction} className="mt-4 flex flex-col gap-3">
              <input
                name="name"
                autoComplete="name"
                placeholder={t("namePlaceholder")}
                className="w-full rounded-xl border-[1.5px] border-[#c8cbb0] bg-cream px-4 py-4 text-center text-lg font-medium text-olive-deep outline-none focus:border-olive"
              />
              <div className="flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-[#e0dcc9]" />
                <span className="text-[11px] font-medium tracking-[0.22em] text-[#8b8f7c] uppercase">{t("or")}</span>
                <span className="h-px flex-1 bg-[#e0dcc9]" />
              </div>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
                className="w-full rounded-xl border-[1.5px] border-[#c8cbb0] bg-cream px-4 py-4 text-center text-lg font-medium text-olive-deep outline-none focus:border-olive"
              />
              {searchError && <p className="text-sm text-rose">{t(`errors.${searchError}`)}</p>}
              <button
                type="submit"
                disabled={findPending}
                className="btn-primary w-full rounded-xl bg-olive-deep py-4 text-[15px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                {findPending ? "…" : t("find")}
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="rounded-2xl border border-[#e7e3d2] bg-white p-7 shadow-[0_18px_40px_rgba(59,72,35,0.14)]"
          >
            <h2 className="font-display text-2xl font-semibold text-olive-deep">{t("confirmTitle")}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#5c6151]">{t("confirmHint")}</p>
            <div className="mt-4 flex flex-col gap-3">
              {findState.status === "matches" &&
                findState.matches.map((m) => (
                  <form key={m.id} action={enterAction}>
                    <input type="hidden" name="household" value={m.id} />
                    <button
                      type="submit"
                      disabled={enterPending}
                      className="w-full rounded-xl border-[1.5px] border-[#c8cbb0] bg-cream px-4 py-4 text-left transition-all duration-200 hover:-translate-y-px hover:border-olive hover:shadow-[0_8px_18px_rgba(59,72,35,0.12)] active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                      <span className="block text-[15px] font-semibold text-olive-deep">{m.displayName}</span>
                      {m.members.length > 0 && (
                        <span className="mt-0.5 block text-[13px] text-[#5c6151]">{m.members.join(" · ")}</span>
                      )}
                    </button>
                  </form>
                ))}
              {enterState && <p className="text-sm text-rose">{t(`errors.${enterState.status}`)}</p>}
            </div>
            <button
              type="button"
              onClick={() => setDismissedAt(findState)}
              className="mt-4 w-full text-center text-[13.5px] font-medium text-rose underline underline-offset-4 hover:text-rose-deep"
            >
              {t("searchAgain")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
