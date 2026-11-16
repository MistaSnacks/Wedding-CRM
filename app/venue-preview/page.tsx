import type { Metadata } from "next";
import VenueLive from "@/components/venue/VenueLive";
import { loadVenue } from "@/lib/venue/live-load";
import "./venue.css";
import "./live.css";

export const metadata: Metadata = {
  title: "Benavento · Your reception in 3D",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function VenuePreview({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event } = await searchParams;
  const venue = await loadVenue(event);
  return <VenueLive venue={venue} />;
}
