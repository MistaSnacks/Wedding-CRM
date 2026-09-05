import type { Metadata } from "next";
import VenuePrototype from "@/components/venue/VenuePrototype";
import "./venue.css";
export const metadata: Metadata = {
  title: "Benavento · Venue Lab",
  robots: { index: false, follow: false },
};
export default function VenuePreview() {
  return <VenuePrototype />;
}
