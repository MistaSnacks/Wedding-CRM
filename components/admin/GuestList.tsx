"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { matchesGuestQuery } from "@/lib/search/guest-query";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { deleteHousehold } from "@/app/admin/(dashboard)/guests/actions";

export type GuestListRow = {
  id: string;
  display_name: string;
  guests: Array<{ first_name: string; last_name: string }>;
  email: string | null;
  phone: string | null;
  max_party_size: number;
  plus_one_slots: number;
  rsvp_status: string;
  invite_code: string;
};

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-sage-band text-olive-deep",
  started: "bg-[#f3edd8] text-[#7a6420]",
  declined: "bg-blush text-rose",
  pending: "bg-[#f1f0ea] text-[#6b7167]",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function GuestList(props: {
  rows: GuestListRow[];
  initialQuery: string;
  filter: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(props.initialQuery);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = useMemo(
    () => props.rows.filter((h) => matchesGuestQuery(query, h)),
    [props.rows, query],
  );
  const totalGuests = rows.reduce((n, h) => n + h.guests.length, 0);

  // Keep the URL shareable without triggering a server navigation on each key.
  const onChange = (value: string) => {
    setQuery(value);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      if (props.filter !== "all") params.set("filter", props.filter);
      const qs = params.toString();
      window.history.replaceState(null, "", `/admin/guests${qs ? `?${qs}` : ""}`);
    }, 250);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] text-[#6b7167]">
        {plural(rows.length, "household")} · {plural(totalGuests, "guest")}
      </p>

      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, household, email, phone…"
        className="w-full max-w-[340px] rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive max-md:max-w-none"
      />

      {/* Desktop table */}
      <div className="overflow-hidden rounded-xl border border-hairline max-md:hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline bg-paper text-[11px] font-semibold tracking-[0.08em] text-[#6b7167]">
              <th className="px-4 py-3">HOUSEHOLD</th>
              <th className="px-4 py-3">GUESTS</th>
              <th className="px-4 py-3">CONTACT</th>
              <th className="px-4 py-3">RULES</th>
              <th className="px-4 py-3">STATUS</th>
              <th className="px-4 py-3 text-right">CODE</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id} className="border-b border-[#f1f0ea] last:border-0 hover:bg-paper/60">
                <td className="px-4 py-3.5">
                  <Link href={`/admin/guests/${h.id}`} className="font-semibold text-[13.5px] text-ink hover:text-rose">
                    {h.display_name}
                  </Link>
                </td>
                <td className="px-4 py-3.5 text-[13px] text-[#4a5147]">
                  {h.guests.map((g) => `${g.first_name} ${g.last_name}`).join(", ") || "—"}
                </td>
                <td className="px-4 py-3.5 text-[13px] text-[#4a5147]">{h.email ?? "—"}</td>
                <td className="px-4 py-3.5 text-[13px] text-[#4a5147]">
                  Max {h.max_party_size}
                  {h.plus_one_slots > 0 ? ` · +${h.plus_one_slots}` : ""}
                </td>
                <td className="px-4 py-3.5">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.05em] uppercase ${STATUS_BADGE[h.rsvp_status]}`}>
                    {h.rsvp_status}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-[12px] tracking-wider text-muted">{h.invite_code}</td>
                <td className="px-4 py-3.5 text-right">
                  {props.canDelete && (
                    <ConfirmButton label="Delete" confirmLabel="Delete all?" action={deleteHousehold.bind(null, h.id)} />
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-muted">
                  {query.trim()
                    ? <>No one matches “{query.trim()}”.</>
                    : "No households match. Try a different filter, or import your guest list."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phone cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((h) => (
          <Link
            key={h.id}
            href={`/admin/guests/${h.id}`}
            className="flex items-center gap-3 rounded-xl border border-hairline bg-white/70 px-4 py-3.5 active:bg-paper"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-ink">{h.display_name}</span>
              <span className="mt-0.5 block truncate text-[12.5px] text-[#4a5147]">
                {h.guests.map((g) => `${g.first_name} ${g.last_name}`).join(", ") || "No guests yet"}
              </span>
            </span>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.05em] uppercase ${STATUS_BADGE[h.rsvp_status]}`}>
              {h.rsvp_status}
            </span>
          </Link>
        ))}
        {!rows.length && (
          <p className="rounded-xl border border-hairline px-4 py-8 text-center text-[13px] text-muted">
            {query.trim()
              ? <>No one matches “{query.trim()}”.</>
              : "No households match. Try a different filter, or import your guest list."}
          </p>
        )}
      </div>
    </div>
  );
}
