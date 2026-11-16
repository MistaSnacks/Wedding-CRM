import { PrintedCards } from "@/components/admin/PrintedCards";
export const dynamic = "force-dynamic";
export default async function PlaceCardsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  return <PrintedCards eventId={(await searchParams).event} place />;
}
