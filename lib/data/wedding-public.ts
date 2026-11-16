import { cache } from "react";
import { defaultScope, type WeddingScope } from "./scope";
import { weddingFactsFromRow, type WeddingFacts } from "@/lib/domain/wedding-details";

/**
 * The wedding's public facts: who, when, where and the reply-by date.
 *
 * Every guest surface (the RSVP page, each email) reads them here, from the
 * `weddings` row, so a change the couple makes on the Events screen reaches
 * guests with no code change. Nothing is cached between requests on purpose:
 * a stale wedding date in an invitation is worse than one small query.
 */

export type WeddingPublic = WeddingFacts;

const FACT_COLS = "couple_names, wedding_date, rsvp_deadline, timezone, theme";

/** The facts for one wedding. Throws when the row cannot be read. */
export async function weddingFactsFor(scope: WeddingScope): Promise<WeddingFacts> {
  const { data, error } = await scope.db.from("weddings").select(FACT_COLS).eq("id", scope.weddingId).single();
  if (error) throw new Error(error.message);
  return weddingFactsFromRow(data);
}

/**
 * The facts for the single wedding guests see. `cache` shares one read between
 * the components of one request; the next request reads the row again.
 */
export const getWeddingPublic = cache(async (): Promise<WeddingPublic> => weddingFactsFor(defaultScope()));
