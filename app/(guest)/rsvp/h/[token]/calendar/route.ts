import { defaultScope } from "@/lib/data/scope";
import { byAccessToken } from "@/lib/data/households";
import { getRsvpContext } from "@/lib/data/rsvp";
import { invitationCalendar } from "@/lib/domain/calendar";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const scope = defaultScope();
  const household = await byAccessToken(scope, token);
  if (!household) return new Response("Invitation not found", { status: 404 });
  const [{ allEvents }, wedding] = await Promise.all([
    getRsvpContext(scope, household.id),
    scope.db
      .from("weddings")
      .select("couple_names")
      .eq("id", scope.weddingId)
      .single(),
  ]);
  if (wedding.error) throw new Error(wedding.error.message);
  return new Response(
    invitationCalendar(allEvents, wedding.data.couple_names),
    {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="wedding-events.ics"',
        "Cache-Control": "private, no-store",
      },
    },
  );
}
