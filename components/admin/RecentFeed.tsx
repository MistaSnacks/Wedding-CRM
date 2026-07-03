"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import type { ActivityRow } from "@/lib/types";

type FeedItem = ActivityRow & { householdName: string };

const BADGES: Record<string, { label: string; cls: string }> = {
  "rsvp.completed": { label: "COMPLETED", cls: "bg-sage-band text-olive-deep" },
  "rsvp.started": { label: "STARTED", cls: "bg-[#f3edd8] text-[#7a6420]" },
  "rsvp.declined": { label: "DECLINED", cls: "bg-blush text-rose" },
  "plus_one.added": { label: "PLUS ONE", cls: "bg-blush text-rose" },
  "import.completed": { label: "IMPORT", cls: "bg-sage-band text-olive-deep" },
  "table.assigned": { label: "SEATED", cls: "bg-sage-band text-olive-deep" },
};

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function RecentFeed({ items }: { items: FeedItem[] }) {
  if (!items.length) {
    return <p className="py-6 text-center text-[13px] text-muted">No activity yet — import your guest list to get started.</p>;
  }
  return (
    <div className="flex flex-col">
      {items.map((item, i) => {
        const badge = BADGES[item.action];
        const initials = item.householdName
          .split(/\s+/)
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.3 }}
            className="flex items-center gap-3.5 border-t border-[#f1f0ea] py-3 first:border-0"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blush text-[12.5px] font-semibold text-rose">
              {initials || "—"}
            </span>
            <span className="min-w-0 flex-1">
              {item.household_id ? (
                <Link
                  href={`/admin/guests/${item.household_id}`}
                  className="block truncate text-[13.5px] font-semibold text-ink hover:text-rose"
                >
                  {item.householdName}
                </Link>
              ) : (
                <span className="block truncate text-[13.5px] font-semibold text-ink">{item.householdName}</span>
              )}
              <span className="block truncate text-[12.5px] text-muted">
                {String((item.payload as { name?: string })?.name ?? item.action.replace(/\./g, " "))}
              </span>
            </span>
            {badge && (
              <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.05em] ${badge.cls}`}>
                {badge.label}
              </span>
            )}
            <span className="w-[72px] flex-shrink-0 text-right text-[12px] text-muted">{timeAgo(item.created_at)}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
