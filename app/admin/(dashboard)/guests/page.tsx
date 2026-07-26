import Link from "next/link";
import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import type { HouseholdFilter } from "@/lib/types";
import { NewHouseholdForm } from "@/components/admin/NewHouseholdForm";
import { GuestList, type GuestListRow } from "@/components/admin/GuestList";

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

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; new?: string }>;
}) {
  const params = await searchParams;
  const scope = defaultScope();
  const filter = (FILTERS.some((f) => f.key === params.filter) ? params.filter : "all") as HouseholdFilter;
  // Text filtering happens live in the client; the chip filter stays server-side.
  const rows = await households.search(scope, { filter });

  const listRows: GuestListRow[] = rows.map((h) => ({
    id: h.id,
    display_name: h.display_name,
    guests: h.guests.map((g) => ({ first_name: g.first_name, last_name: g.last_name })),
    email: h.email,
    phone: h.phone,
    max_party_size: h.max_party_size,
    plus_one_slots: h.plus_one_slots,
    rsvp_status: h.rsvp_status,
    invite_code: h.invite_code,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <h1 className="flex-1 text-[22px] font-semibold text-ink">Guests</h1>
      </div>

      {params.new === "1" && <NewHouseholdForm />}

      <div className="flex flex-wrap gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/guests?filter=${f.key}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}`}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              filter === f.key
                ? "bg-olive-deep text-cream"
                : "border border-[#dddbd0] text-[#4a5147] hover:border-rose hover:text-rose"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <GuestList rows={listRows} initialQuery={params.q ?? ""} filter={filter} canDelete />
    </div>
  );
}
