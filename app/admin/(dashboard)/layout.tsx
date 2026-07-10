import { requireAdmin } from "@/lib/admin-auth";
import { defaultScope } from "@/lib/data/scope";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { FilmBackdrop } from "@/components/FilmBackdrop";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const scope = defaultScope();
  const { data: wedding } = await scope.db
    .from("weddings")
    .select("couple_names, wedding_date, rsvp_deadline")
    .eq("id", scope.weddingId)
    .single();

  const daysOut = wedding?.wedding_date
    ? Math.max(0, Math.ceil((new Date(wedding.wedding_date).getTime() - Date.now()) / 86400_000))
    : null;
  const deadlineDays = wedding?.rsvp_deadline
    ? Math.max(0, Math.ceil((new Date(wedding.rsvp_deadline).getTime() - Date.now()) / 86400_000))
    : null;

  const initials = admin.email.slice(0, 2).toUpperCase();

  const dateLabel =
    wedding?.wedding_date && daysOut !== null
      ? `${new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
          new Date(wedding.wedding_date),
        )} · ${daysOut} days out`
      : null;

  return (
    <div className="relative flex min-h-dvh watercolor-bg overflow-hidden">
      <FilmBackdrop />
      {/* Sidebar — translucent so the film shows through; collapsible */}
      <AdminSidebar coupleNames={wedding?.couple_names ?? "Wedding"} dateLabel={dateLabel} />

      {/* Main column: blush top bar (content-width only), then the page */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3.5 border-b border-blush-border bg-blush px-9 py-3 no-print">
          <div className="flex w-[320px] items-center gap-2.5 rounded-full border border-blush-border bg-white px-3.5 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B17565" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <Link href="/admin/guests" className="flex-1 text-[13px] text-[#9b8a85]">
              Search guests, households…
            </Link>
          </div>
          <div className="flex-1" />
          {deadlineDays !== null && (
            <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-rose-deep">
              <span className="h-[7px] w-[7px] rounded-full bg-rose" />
              RSVPs close in {deadlineDays} days
            </span>
          )}
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose text-xs font-semibold text-blush">
            {initials}
          </span>
          <Link
            href="/admin/guests?new=1"
            className="rounded-full bg-olive-deep px-4 py-2 text-[13px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-olive-deeper hover:shadow-[0_6px_14px_rgba(42,53,23,0.3)] active:scale-[0.97] motion-reduce:transition-none"
          >
            ＋ New household
          </Link>
        </header>
        <main className="min-w-0 flex-1 px-9 py-7">{children}</main>
      </div>
    </div>
  );
}
