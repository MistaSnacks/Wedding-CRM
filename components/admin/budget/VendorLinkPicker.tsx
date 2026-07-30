"use client";

import type { VendorStatus } from "@/lib/types";

/**
 * Which vendor this line's money goes to.
 *
 * A `<select>` and not a search box: a wedding has a dozen vendors, not a
 * thousand, and a native select is the control that already works with a thumb,
 * a keyboard and a screen reader on every device the couple owns. The one thing
 * it cannot do — add a vendor that does not exist yet — gets a link out rather
 * than an inline create, because a vendor is a real record with a contact, a
 * contract and a status, and inventing one from a budget row would leave a
 * name-only stub nobody ever finishes.
 *
 * **Linking a vendor writes nothing but the link.** The couple's number stays
 * the couple's number until she says otherwise. The note under the picker says
 * that out loud, because a page that quietly copied a vendor's price into a
 * contract cell would be changing a figure she may have negotiated by hand, and
 * she would find out at reconciliation.
 */
export function VendorLinkPicker(props: {
  vendorId: string | null;
  vendors: Array<{ id: string; name: string; status: VendorStatus }>;
  canEdit: boolean;
  disabled: boolean;
  onChange: (vendorId: string | null) => void;
}) {
  const sorted = [...props.vendors].sort((a, b) => a.name.localeCompare(b.name));
  const linked = props.vendorId === null ? null : sorted.find((v) => v.id === props.vendorId) ?? null;

  if (!props.canEdit) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]">VENDOR</span>
        <span className="text-[13.5px] text-[#4a5147]">{linked ? linked.name : "No vendor yet"}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="budget-item-vendor" className="text-[11px] font-semibold tracking-[0.09em] text-[#6b7167]">
        VENDOR
      </label>
      <select
        id="budget-item-vendor"
        value={props.vendorId ?? ""}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value === "" ? null : event.target.value)}
        className="w-full rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13.5px] text-ink outline-none focus:border-olive"
      >
        <option value="">Not booked yet</option>
        {sorted.map((vendor) => (
          <option key={vendor.id} value={vendor.id}>
            {vendor.name}
          </option>
        ))}
      </select>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href="/admin/vendors?new=1" className="text-[12px] text-olive underline hover:text-rose">
          Add a new vendor
        </a>
        {linked && (
          <a href={`/admin/vendors/${linked.id}`} className="text-[12px] text-olive underline hover:text-rose">
            {`Open ${linked.name}`}
          </a>
        )}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted">
        {"Linking a vendor doesn't change any number here. Your figures stay yours until you change them."}
      </p>
    </div>
  );
}
