import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { calendarEntries } from "@/lib/data/planning-exports";
import { planningCalendar } from "@/lib/data/planning-rules";
export async function GET() {
  const admin = await requireAdmin();
  const body = planningCalendar(await calendarEntries(forWedding(admin.weddingId)), new Date());
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="wedding-planning.ics"', "Cache-Control": "private, no-store" } });
}
