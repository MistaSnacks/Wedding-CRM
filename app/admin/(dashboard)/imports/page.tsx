import Link from "next/link";
import { ImportWizard } from "@/components/admin/ImportWizard";

const REPORTS = [
  { key: "guest-list", label: "Full guest list" },
  { key: "households", label: "Household list" },
  { key: "rsvp-status", label: "RSVP status report" },
  { key: "attending", label: "Attending guests" },
  { key: "declined", label: "Declined guests" },
  { key: "pending", label: "Pending guests" },
  { key: "meals", label: "Meal counts" },
  { key: "dietary", label: "Dietary restrictions" },
  { key: "accessibility", label: "Accessibility requests" },
  { key: "seating", label: "Seating chart" },
  { key: "addresses", label: "Mailing addresses" },
  { key: "caterer", label: "Caterer report" },
];

export default function ImportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">Imports &amp; Exports</h1>
        <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
          Bring in your guest list from a CSV, or export anything for vendors.
        </p>
      </div>

      <ImportWizard />

      <div className="rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Export center</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Each report downloads as CSV — add ?format=xlsx for Excel.</p>
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {REPORTS.map((r) => (
            <span key={r.key} className="flex overflow-hidden rounded-full border border-[#dddbd0]">
              <a
                href={`/api/export/${r.key}`}
                className="px-3.5 py-1.5 text-[12.5px] font-medium text-[#4a5147] transition-colors hover:bg-sage-band hover:text-olive-deep"
              >
                {r.label}
              </a>
              <a
                href={`/api/export/${r.key}?format=xlsx`}
                className="border-l border-[#dddbd0] px-2.5 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-sage-band hover:text-olive-deep"
              >
                XLSX
              </a>
            </span>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Link
            href="/admin/print/escort-cards"
            className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose"
          >
            Print escort cards
          </Link>
          <Link
            href="/admin/print/place-cards"
            className="rounded-lg border border-[#dddbd0] px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:border-rose hover:text-rose"
          >
            Print place cards
          </Link>
        </div>
      </div>
    </div>
  );
}
