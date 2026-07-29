"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import type { ChangelogEntry } from "@/lib/changelog";
import { dismissChangelog } from "@/app/admin/(dashboard)/changelog-actions";

/**
 * A one-time "here's what changed" note, shown when someone signs in to find
 * the app different from how they left it. Dismissing is recorded against
 * their account, so it never appears twice — including on another device.
 */
export function WhatsNew({ entries }: { entries: ChangelogEntry[] }) {
  const [open, setOpen] = useState(true);
  const [, startTransition] = useTransition();

  if (!entries.length) return null;

  const close = () => {
    setOpen(false);
    startTransition(() => {
      void dismissChangelog();
    });
  };

  const multiple = entries.length > 1;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-label="What's new"
    >
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute inset-0 bg-[#2a3517]/35 backdrop-blur-[2px]"
          />

          {/* Only position is animated, never opacity: a background tab throttles
              requestAnimationFrame, and a half-transparent announcement is worse
              than one that simply doesn't slide. */}
          <motion.div
            initial={{ y: 14, scale: 0.985 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex max-h-[85dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-[#e7e3d2] bg-cream shadow-[0_28px_70px_rgba(42,53,23,0.28)]"
          >
            {/* Header — the app's serif voice, on the blush band it uses elsewhere */}
            <div className="border-b border-blush-border bg-blush px-7 py-6 max-md:px-5 max-md:py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-deep">
                While you were away
              </p>
              <h2 className="mt-1.5 font-display text-[26px] font-semibold leading-tight text-olive-deep max-md:text-[22px]">
                A few things have changed
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#6b6058]">
                {multiple
                  ? "Here's what's new since you were last here, so nothing catches you by surprise."
                  : "Here's what's new since you were last here."}
              </p>
            </div>

            <div className="flex flex-col gap-6 overflow-y-auto px-7 py-6 max-md:px-5 max-md:py-5">
              {entries.map((entry) => (
                <section key={entry.id} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2.5">
                    <h3 className="font-display text-[18px] font-semibold text-ink">{entry.title}</h3>
                    <span className="text-[11.5px] font-medium text-muted">{entry.date}</span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {entry.items.map((item) => (
                      <li key={item} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[#4a5147]">
                        <span aria-hidden className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-olive" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[#efece0] bg-paper/60 px-7 py-4 max-md:px-5">
              <p className="text-[12px] text-muted">You won&apos;t see this again.</p>
              <button
                type="button"
                onClick={close}
                autoFocus
                className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] motion-reduce:transition-none"
              >
                Take a look
              </button>
            </div>
      </motion.div>
    </div>
  );
}
