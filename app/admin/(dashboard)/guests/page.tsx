import Link from "next/link";
import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import type { HouseholdFilter } from "@/lib/types";
import { NewHouseholdForm } from "@/components/admin/NewHouseholdForm";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: HouseholdFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "started", label: "Started" },
  { key: "attending", label: "Attending" },
  { key: "declined", label: "Declined" },
  { key: "families", label: "Families" },
  { key: "plus_ones", label: "Plus ones" },
  { key: "children", label: "Children" },
  { key: "missing_meal", label: "Missing meal" },
  { key: "dietary", label: "Dietary" },
  { key: "accessibility", label: "Accessibility" },
  { key: "no_table", label: "No table" },
  { key: "vip", label: "VIP" },
];

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-sage-band text-olive-deep",
  started: "bg-[#f3edd8] text-[#7a6420]",
  declined: "bg-blush text-rose",
  pending: "bg-[#f1f0ea] text-[#6b7167]",
};

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; new?: string }>;
}) {
  const params = await searchParams;
  const scope = defaultScope();
  const filter = (FILTERS.some((f) => f.key === params.filter) ? params.filter : "all") as HouseholdFilter;
  const rows = await households.search(scope, { text: params.q, filter });

  const totalGuests = rows.reduce((n, h) => n + h.guests.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold text-ink">Guests</h1>
          <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
            {rows.length} households · {totalGuests} guests
          </p>
        </div>
      </div>

      {params.new === "1" && <NewHouseholdForm />}

      <form className="flex items-center gap-2" action="/admin/guests" method="get">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search by name, household, email, phone…"
          className="w-[340px] rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive"
        />
        <input type="hidden" name="filter" value={filter} />
        <button className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose">
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/guests?filter=${f.key}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}`}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              filter === f.key
                ? "bg-olive-deep text-cream"
                : "border border-[#dddbd0] text-[#4a5147] hover:border-rose hover:text-rose"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-hairline">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline bg-paper text-[11px] font-semibold tracking-[0.08em] text-[#6b7167]">
              <th className="px-4 py-3">HOUSEHOLD</th>
              <th className="px-4 py-3">GUESTS</th>
              <th className="px-4 py-3">CONTACT</th>
              <th className="px-4 py-3">RULES</th>
              <th className="px-4 py-3">STATUS</th>
              <th className="px-4 py-3 text-right">CODE</th>
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
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-muted">
                  No households match. Try a different filter, or import your guest list.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
