"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { matchesGuestQuery } from "@/lib/search/guest-query";
import { fetchDirectory, type DirectoryEntry } from "@/app/admin/(dashboard)/search-actions";

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-sage-band text-olive-deep",
  started: "bg-[#f3edd8] text-[#7a6420]",
  declined: "bg-blush text-rose",
  pending: "bg-[#f1f0ea] text-[#6b7167]",
};

export function HeaderSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const directory = useRef<DirectoryEntry[] | null>(null);
  const [, forceRender] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const ensureDirectory = () => {
    if (directory.current) return;
    fetchDirectory().then((rows) => {
      directory.current = rows;
      forceRender((n) => n + 1);
    });
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const matches =
    open && query.trim() && directory.current
      ? directory.current.filter((h) => matchesGuestQuery(query, h)).slice(0, 8)
      : [];

  const go = (h: DirectoryEntry) => {
    setOpen(false);
    setQuery("");
    router.push(`/admin/guests/${h.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((n) => Math.min(n + 1, matches.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((n) => Math.max(n - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches[highlight]) {
        go(matches[highlight]);
      } else if (query.trim()) {
        setOpen(false);
        router.push(`/admin/guests?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  return (
    <div ref={rootRef} className="relative w-full max-w-[320px] max-md:max-w-none max-md:flex-1">
      <div className="flex items-center gap-2.5 rounded-full border border-blush-border bg-white px-3.5 py-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B17565" strokeWidth="2.2" strokeLinecap="round" className="shrink-0">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            ensureDirectory();
            if (query.trim()) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search guests, households…"
          className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-[#9b8a85]"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-hairline bg-white shadow-[0_12px_32px_rgba(59,72,35,0.16)]">
          {matches.map((h, i) => (
            <button
              key={h.id}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(h);
              }}
              className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left ${i === highlight ? "bg-paper" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{h.display_name}</span>
                <span className="block truncate text-[11.5px] text-[#6b7167]">
                  {h.guests.map((g) => `${g.first_name} ${g.last_name}`).join(", ")}
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] ${STATUS_BADGE[h.rsvp_status] ?? ""}`}>
                {h.rsvp_status}
              </span>
            </button>
          ))}
          {!matches.length && (
            <p className="px-3.5 py-3 text-[12.5px] text-muted">
              {directory.current ? <>No one matches “{query.trim()}”.</> : "Looking…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
