import { requireAdmin } from "@/lib/admin-auth";
import { defaultScope } from "@/lib/data/scope";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { HeaderSearch } from "@/components/admin/HeaderSearch";
import { FilmBackdrop } from "@/components/FilmBackdrop";
import { formatCalendarDate, daysUntilCalendarDate } from "@/lib/format/wedding-date";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const scope = defaultScope();
  const { data: wedding } = await scope.db
    .from("weddings")
    .select("couple_names, wedding_date, rsvp_deadline, timezone")
    .eq("id", scope.weddingId)
    .single();

  // The venue's zone, not the server's: a Vercel function runs in UTC and
  // would otherwise count a sleep that hasn't happened yet.
  const timeZone: string = wedding?.timezone ?? "America/Los_Angeles";
  const daysOut = wedding?.wedding_date
    ? daysUntilCalendarDate(wedding.wedding_date, new Date(), timeZone)
    : null;
  const deadlineDays = wedding?.rsvp_deadline
    ? Math.max(0, Math.ceil((new Date(wedding.rsvp_deadline).getTime() - Date.now()) / 86400_000))
    : null;

  const initials = admin.email.slice(0, 2).toUpperCase();

  const weddingDay = formatCalendarDate(wedding?.wedding_date ?? null);
  const dateLabel = weddingDay && daysOut !== null ? `${weddingDay} · ${daysOut} days out` : null;

  return (
    <div className="relative flex min-h-dvh watercolor-bg overflow-hidden">
      <FilmBackdrop />
      {/* Sidebar — translucent so the film shows through; collapsible */}
      <AdminSidebar coupleNames={wedding?.couple_names ?? "Wedding"} dateLabel={dateLabel} role={admin.role} />

      {/* Main column: blush top bar (content-width only), then the page */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3.5 border-b border-blush-border bg-blush px-9 py-3 no-print max-md:gap-2 max-md:pl-14 max-md:pr-3">
          <HeaderSearch />
          <div className="flex-1" />
          {deadlineDays !== null && (
            <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-rose-deep max-md:hidden">
              <span className="h-[7px] w-[7px] rounded-full bg-rose" />
              RSVPs close in {deadlineDays} days
            </span>
          )}
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose text-xs font-semibold text-blush">
            {initials}
          </span>
          {admin.role !== "viewer" && (
            <Link
              href="/admin/guests?new=1"
              className="rounded-full bg-olive-deep px-4 py-2 text-[13px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-olive-deeper hover:shadow-[0_6px_14px_rgba(42,53,23,0.3)] active:scale-[0.97] motion-reduce:transition-none"
            >
              ＋<span className="max-md:hidden"> New household</span>
            </Link>
          )}
        </header>
        <main className="min-w-0 flex-1 px-9 py-7 max-md:px-4 max-md:py-5">{children}</main>
      </div>
    </div>
  );
}
