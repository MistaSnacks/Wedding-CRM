import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as rsvp from "@/lib/data/rsvp";
import * as seating from "@/lib/data/seating";
import { RsvpFlow } from "@/components/guest/RsvpFlow";
import type {
  EventRow,
  MealOptionRow,
  QuestionRow,
  ResponseRow,
} from "@/lib/types";

export type GuestTableInfo = {
  eventName: string;
  guestName: string;
  tableName: string;
  mates: Array<{ first_name: string; last_name: string }>;
};

export default async function HouseholdRsvpPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
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
  const deadlinePassed = deadline
    ? new Date(deadline).getTime() < Date.now()
    : false;

  const tables: GuestTableInfo[] = [];
  for (const event of context.allEvents.filter((e) => e.seating_published_at)) {
    const assignments = await Promise.all(
      context.guests.map(async (g) => ({
        g,
        table: await seating.guestTable(scope, g.id, event.id),
      })),
    );
    for (const { g, table } of assignments)
      if (table)
        tables.push({
          eventName: event.name,
          guestName: `${g.first_name} ${g.last_name}`,
          tableName: table.tableName,
          mates: table.mates,
        });
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
      guests={context.guests}
      events={context.events as EventRow[]}
      meals={context.meals as MealOptionRow[]}
      questions={context.questions as QuestionRow[]}
      responses={context.responses as ResponseRow[]}
      deadline={deadline}
      timeZone={timeZone}
      deadlinePassed={deadlinePassed}
      tables={tables}
      answers={context.answers}
    />
  );
}
