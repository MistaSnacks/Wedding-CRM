import { getTranslations } from "next-intl/server";
import { EntryCard } from "@/components/guest/EntryCard";

export default async function RsvpEntryPage() {
  const t = await getTranslations("entry");

  return (
    <div className="flex flex-col items-center px-6 pt-20 pb-10">
      <p className="text-[11px] font-medium tracking-[0.28em] text-olive">{t("eyebrow")}</p>
      <h1 className="font-display mt-3 text-center text-5xl font-medium text-olive-deep">
        Juliet&nbsp;&amp;&nbsp;Juan
      </h1>
      <p className="font-display mt-2 text-lg italic text-rose">{t("date")}</p>
      <EntryCard />
    </div>
  );
}
