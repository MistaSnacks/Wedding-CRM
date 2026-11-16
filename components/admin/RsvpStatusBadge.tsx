/*
 * A household's reply status as the couple reads it. The stored words
 * ("pending", "started") are for the database; one badge serves the guest
 * list, the search box and the household page so they never disagree.
 */

const STATUS: Record<string, { label: string; cls: string }> = {
  completed: { label: "Replied", cls: "bg-sage-band text-olive-deep" },
  started: { label: "Partly replied", cls: "bg-[#f3edd8] text-[#7a6420]" },
  declined: { label: "Not coming", cls: "bg-blush text-rose" },
  pending: { label: "No reply yet", cls: "bg-[#f1f0ea] text-[#6b7167]" },
};

const SIZES = {
  md: "px-2.5 py-1 text-[11px]",
  sm: "px-2 py-0.5 text-[10px]",
};

export function RsvpStatusBadge({ status, size = "md" }: { status: string; size?: keyof typeof SIZES }) {
  const known = STATUS[status] ?? { label: status, cls: STATUS.pending.cls };
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full font-semibold ${SIZES[size]} ${known.cls}`}>
      {known.label}
    </span>
  );
}
