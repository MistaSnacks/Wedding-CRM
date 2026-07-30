import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as rsvp from "@/lib/data/rsvp";
import * as seating from "@/lib/data/seating";
import { RsvpFlow } from "@/components/guest/RsvpFlow";
import type { GuestRow, EventRow, MealOptionRow, QuestionRow, ResponseRow } from "@/lib/types";

export type GuestTableInfo = {
  guestName: string;
  tableName: string;
  mates: Array<{ first_name: string; last_name: string }>;
} | null;

export default async function HouseholdRsvpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const scope = defaultScope();
  const household = await households.byAccessToken(scope, token);
  if (!household) notFound();
  // NOTE: no cookie writes here — Server Components can't set cookies.
  // Every RSVP action re-verifies the URL token instead (see actions.ts).

  const [context, { deadline, timeZone }, locale] = await Promise.all([
    rsvp.getRsvpContext(scope, household.id),
    rsvp.getDeadlineContext(scope),
    getLocale(),
  ]);
  const deadlinePassed = deadline ? new Date(deadline).getTime() < Date.now() : false;

  // Guest-facing seat reveal (first published event with an assignment wins)
  let tableInfo: GuestTableInfo = null;
  const publishedEvent = context.events.find((e) => e.seating_published_at);
  if (publishedEvent && context.guests.length) {
    for (const g of context.guests as GuestRow[]) {
      const t = await seating.guestTable(scope, g.id, publishedEvent.id);
      if (t) {
        tableInfo = { guestName: g.first_name, tableName: t.tableName, mates: t.mates };
        break;
      }
    }
  }

  return (
    <RsvpFlow
      token={token}
      locale={locale}
      household={{
        displayName: household.display_name,
        maxPartySize: household.max_party_size,
        plusOneSlots: household.plus_one_slots,
        rsvpStatus: household.rsvp_status,
      }}
      guests={context.guests as GuestRow[]}
      events={context.events as EventRow[]}
      meals={context.meals as MealOptionRow[]}
      questions={context.questions as QuestionRow[]}
      responses={context.responses as ResponseRow[]}
      deadline={deadline}
      timeZone={timeZone}
      deadlinePassed={deadlinePassed}
      tableInfo={tableInfo}
    />
  );
}
