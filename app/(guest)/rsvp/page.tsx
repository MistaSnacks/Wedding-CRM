import { getLocale, getTranslations } from "next-intl/server";
import { EntryCard } from "@/components/guest/EntryCard";
import { getWeddingPublic } from "@/lib/data/wedding-public";
import { formatCalendarDate } from "@/lib/format/wedding-date";

export default async function RsvpEntryPage() {
  const [t, locale, wedding] = await Promise.all([
    getTranslations("entry"),
    getLocale(),
    getWeddingPublic(),
  ]);
  // The day and city come from the wedding row, so a change on the Events
  // screen shows here at once. With no day yet, only the city is shown.
  const day = formatCalendarDate(wedding.weddingDate, locale);

  return (
    <div className="flex flex-col items-center px-6 pt-20 pb-10">
      <p className="text-[11px] font-medium tracking-[0.28em] text-olive">{t("eyebrow")}</p>
      <h1 className="font-display mt-3 text-center text-5xl font-medium text-olive-deep">
        Juliet&nbsp;&amp;&nbsp;Juan
      </h1>
      <p className="font-display mt-2 text-lg italic text-rose">
        {day ? t("date", { date: day, place: wedding.locationLine }) : wedding.locationLine}
      </p>
      <EntryCard />
    </div>
  );
}
